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

import httpx
import trafilatura

USER_AGENT = (
    "ClearLens/1.0 personal-news-reader (+https://github.com/news-bias-app)"
)
TIMEOUT_SECONDS = 8.0
MAX_BODY_CHARS = 8000

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
            # trafilatura.extract is CPU-bound — push to a thread so the event
            # loop keeps moving for other articles.
            text = await asyncio.to_thread(
                trafilatura.extract,
                r.text,
                include_comments=False,
                include_tables=False,
                favor_precision=True,
            )
            if not text:
                return None
            text = text.strip()
            if len(text) < 50:
                return None
            if _looks_like_paywall(text):
                return None
            return text[:MAX_BODY_CHARS]
    except Exception:
        return None
