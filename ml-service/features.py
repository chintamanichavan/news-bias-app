import json
import re
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).parent / "data"
NRC_PATH = DATA_DIR / "nrc_lexicon.txt"   # fallback for the emotion lexicon
EMOTION_LEXICON_PATH = DATA_DIR / "emotion_lexicon.json"

# Emotion categories used by SentimentFeatureExtractor (order matters for feature vector)
EMOTION_CATEGORIES = [
    "anger", "fear", "joy", "sadness", "disgust", "trust", "anticipation", "surprise",
]


def _load_emotion_lexicon() -> dict[str, set[str]]:
    """Load the curated per-emotion lexicon. Falls back to NRC if available."""
    if EMOTION_LEXICON_PATH.exists():
        with open(EMOTION_LEXICON_PATH) as f:
            data = json.load(f)
        return {category: {w.lower() for w in words} for category, words in data.items()}

    # Fallback: parse NRC if the curated lexicon is absent
    lex: dict[str, set[str]] = {
        cat: set() for cat in (*EMOTION_CATEGORIES, "positive", "negative", "loaded_language")
    }
    if NRC_PATH.exists():
        with open(NRC_PATH) as f:
            for line in f:
                parts = line.strip().split("\t")
                if len(parts) >= 3 and parts[2] == "1" and parts[1] in lex:
                    lex[parts[1]].add(parts[0].lower())
    return lex


# ── Sentiment ────────────────────────────────────────────────────────────────

class SentimentFeatureExtractor:
    """
    14-dim feature vector for sentiment + intensity prediction:
        [0]    positive density
        [1]    negative density
        [2-9]  per-emotion density (anger, fear, joy, sadness, disgust, trust, anticipation, surprise)
        [10]   all-caps word ratio
        [11]   exclamation ratio (per sentence)
        [12]   question ratio (per sentence)
        [13]   loaded-language hits per 100 words
    """

    N_FEATURES = 14

    def __init__(self):
        self.lex = _load_emotion_lexicon()
        # Ensure all expected categories exist
        for cat in (*EMOTION_CATEGORIES, "positive", "negative", "loaded_language"):
            self.lex.setdefault(cat, set())

    def _word_densities(self, words: list[str], word_count: int) -> dict[str, float]:
        densities = {}
        for cat in (*EMOTION_CATEGORIES, "positive", "negative", "loaded_language"):
            hits = sum(1 for w in words if w in self.lex[cat])
            densities[cat] = hits / word_count
        return densities

    def compute_emotion_breakdown(self, title: str, body: str) -> dict[str, float]:
        """Return normalized emotion scores in [0, 1] for the 8 core emotions."""
        text = f"{title} {body}"
        words = re.findall(r"\b\w+\b", text.lower())
        word_count = max(len(words), 1)

        densities = self._word_densities(words, word_count)
        # Normalize: scale by 100 so a 1% density of an emotion → 1.0 on the bar
        # then clamp to [0, 1]
        return {
            cat: float(min(1.0, densities[cat] * 100))
            for cat in EMOTION_CATEGORIES
        }

    def extract(self, title: str, body: str) -> np.ndarray:
        text = f"{title} {body}"
        words = re.findall(r"\b\w+\b", text.lower())
        word_count = max(len(words), 1)

        densities = self._word_densities(words, word_count)

        caps_words = len(re.findall(r"\b[A-Z]{3,}\b", text))
        caps_ratio = caps_words / word_count

        # Exclamation / question ratios (per sentence)
        sentences = max(text.count(".") + text.count("!") + text.count("?"), 1)
        excl_ratio = text.count("!") / sentences
        q_ratio = text.count("?") / sentences

        # Loaded language hits per 100 words
        loaded_hits = densities["loaded_language"] * 100

        return np.array([
            densities["positive"],
            densities["negative"],
            densities["anger"], densities["fear"], densities["joy"], densities["sadness"],
            densities["disgust"], densities["trust"], densities["anticipation"], densities["surprise"],
            caps_ratio,
            excl_ratio,
            q_ratio,
            loaded_hits,
        ], dtype=np.float32)

    def bootstrap_labels(self, title: str, body: str) -> tuple[float, float]:
        """
        Returns (polarity_continuous in [-1, 1], intensity_raw in [0, ~]).
        Used by SentimentModel.train() to derive bootstrap labels before any user feedback.
        """
        words = re.findall(r"\b\w+\b", f"{title} {body}".lower())
        word_count = max(len(words), 1)
        densities = self._word_densities(words, word_count)

        pos = densities["positive"] * word_count  # un-normalize back to counts
        neg = densities["negative"] * word_count
        polarity = (pos - neg) / (pos + neg + 1.0)

        text = f"{title} {body}"
        sentences = max(text.count(".") + text.count("!") + text.count("?"), 1)
        excl_ratio = text.count("!") / sentences
        caps_words = len(re.findall(r"\b[A-Z]{3,}\b", text))
        caps_ratio = caps_words / word_count

        intensity = (
            0.30 * densities["anger"]
            + 0.20 * densities["fear"]
            + 0.20 * densities["disgust"]
            + 0.15 * caps_ratio
            + 0.15 * excl_ratio
        )
        return float(polarity), float(intensity)
