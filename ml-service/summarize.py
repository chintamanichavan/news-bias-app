"""
60-word extractive summarizer — LexRank-lite (no iterative PageRank).

Splits an article body into sentences, computes pairwise TF-IDF cosine
similarity, and ranks each sentence by its summed similarity to all others
(centrality proxy). Top-ranked sentences are concatenated in original order
until the word budget (~60 words) is filled.

Pure stdlib + sklearn (already in the project) — no new dependencies.
"""

import re

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

WORD_BUDGET = 60
MIN_WORDS_FOR_RANK = 40   # below this, fall back to first-N
MIN_SENTENCE_WORDS = 4    # one-word fragments are noise

# Split on sentence-ending punctuation followed by whitespace + uppercase. Avoids
# splitting inside "U.S." or "Dr. Smith" because those are followed by lowercase
# or are followed by another capitalized word that's still part of the sentence.
_SENT_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"'])")
_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS.sub(" ", (text or "").strip())


def _word_count(text: str) -> int:
    return len(re.findall(r"\b\w+\b", text))


def _truncate_words(text: str, budget: int) -> str:
    words = text.split()
    if len(words) <= budget:
        return text
    return " ".join(words[:budget]).rstrip(",;:") + "…"


def _split_sentences(text: str) -> list[str]:
    chunks = _SENT_SPLIT.split(text)
    out: list[str] = []
    for c in chunks:
        c = c.strip()
        if _word_count(c) >= MIN_SENTENCE_WORDS:
            out.append(c)
    return out


def summarize(title: str, body: str, budget: int = WORD_BUDGET) -> str:
    """Return a budget-word summary. Falls back to first-N words for short bodies."""
    body = _normalize(body)
    if not body:
        return _truncate_words(_normalize(title), budget)

    total_words = _word_count(body)
    if total_words <= budget:
        return body

    sentences = _split_sentences(body)
    # Not enough usable sentences to rank — just take the first chunk
    if len(sentences) < 3 or total_words < MIN_WORDS_FOR_RANK:
        return _truncate_words(body, budget)

    try:
        vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 1), min_df=1)
        mat = vec.fit_transform(sentences)
        sim = (mat @ mat.T).toarray()
        np.fill_diagonal(sim, 0)
        # Boost sentences that share vocabulary with the title — they're more
        # likely to be on-topic rather than a tangent.
        title_vec = vec.transform([_normalize(title)])
        title_sim = (mat @ title_vec.T).toarray().ravel()
        scores = sim.sum(axis=1) + 0.5 * title_sim
    except ValueError:
        return _truncate_words(body, budget)

    ranked_idx = sorted(range(len(sentences)), key=lambda i: -scores[i])

    # Pick highest-scoring sentences in original document order until we have
    # enough content. We over-fill (past the budget) when needed so we can
    # truncate cleanly at the end — earlier this loop broke after a single
    # short sentence got picked, producing 8-word "summaries" of 8000-char bodies.
    min_target = max(int(budget * 0.75), 30)
    picked: set[int] = set()
    words_so_far = 0
    for i in ranked_idx:
        s_words = _word_count(sentences[i])
        # Keep filling until we've cleared the floor; only then bail on overshoot
        if words_so_far >= min_target and words_so_far + s_words > budget * 1.4:
            break
        picked.add(i)
        words_so_far += s_words
        if words_so_far >= budget:
            break

    out = " ".join(sentences[i] for i in sorted(picked))
    if _word_count(out) > budget:
        out = _truncate_words(out, budget)
    return out
