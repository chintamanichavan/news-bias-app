"""
Research-grounded scoring channels for the signal engine.

1. Finance lexicon channel — after Loughran & McDonald (2011, J. Finance,
   "When Is a Liability Not a Liability?"): general-purpose sentiment lexicons
   misclassify finance text, so market-vertical text gets scored against
   finance-domain word lists (a compact representative subset of LM's
   positive / negative / uncertainty lists).

2. Social scorer — after Hutto & Gilbert (2014, ICWSM, VADER): short social
   posts need rule-based handling of negation, boosters, ALL-CAPS and
   exclamation emphasis that a news-trained model misses.

3. Disagreement — after Antweiler & Frank (2004, J. Finance, "Is All That
   Talk Just Noise?"): the dispersion of opinions carries information beyond
   the mean; the engine uses it to damp composite confidence.

Related design anchors: Tetlock (2007) for the news channel, Whaley (2000)
for VIX-as-fear-gauge, Baker & Wurgler (2007) for composite construction,
Bollen, Mao & Zeng (2011) for volume-weighted social mood.
"""

import math
import re

# ── Loughran-McDonald style finance lexicon (representative subset) ─────────

LM_POSITIVE = {
    "able", "abundance", "achieve", "achieved", "advantage", "advantageous",
    "attain", "beat", "beneficial", "benefit", "best", "better", "bolster",
    "boom", "boost", "breakthrough", "efficiencies", "efficiency", "enhance",
    "enhanced", "exceed", "exceeded", "excellent", "exceptional", "favorable",
    "gain", "gained", "gains", "great", "greater", "growth", "improve",
    "improved", "improvement", "increase", "innovate", "innovation", "leading",
    "lucrative", "opportunities", "opportunity", "optimistic", "outperform",
    "positive", "profit", "profitability", "profitable", "progress", "rally",
    "rebound", "record", "recover", "recovery", "resilient", "reward",
    "smooth", "stability", "stabilize", "strength", "strengthen", "strong",
    "stronger", "succeed", "success", "successful", "surge", "surged",
    "surpass", "tremendous", "upturn", "win", "winner",
}

LM_NEGATIVE = {
    "abandon", "abrupt", "adverse", "adversely", "against", "aggravate",
    "alarm", "alarming", "bankrupt", "bankruptcy", "breach", "burden",
    "collapse", "concern", "concerned", "concerns", "contraction", "crash",
    "crisis", "critical", "cut", "cuts", "damage", "damages", "decline",
    "declined", "declines", "default", "deficit", "delinquent", "depressed",
    "depression", "deteriorate", "deteriorating", "difficult", "difficulty",
    "disappointing", "disaster", "distress", "downgrade", "downgraded",
    "downturn", "drop", "dropped", "fail", "failed", "failure", "fear",
    "fears", "fraud", "halt", "hurt", "impairment", "inflationary",
    "insolvency", "instability", "lawsuit", "layoff", "layoffs", "liquidation",
    "litigation", "lose", "loss", "losses", "miss", "missed", "negative",
    "panic", "penalties", "penalty", "plunge", "plunged", "poor", "recession",
    "restructuring", "risk", "risks", "selloff", "severe", "shortage",
    "shortfall", "shrink", "slump", "slumped", "stagnant", "strain", "stress",
    "struggle", "struggling", "sued", "suffer", "suffered", "turmoil",
    "uncertain", "unemployment", "unfavorable", "volatile", "volatility",
    "warn", "warned", "warning", "weak", "weaken", "weakened", "weakness",
    "worse", "worsen", "worst", "writedown", "writeoff",
}

LM_UNCERTAINTY = {
    "almost", "ambiguity", "ambiguous", "anticipate", "apparent",
    "approximate", "approximately", "assume", "assumption", "believe",
    "cautious", "conditional", "could", "depend", "depending", "doubt",
    "doubtful", "exposure", "fluctuate", "fluctuation", "indefinite",
    "instability", "may", "maybe", "might", "nearly", "pending", "perhaps",
    "possibility", "possible", "possibly", "precaution", "predict",
    "prediction", "preliminary", "presume", "probable", "probably", "risk",
    "risky", "roughly", "rumors", "seems", "somewhat", "speculate",
    "speculation", "sudden", "suggest", "tentative", "uncertain",
    "uncertainty", "unclear", "unknown", "unpredictable", "unproven",
    "variability", "volatile", "volatility",
}

_WORD_RE = re.compile(r"[a-z']+")


def lm_scores(text: str) -> dict[str, float]:
    """Loughran-McDonald channel: polarity from finance word counts plus an
    uncertainty share. Returns zeros for empty text."""
    words = _WORD_RE.findall((text or "").lower())
    if not words:
        return {"polarity": 0.0, "uncertainty": 0.0, "hits": 0}
    pos = sum(1 for w in words if w in LM_POSITIVE)
    neg = sum(1 for w in words if w in LM_NEGATIVE)
    unc = sum(1 for w in words if w in LM_UNCERTAINTY)
    hits = pos + neg
    polarity = (pos - neg) / hits if hits else 0.0
    return {"polarity": round(polarity, 3),
            "uncertainty": round(unc / len(words), 4),
            "hits": hits}


# ── VADER-style social scorer ───────────────────────────────────────────────

_BOOSTERS = {"very": 0.3, "really": 0.3, "extremely": 0.4, "absolutely": 0.4,
             "so": 0.2, "super": 0.3, "totally": 0.3, "huge": 0.3, "massive": 0.3}
_NEGATORS = {"not", "no", "never", "isnt", "isn't", "wasnt", "wasn't", "dont",
             "don't", "doesnt", "doesn't", "wont", "won't", "cant", "can't",
             "aint", "ain't", "without", "barely", "hardly"}

# Social-finance slang the LM lists never see.
_SOCIAL_POS = {"moon", "mooning", "bullish", "calls", "printing", "ripping",
               "rip", "pump", "pumping", "breakout", "undervalued", "yolo",
               "rocket", "tendies", "diamond", "hodl", "buy", "long", "green"}
_SOCIAL_NEG = {"bearish", "puts", "dump", "dumping", "drilling", "tanking",
               "tank", "bagholder", "bags", "rug", "rugged", "overvalued",
               "short", "sell", "red", "bleed", "bleeding", "capitulate",
               "rekt", "crash", "crashing"}


def social_score(text: str) -> float:
    """Rule-based polarity in [-1, 1] for short social text: lexicon hits with
    negation flips, booster words, and caps/exclamation emphasis."""
    raw = text or ""
    tokens = _WORD_RE.findall(raw.lower())
    if not tokens:
        return 0.0

    score = 0.0
    for i, tok in enumerate(tokens):
        val = 0.0
        if tok in _SOCIAL_POS or tok in LM_POSITIVE:
            val = 1.0
        elif tok in _SOCIAL_NEG or tok in LM_NEGATIVE:
            val = -1.0
        if val == 0.0:
            continue
        window = tokens[max(0, i - 3):i]
        if any(w in _NEGATORS for w in window):
            val = -val * 0.8
        val *= 1.0 + sum(_BOOSTERS.get(w, 0.0) for w in window)
        score += val

    if score == 0.0:
        return 0.0
    # Emphasis: exclamation marks and shouting amplify, VADER-style
    emphasis = 1.0 + min(0.3, 0.1 * raw.count("!"))
    caps_words = sum(1 for w in re.findall(r"\b[A-Z]{3,}\b", raw) if w.isalpha())
    emphasis += min(0.2, 0.05 * caps_words)
    score *= emphasis
    # Squash by length so one hit in a long post stays modest
    return round(max(-1.0, min(1.0, score / math.sqrt(len(tokens)))), 3)


# ── Antweiler-Frank disagreement ────────────────────────────────────────────

def disagreement(sentiments: list[float]) -> float:
    """Std-dev of post sentiments in [0, 1]-ish range; high dispersion means
    the crowd disagrees and the mean deserves less weight."""
    n = len(sentiments)
    if n < 2:
        return 0.0
    mean = sum(sentiments) / n
    var = sum((s - mean) ** 2 for s in sentiments) / (n - 1)
    return round(math.sqrt(var), 3)
