"""
Fetch + extract main article text from a source URL.

Used to enrich articles whose RSS body is a short teaser (FT, Foreign Affairs,
Nature — most premium publishers). Trafilatura handles HTML cleaning and
boilerplate removal; we own the HTTP client so we can set a timeout and a
polite user-agent.

Failures (paywalls, JS-rendered pages, network errors) are silent — caller
should fall back to the RSS body.
"""

import asyncio
import html as html_lib
import re

import httpx
import trafilatura

USER_AGENT = (
    "ClearLens/1.0 personal-news-reader (+https://github.com/news-bias-app)"
)
# 8s was cutting off slow-but-working publishers mid-response.
TIMEOUT_SECONDS = 15.0
MAX_BODY_CHARS = 8000
# A scrape has to reach this to be worth preferring over the RSS body.
MIN_GOOD_EXTRACT = 600
# Trafilatura output at or above this is a real article — short wire briefs land
# here — and is never second-guessed by the paragraph fallback.
MIN_TRUSTED_EXTRACT = 200

# Phrases that, taken together, identify a paywall/login wall rather than
# real article content. Hitting 2+ → treat as scrape failure so the caller
# falls back to the RSS body instead of summarising sales copy.
_PAYWALL_PHRASES = (
    "subscribe to unlock",
    "subscribe to read",
    "try unlimited access",
    "create your account",
    "sign in to read",
    "already a subscriber",
    "complete digital access",
    "ft journalism",
    "ft edit",
    "ft alphaville",
    "annual subscription",
    "explore more offers",
    "explore our full range",
    "per month then",
    "cancel anytime",
    "register to read",
    "log in to view",
    "subscribe now to",
    "hand-picked by ft",
    "month free with",
)


def _looks_like_paywall(text: str) -> bool:
    lower = text.lower()
    hits = sum(1 for p in _PAYWALL_PHRASES if p in lower)
    return hits >= 2


_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def _strip_regions(raw_html: str, tags: tuple[str, ...]) -> str:
    """Drop <tag>…</tag> regions with a linear scan.

    Done with str.find rather than a regex: `<(script|style)\\b.*?</\\1>` over a
    1 MB page backtracks quadratically, and these pages routinely exceed 1 MB.
    """
    lowered = raw_html.lower()
    out: list[str] = []
    i = 0
    while i < len(raw_html):
        starts = [(lowered.find(f"<{t}", i), t) for t in tags]
        starts = [(p, t) for p, t in starts if p != -1]
        if not starts:
            out.append(raw_html[i:])
            break
        pos, tag = min(starts)
        out.append(raw_html[i:pos])
        end = lowered.find(f"</{tag}>", pos)
        if end == -1:
            break  # unterminated — discard the remainder
        i = end + len(tag) + 3
    return "".join(out)


def _paragraph_fallback(raw_html: str) -> str:
    """Join the <p> blocks that read like prose.

    Trafilatura's model gives up on some otherwise-fine markup (it returned
    nothing at all for PBS). This is deliberately dumb: keep paragraphs long
    enough to be a real sentence and drop the nav/caption chaff.

    Scanned linearly for the same reason as _strip_regions — a lazy `(.*?)`
    between <p> and </p> is quadratic when the markup has unclosed tags.
    """
    body = _strip_regions(raw_html, ("script", "style", "noscript"))
    lowered = body.lower()
    out: list[str] = []
    i = 0
    while True:
        start = lowered.find("<p", i)
        if start == -1:
            break
        # "<p" also prefixes <picture>, <pre>, <path>: the next character has to
        # end the tag name for this to be a paragraph.
        if lowered[start + 2 : start + 3] not in (">", "/", " ", "\t", "\n", "\r"):
            i = start + 2
            continue
        open_end = body.find(">", start)
        if open_end == -1:
            break
        # The close tag needs the same tag-name check as the open tag, or
        # "</p" prefix-matches </picture> and </pre> and truncates the
        # paragraph at an inline image.
        close = open_end
        while True:
            close = lowered.find("</p", close)
            if close == -1:
                break
            after = lowered[close + 3 : close + 4]
            if after in (">", " ", "\t", "\n", "\r"):
                break
            close += 3
        if close == -1:
            break
        close_end = body.find(">", close)
        if close_end == -1:
            break
        text = html_lib.unescape(_TAG.sub("", body[open_end + 1 : close])).strip()
        text = _WS.sub(" ", text)
        if len(text) >= 60 and text.count(" ") >= 8:
            out.append((start, close_end, text))
        i = close_end + 1

    return _largest_block(out)


# Article paragraphs sit next to each other; teasers, promos, author bios and
# footer legalese are scattered around the page behind a lot of markup. Anything
# further apart than this is treated as a different block.
_BLOCK_GAP_CHARS = 2500


def _largest_block(paragraphs: list[tuple[int, int, str]]) -> str:
    """Keep only the biggest run of paragraphs that sit together in the page.

    Concatenating every qualifying <p> is what let unrelated page furniture
    outweigh a short article and get stored as its body.
    """
    if not paragraphs:
        return ""
    runs: list[list[tuple[int, int, str]]] = [[paragraphs[0]]]
    for prev, cur in zip(paragraphs, paragraphs[1:]):
        if cur[0] - prev[1] > _BLOCK_GAP_CHARS:
            runs.append([cur])
        else:
            runs[-1].append(cur)
    # Squared length, not raw total: article prose is a few long paragraphs,
    # page furniture is many short ones. Summing raw length lets eight teasers
    # outrank three real paragraphs; squaring rewards depth over count.
    best = max(runs, key=lambda run: sum(len(p[2]) ** 2 for p in run))
    return "\n".join(p[2] for p in best)


def _extract(raw_html: str) -> str:
    """Trafilatura first, paragraph scrape only when it genuinely failed.

    `favor_precision` used to be on here; it was discarding whole articles
    rather than trimming them — PBS went from 19k characters to zero — so the
    default profile is what we want, with the fallback covering its misses.

    Deliberately *not* "whichever is longer": a wire brief legitimately extracts
    to a few hundred characters, and letting a longer scrape win meant page
    boilerplate replaced correct short bodies — which then fed the bias and
    sentiment models. The fallback only gets a say when trafilatura returned
    essentially nothing.
    """
    text = (
        trafilatura.extract(raw_html, include_comments=False, include_tables=False)
        or ""
    ).strip()
    if len(text) >= MIN_TRUSTED_EXTRACT:
        return text
    fallback = _paragraph_fallback(raw_html)
    # Only accept the scrape if it is substantial; otherwise keep whatever
    # trafilatura managed, and let the caller fall back to the RSS body.
    return fallback if len(fallback) >= MIN_GOOD_EXTRACT else text


async def try_extract(url: str) -> str | None:
    """Returns extracted main article text, or None on any failure."""
    if not url:
        return None
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_SECONDS,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as client:
            r = await client.get(url)
            if r.status_code != 200 or not r.text:
                return None
            # Extraction is CPU-bound — push to a thread so the event loop
            # keeps moving for other articles.
            text = await asyncio.to_thread(_extract, r.text)
            if not text:
                return None
            if len(text) < 50:
                return None
            if _looks_like_paywall(text):
                return None
            return text[:MAX_BODY_CHARS]
    except Exception:
        return None
