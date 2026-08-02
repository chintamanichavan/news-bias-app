"""
Where newsroom attention and market-priced probability disagree.

Both sides are *measured*, never predicted: coverage is a count of articles in
this corpus, probability is what Polymarket traders are actually paying. The
interesting quantity is the gap between them — a story nine outlets are running
hard that the market prices at 8%, or a market at 80% that nobody is covering.

Article↔market matching is deliberately a transparent bag-of-terms score rather
than an embedding: every match can be explained by pointing at the shared terms,
which matters when the output is "the press is over-covering this".
"""

import math
import re
from collections import Counter

# Question boilerplate carries no topical signal — every Polymarket title has
# some of it, so leaving it in makes everything match everything.
_STOPWORDS = {
    "will", "the", "a", "an", "of", "in", "on", "at", "to", "for", "by", "be",
    "is", "are", "was", "were", "and", "or", "not", "no", "any", "all", "with",
    "before", "after", "through", "during", "between", "than", "then", "this",
    "that", "these", "those", "it", "its", "as", "from", "up", "down", "out",
    "over", "under", "more", "most", "less", "least", "new", "get", "gets",
    "have", "has", "had", "do", "does", "did", "say", "says", "said",
    # market-specific furniture
    "market", "markets", "resolve", "resolves", "resolved", "price", "prices",
    "yes", "another", "reach", "reaches", "hit", "hits", "dip", "dips",
    "continue", "continues", "announce", "announces", "announced", "end",
    "ends", "ended", "win", "wins", "won", "many", "much", "how", "what",
    "who", "when", "where", "which", "if", "am", "pm", "et", "utc",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
}

_WORD = re.compile(r"[a-z][a-z'\-]{2,}")
# Terms this common across the corpus say nothing about which story is which.
_MAX_DOC_FREQ = 0.10
_MIN_SHARED_WEIGHT = 2.4   # tuned so a single generic overlap can't match
_MIN_SHARED_TERMS = 2
# At least one shared term has to be genuinely distinctive. Without this,
# "israel" + "prime" + "minister" matched a market on the next Israeli PM to a
# story about a statue in Uganda — three moderately common words, no shared
# subject. A rare term is what makes a match about the same event.
_MIN_RARE_TERM_IDF = 5.5      # one term distinctive enough to stand alone
_RARE_ENOUGH_IDF = 4.5        # …or two of these together
_MIN_RARE_TERMS = 2


def terms(text: str) -> set[str]:
    """Normalised content words. Set, not list — repetition shouldn't score."""
    if not text:
        return set()
    return {w for w in _WORD.findall(text.lower()) if w not in _STOPWORDS}


def _idf(docs: list[set[str]]) -> dict[str, float]:
    """Inverse document frequency over the article corpus.

    Without this, 'trump' or 'iran' — present in a large share of headlines —
    would dominate every match and every market would look well covered.
    """
    n = max(1, len(docs))
    df = Counter()
    for d in docs:
        df.update(d)
    return {
        t: math.log(n / c)
        for t, c in df.items()
        if c / n <= _MAX_DOC_FREQ
    }


def match_articles(
    markets: list[dict],
    articles: list[dict],
) -> dict[str, list[dict]]:
    """Map market id → the articles that plausibly cover it.

    Scored by summed IDF of shared terms, with a floor on both the weight and
    the raw count so one rare-but-incidental word can't create a match.
    """
    art_terms = [(a, terms(f"{a.get('title') or ''} {a.get('summary') or ''}")) for a in articles]
    idf = _idf([t for _, t in art_terms])

    out: dict[str, list[dict]] = {}
    for m in markets:
        q = terms(m.get("question") or "")
        q = {t for t in q if t in idf}
        if not q:
            out[m["id"]] = []
            continue
        hits = []
        for article, at in art_terms:
            shared = q & at
            if len(shared) < _MIN_SHARED_TERMS:
                continue
            weight = sum(idf[t] for t in shared)
            if weight < _MIN_SHARED_WEIGHT:
                continue
            rare = [idf[t] for t in shared if idf[t] >= _RARE_ENOUGH_IDF]
            if not (len(rare) >= _MIN_RARE_TERMS or max(rare or [0]) >= _MIN_RARE_TERM_IDF):
                continue  # only generic overlap — same topic area, different story
            hits.append({**article, "_score": round(weight, 3),
                         "_shared": sorted(shared, key=lambda t: -idf[t])})
        hits.sort(key=lambda h: -h["_score"])
        out[m["id"]] = hits
    return out


def _attention(count: int, counts: list[int]) -> float:
    """Coverage as a share of the most-covered market's, 0–1.

    Deliberately not a percentile rank: with most markets uncovered, "share at
    or below" put every zero-coverage market at the ~70th percentile, so no
    market could ever read as under-covered. Share-of-max sends zero to zero and
    is far easier to explain to a reader.
    """
    top = max(counts) if counts else 0
    return round(count / top, 4) if top else 0.0


def dedupe(markets: list[dict]) -> list[dict]:
    """Collapse the same question asked at several horizons.

    Polymarket lists "US-Iran deal by Aug 13 / Aug 18 / Aug 31" as three
    contracts with identical wording bar the date; left alone they crowd out
    everything else in a ranked list. Keeps the most-traded of each family.
    """
    families: dict[frozenset, dict] = {}
    for m in markets:
        key = frozenset(terms(m.get("question") or ""))
        if not key:
            continue
        best = families.get(key)
        if best is None or (m.get("volume_24h") or 0) > (best.get("volume_24h") or 0):
            families[key] = m
    return list(families.values())


def build(markets: list[dict], articles: list[dict], limit: int = 12) -> dict:
    """Rank markets by how far coverage and priced probability disagree.

    Attention and probability are different units, so attention is expressed as
    a share of the most-covered market's volume, putting both on a 0–1 footing.
    The sign says which way the disagreement runs.

    Only markets these outlets actually write about are ranked. A market with
    zero matching articles has no disagreement to report — it is simply outside
    what this corpus covers (crypto prices, UK by-elections), and including them
    filled the entire list with topics the newsroom never claimed to follow.
    """
    total_markets = len(markets)
    markets = dedupe(markets)
    matches = match_articles(markets, articles)

    counts = [len(matches[m["id"]]) for m in markets]
    if not any(counts):
        return {"items": [], "matched_markets": 0, "uncovered_markets": len(markets),
                "total_markets": total_markets, "matched_articles": 0}

    items = []
    uncovered = 0
    for m in markets:
        hits = matches[m["id"]]
        probability = m.get("yes_price")
        if probability is None:
            continue
        if not hits:
            uncovered += 1
            continue
        attention = _attention(len(hits), counts)
        gap = attention - probability
        tones = [h["sentiment_score"] for h in hits if h.get("sentiment_score") is not None]
        items.append({
            "market_id": m["id"],
            "question": m.get("question"),
            "category": m.get("category"),
            "url": m.get("url"),
            "end_date": m.get("end_date"),
            "probability": round(probability, 4),
            "change_24h": m.get("yes_change_24h"),
            "articles": len(hits),
            "outlets": len({h["source_id"] for h in hits}),
            "attention": round(attention, 4),
            "gap": round(gap, 4),
            # Descriptive, not a verdict: coverage volume and outcome
            # probability are different things, and a topic can be worth
            # covering heavily at low odds. The label states what was measured.
            "direction": "loud, long odds" if gap > 0 else "quiet, short odds",
            "mean_tone": round(sum(tones) / len(tones), 4) if tones else None,
            "shared_terms": hits[0]["_shared"][:6] if hits else [],
            "headlines": [
                {"id": h["id"], "title": h["title"], "source_id": h["source_id"]}
                for h in hits[:3]
            ],
        })

    items.sort(key=lambda i: -abs(i["gap"]))
    return {
        "items": items[:limit],
        "matched_markets": len(items),
        "uncovered_markets": uncovered,
        "total_markets": total_markets,
        "matched_articles": sum(len(v) for v in matches.values()),
    }
