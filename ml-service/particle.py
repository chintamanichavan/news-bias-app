"""
Particle-style features on classical ML — no LLMs, consistent with the
project's premise.

- tag_topics:       keyword-rule topic tagging per article (Particle's
                    followable interests)
- key_points:       bullet summary (top extractive sentences, doc order)
- five_ws:          heuristic Who/What/When/Where/Why
- answer_question:  extractive QA over a story group (TF-IDF retrieval)
- build_crossword:  daily mini-crossword from headlines
"""

import hashlib
import random
import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from summarize import _normalize, _split_sentences, _word_count, summarize

# ── Topics ──────────────────────────────────────────────────────────────────

# Strictly markets + weather: the app's two verticals. Anything that matches
# none of these is out of scope for the feed.
TOPICS: dict[str, list[str]] = {
    "Stocks": ["stocks", "s&p", "nasdaq", "dow", "equities", "shares", "wall street",
               "rally", "sell-off", "earnings", "ipo", "dividend", "buyback"],
    "Bonds & Rates": ["bond", "treasury", "yield", "interest rate", "fed", "federal reserve",
                      "fomc", "rate cut", "rate hike", "duration", "credit spread"],
    "Macro": ["inflation", "gdp", "jobs report", "unemployment", "cpi", "ppi", "recession",
              "consumer spending", "tariff", "trade deficit", "pmi", "retail sales"],
    "Crypto": ["bitcoin", "ethereum", "crypto", "stablecoin", "blockchain", "btc", "etf inflow"],
    "Commodities": ["oil", "crude", "gold", "silver", "copper", "wheat", "corn", "opec",
                    "natural gas", "brent", "wti", "futures"],
    "Energy": ["energy prices", "power grid", "electricity", "renewable", "solar", "utility",
               "lng", "refinery", "drilling"],
    "Housing": ["housing", "mortgage", "home prices", "real estate", "homebuilder", "rent"],
    "Currencies": ["us dollar", "dollar index", "greenback", "the euro", "yen", "yuan",
                   "currency", "forex", "exchange rate", "devaluation"],
    "Severe Weather": ["hurricane", "tornado", "tropical storm", "winter storm", "storm surge",
                       "storm warning", "thunderstorm", "nor'easter", "blizzard", "flood",
                       "wildfire", "heat wave", "cold snap", "typhoon", "cyclone", "hail", "derecho"],
    "Forecasts": ["forecast", "weather service", "nws", "noaa", "el niño", "la niña",
                  "polar vortex", "jet stream", "precipitation", "snowfall"],
    "Climate": ["climate", "emissions", "carbon", "drought", "sea level", "warming",
                "record temperature", "epa", "cop3"],
    "Weather & Markets": ["crop", "harvest", "growing season", "freeze damage", "catastrophe bond",
                          "insured losses", "reinsurance", "weather derivative"],
}

# Word boundaries on every keyword — substring matching tagged "neurological"
# as Currencies (euro) and "current" as Housing (rent).
_TOPIC_PATTERNS = {
    topic: re.compile("|".join(r"\b" + re.escape(k.strip()) + r"\b" for k in kws),
                      re.IGNORECASE)
    for topic, kws in TOPICS.items()
}


# Ranked topics per text, keyed by a digest of the text. An article's tags
# never change, yet the simulation and the signal engine ask for all of them
# again on every run: 24 regex scans per article, 9 s over 67,000 articles.
_ranked_topics: dict[bytes, tuple[str, ...]] = {}
_RANKED_TOPICS_MAX = 500_000


def tag_topics(title: str, body: str | None = None, max_topics: int = 3) -> list[str]:
    """Rule-based topic tags. Title hits count double — headlines are the signal."""
    title = title or ""
    head = (body or "")[:600]
    key = hashlib.blake2b(f"{title}\0{head}".encode(), digest_size=16).digest()
    ranked = _ranked_topics.get(key)
    if ranked is None:
        if len(_ranked_topics) >= _RANKED_TOPICS_MAX:
            _ranked_topics.clear()
        ranked = _ranked_topics[key] = _rank_topics(title, head)
    return list(ranked[:max_topics])


def _rank_topics(title: str, head: str) -> tuple[str, ...]:
    scores: list[tuple[int, str]] = []
    for topic, pat in _TOPIC_PATTERNS.items():
        n = 2 * len(pat.findall(title)) + len(pat.findall(head))
        if n:
            scores.append((n, topic))
    scores.sort(reverse=True)
    return tuple(t for _, t in scores)


# ── Key points ──────────────────────────────────────────────────────────────

def key_points(title: str, body: str, n: int = 4) -> list[str]:
    """Top-n extractive sentences in document order, trimmed for bullets."""
    body = _normalize(body)
    sentences = _split_sentences(body)
    if len(sentences) <= n:
        return sentences

    try:
        vec = TfidfVectorizer(stop_words="english", min_df=1)
        mat = vec.fit_transform(sentences)
        sim = (mat @ mat.T).toarray()
        np.fill_diagonal(sim, 0)
        title_sim = (mat @ vec.transform([_normalize(title)]).T).toarray().ravel()
        scores = sim.sum(axis=1) + 0.5 * title_sim
    except ValueError:
        return sentences[:n]

    # Prefer spread: never take two adjacent sentences unless we run out.
    ranked = sorted(range(len(sentences)), key=lambda i: -scores[i])
    picked: list[int] = []
    for i in ranked:
        if len(picked) >= n:
            break
        if any(abs(i - j) <= 1 for j in picked):
            continue
        picked.append(i)
    for i in ranked:  # backfill if adjacency filter was too strict
        if len(picked) >= n:
            break
        if i not in picked:
            picked.append(i)

    out = []
    for i in sorted(picked[:n]):
        s = sentences[i]
        if _word_count(s) > 32:
            s = " ".join(s.split()[:32]).rstrip(",;:") + "…"
        out.append(s)
    return out


# ── Five Ws ─────────────────────────────────────────────────────────────────

_WHEN_RE = re.compile(
    r"\b(?:on|since|last|this|next|early|late)\s+"
    r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|week|month|year|"
    r"January|February|March|April|May|June|July|August|September|October|November|December)\b"
    r"|\b(?:yesterday|today|overnight|this morning|tonight)\b"
    r"|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b",
    re.IGNORECASE)
_WHERE_RE = re.compile(r"\bin ((?:[A-Z][a-zA-Z'-]+,? ?){1,3})")
_WHY_RE = re.compile(r"\b(because|due to|in response to|amid|following|after|citing|prompted by)\b", re.IGNORECASE)
_PROPER_RE = re.compile(r"\b([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})")
_WHERE_STOP = {"The", "A", "An", "But", "And", "It", "He", "She", "They", "This", "That"}


def five_ws(title: str, body: str) -> dict[str, str | None]:
    """Heuristic 5Ws — labeled as approximate in the UI. No NER model needed.
    All matching is per-sentence so phrases never bleed across boundaries."""
    body = _normalize(body)
    sentences = _split_sentences(body)
    lede = sentences[:12]  # the lede carries the 5Ws

    # Who: most frequent proper-noun phrase, skipping each sentence's first word
    counts: dict[str, int] = {}
    for s in lede:
        first_word_end = s.find(" ")
        rest = s[first_word_end + 1:] if first_word_end > 0 else s
        for m in _PROPER_RE.finditer(rest):
            phrase = m.group(1).strip(" ,'-")
            if phrase and phrase.split()[0] not in _WHERE_STOP and len(phrase) > 3:
                counts[phrase] = counts.get(phrase, 0) + 1
    who = max(counts, key=lambda k: (counts[k], len(k))) if counts else None

    what = summarize(title, body, budget=28) or None

    when = where = None
    for s in lede:
        if when is None:
            m = _WHEN_RE.search(s)
            if m:
                when = m.group(0).strip()
        if where is None:
            for m in _WHERE_RE.finditer(s):
                cand = m.group(1).strip(" ,")
                if cand.split()[0] not in _WHERE_STOP:
                    where = cand
                    break
        if when and where:
            break

    why = next((s for s in sentences if _WHY_RE.search(s)), None)
    if why and _word_count(why) > 34:
        why = " ".join(why.split()[:34]).rstrip(",;:") + "…"

    return {"who": who, "what": what, "when": when, "where": where, "why": why}


# ── Ask a question ──────────────────────────────────────────────────────────

def answer_question(question: str, docs: list[tuple[str, str]], top_n: int = 3) -> list[dict]:
    """Extractive answers: rank every sentence across the story's articles by
    TF-IDF cosine to the question. docs = [(source_name, body), ...]."""
    sentences: list[tuple[str, str]] = []
    for source, body in docs:
        for s in _split_sentences(_normalize(body)):
            sentences.append((source, s))
    if not sentences:
        return []

    try:
        vec = TfidfVectorizer(stop_words="english", min_df=1)
        mat = vec.fit_transform([s for _, s in sentences])
        q = vec.transform([question])
        scores = (mat @ q.T).toarray().ravel()
    except ValueError:
        return []

    order = np.argsort(-scores)
    out, seen = [], set()
    for i in order:
        if scores[i] <= 0.05 or len(out) >= top_n:
            break
        src, sent = sentences[i]
        key = sent[:80]
        if key in seen:
            continue
        seen.add(key)
        out.append({"source": src, "sentence": sent, "score": round(float(scores[i]), 3)})
    return out


# ── Crossword ───────────────────────────────────────────────────────────────

_ANSWER_RE = re.compile(r"\b[A-Za-z]{4,9}\b")
_CROSSWORD_STOP = {
    "about", "after", "amid", "over", "under", "with", "from", "into", "their",
    "will", "says", "said", "could", "would", "should", "than", "that", "this",
    "these", "those", "have", "has", "been", "were", "more", "most", "some",
    "what", "when", "where", "which", "while", "against", "because", "before",
    "between", "during", "first", "last", "least", "like", "made", "make",
    "many", "much", "near", "new", "news", "next", "not", "now", "off", "once",
    "only", "other", "out", "part", "people", "report", "still", "such", "take",
    "them", "then", "there", "they", "through", "time", "told", "under", "until",
    "week", "were", "year", "years", "your", "just", "back", "down", "even",
    "ever", "every", "call", "calls", "amid", "among", "despite", "without",
}


def _candidates(headlines: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """(ANSWER, clue) pairs: distinctive words from headlines, clue = blanked headline."""
    seen: set[str] = set()
    out: list[tuple[str, str]] = []
    for title, source in headlines:
        for m in _ANSWER_RE.finditer(title):
            w = m.group(0)
            wl = w.lower()
            if wl in _CROSSWORD_STOP or wl in seen:
                continue
            # Prefer words that carry meaning: proper nouns or 5+ letters
            if not (w[0].isupper() or len(w) >= 5):
                continue
            seen.add(wl)
            clue = title.replace(w, "___", 1)
            out.append((w.upper(), f"{clue} ({source})"))
    return out


def build_crossword(headlines: list[tuple[str, str]], seed: str, target: int = 8) -> dict:
    """Greedy intersection placement on a sparse grid. Deterministic per seed."""
    rng = random.Random(seed)
    cands = _candidates(headlines)
    rng.shuffle(cands)
    cands.sort(key=lambda c: -len(c[0]))  # stable: longest first after shuffle

    grid: dict[tuple[int, int], str] = {}
    entries: list[dict] = []

    def can_place(word: str, r: int, c: int, dr: int, dc: int) -> bool:
        # Cell before/after the word must be empty (no accidental extensions)
        if (r - dr, c - dc) in grid or (r + dr * len(word), c + dc * len(word)) in grid:
            return False
        crossed = False
        for i, ch in enumerate(word):
            cell = (r + dr * i, c + dc * i)
            existing = grid.get(cell)
            if existing is not None:
                if existing != ch:
                    return False
                crossed = True
            else:
                # Perpendicular neighbors must be empty for fresh cells
                p1 = (cell[0] + dc, cell[1] + dr)
                p2 = (cell[0] - dc, cell[1] - dr)
                if p1 in grid or p2 in grid:
                    return False
        return crossed or not grid

    def place(word: str, clue: str) -> bool:
        if not grid:
            for i, ch in enumerate(word):
                grid[(0, i)] = ch
            entries.append({"answer": word, "clue": clue, "row": 0, "col": 0, "dir": "across"})
            return True
        for i, ch in enumerate(word):
            cells = [cell for cell, g in grid.items() if g == ch]
            rng.shuffle(cells)
            for (gr, gc) in cells:
                for dr, dc, dname in ((1, 0, "down"), (0, 1, "across")):
                    r0, c0 = gr - dr * i, gc - dc * i
                    if can_place(word, r0, c0, dr, dc):
                        for j, wch in enumerate(word):
                            grid[(r0 + dr * j, c0 + dc * j)] = wch
                        entries.append({"answer": word, "clue": clue, "row": r0, "col": c0, "dir": dname})
                        return True
        return False

    for word, clue in cands:
        if len(entries) >= target:
            break
        place(word, clue)

    if not entries:
        return {"rows": 0, "cols": 0, "entries": []}

    # Normalize to a 0-based bounding box and number the entries
    min_r = min(e["row"] for e in entries)
    min_c = min(e["col"] for e in entries)
    for e in entries:
        e["row"] -= min_r
        e["col"] -= min_c
    max_r = max(e["row"] + (len(e["answer"]) if e["dir"] == "down" else 1) for e in entries)
    max_c = max(e["col"] + (len(e["answer"]) if e["dir"] == "across" else 1) for e in entries)

    entries.sort(key=lambda e: (e["row"], e["col"]))
    numbered: dict[tuple[int, int], int] = {}
    for e in entries:
        key = (e["row"], e["col"])
        if key not in numbered:
            numbered[key] = len(numbered) + 1
        e["number"] = numbered[key]

    return {"rows": max_r, "cols": max_c, "entries": entries}
