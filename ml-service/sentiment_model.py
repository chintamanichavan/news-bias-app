"""
SentimentModel — mirrors BiasModel but predicts two dimensions:
  - polarity:  -1 (negative) ↔ +1 (positive)
  - intensity:  0 (calm)     ↔  1 (charged / inflammatory)

Plus a per-article emotion breakdown (anger, fear, joy, sadness, disgust,
trust, anticipation, surprise) computed directly from the lexicon.

Bootstrap labels come from lexicon counts (no manual labeling). Each
retrain uses the freshest user feedback per article to override labels.
"""

import threading
from pathlib import Path

import numpy as np
import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score

from features import SentimentFeatureExtractor

MODELS_DIR = Path(__file__).parent / "data" / "models"

# Polarity classes: 0 negative, 1 neutral, 2 positive
POLARITY_CLASS_VALUES = [-1.0, 0.0, 1.0]
POLARITY_BIN_LOW = -0.15
POLARITY_BIN_HIGH = 0.15

# Intensity classes: 0 calm, 1 moderate, 2 charged
INTENSITY_CLASS_VALUES = [0.0, 0.5, 1.0]


def _polarity_to_class(polarity: float) -> int:
    if polarity < POLARITY_BIN_LOW:
        return 0
    if polarity > POLARITY_BIN_HIGH:
        return 2
    return 1


def _percentile_thresholds(values: list[float]) -> tuple[float, float]:
    """
    Return 33rd/66th percentiles of NON-ZERO values, with sensible fallbacks.
    Lexicon hits are sparse, so naively-percentiling zero-heavy data collapses
    the calm boundary to 0 and produces a useless single-class model.
    """
    if not values:
        return 0.005, 0.02
    nonzero = [v for v in values if v > 0]
    if len(nonzero) < max(20, len(values) * 0.1):
        # Too few non-zero values — use absolute fallbacks tuned for sparse lexicons
        return 0.005, 0.02
    arr = np.asarray(nonzero)
    return float(np.percentile(arr, 33)), float(np.percentile(arr, 66))


class SentimentModel:
    def __init__(self):
        self.polarity_clf: LogisticRegression | None = None
        self.intensity_clf: LogisticRegression | None = None
        self.extractor = SentimentFeatureExtractor()
        self.intensity_t33: float = 0.0
        self.intensity_t66: float = 1.0
        self.version: int = 0
        self._lock = threading.Lock()

    def load_latest(self) -> bool:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(MODELS_DIR.glob("sentiment_v*.joblib"))
        if not files:
            return False
        data = joblib.load(files[-1])
        with self._lock:
            self.polarity_clf = data["polarity_clf"]
            self.intensity_clf = data["intensity_clf"]
            self.extractor = data["extractor"]
            self.intensity_t33 = data.get("intensity_t33", 0.0)
            self.intensity_t66 = data.get("intensity_t66", 1.0)
            self.version = data["version"]
        return True

    def save(self, version: int, file_path: str):
        with self._lock:
            self.version = version
            joblib.dump({
                "polarity_clf": self.polarity_clf,
                "intensity_clf": self.intensity_clf,
                "extractor": self.extractor,
                "intensity_t33": self.intensity_t33,
                "intensity_t66": self.intensity_t66,
                "version": version,
            }, file_path)

    def train(self, articles: list[dict],
              feedback: list[dict]) -> tuple[float | None, float | None]:
        """
        articles: [{id, title, body}, ...]
        feedback: [{article_id, dimension, user_score}, ...]
                  dimension is 'sentiment' (polarity in [-1,1])
                  or 'intensity' (in [0,1])
        Returns (polarity_accuracy, intensity_accuracy).
        """
        if not articles:
            return None, None

        extractor = SentimentFeatureExtractor()

        polarity_overrides = {f["article_id"]: f["user_score"]
                              for f in feedback if f.get("dimension") == "sentiment"}
        intensity_overrides = {f["article_id"]: f["user_score"]
                               for f in feedback if f.get("dimension") == "intensity"}

        # ── First pass: bootstrap labels + collect intensity values for percentile thresholds
        X_list: list[np.ndarray] = []
        polarity_labels: list[int] = []
        intensity_raws: list[float] = []
        article_ids: list[str] = []

        for art in articles:
            title = art.get("title") or ""
            body = art.get("body") or ""
            X_list.append(extractor.extract(title, body))
            polarity_continuous, intensity_raw = extractor.bootstrap_labels(title, body)

            # Apply user overrides if present
            if art["id"] in polarity_overrides:
                polarity_continuous = polarity_overrides[art["id"]]
            polarity_labels.append(_polarity_to_class(polarity_continuous))

            intensity_raws.append(intensity_raw)
            article_ids.append(art["id"])

        # ── Compute intensity thresholds from raw bootstrap values
        t33, t66 = _percentile_thresholds(intensity_raws)

        intensity_labels: list[int] = []
        for aid, raw in zip(article_ids, intensity_raws):
            if aid in intensity_overrides:
                v = intensity_overrides[aid]
                cls = 0 if v < 0.33 else (2 if v > 0.66 else 1)
            else:
                cls = 0 if raw <= t33 else (2 if raw > t66 else 1)
            intensity_labels.append(cls)

        X = np.asarray(X_list, dtype=np.float32)
        y_pol = np.asarray(polarity_labels)
        y_int = np.asarray(intensity_labels)

        polarity_clf = LogisticRegression(
            max_iter=1000, C=1.0, class_weight="balanced", solver="lbfgs"
        )
        polarity_clf.fit(X, y_pol)

        intensity_clf = LogisticRegression(
            max_iter=1000, C=1.0, class_weight="balanced", solver="lbfgs"
        )
        intensity_clf.fit(X, y_int)

        # Cross-val accuracy
        pol_acc = int_acc = None
        try:
            if len(set(y_pol)) > 1:
                pol_acc = float(cross_val_score(
                    polarity_clf, X, y_pol, cv=min(3, len(set(y_pol))), scoring="accuracy"
                ).mean())
            if len(set(y_int)) > 1:
                int_acc = float(cross_val_score(
                    intensity_clf, X, y_int, cv=min(3, len(set(y_int))), scoring="accuracy"
                ).mean())
        except Exception:
            pass

        with self._lock:
            self.polarity_clf = polarity_clf
            self.intensity_clf = intensity_clf
            self.extractor = extractor
            self.intensity_t33 = t33
            self.intensity_t66 = t66

        return pol_acc, int_acc

    def predict(self, title: str, body: str) -> tuple[float, float, dict[str, float]]:
        """
        Returns (polarity ∈ [-1,1], intensity ∈ [0,1], emotion_breakdown).
        Falls back to bootstrap labels if no model is loaded yet.
        """
        breakdown = self.extractor.compute_emotion_breakdown(title, body)

        with self._lock:
            if self.polarity_clf is None or self.intensity_clf is None:
                pol_cont, int_raw = self.extractor.bootstrap_labels(title, body)
                # Compress raw intensity into [0, 1] using saved (or default) thresholds
                if self.intensity_t66 > 0:
                    intensity = float(min(1.0, int_raw / max(self.intensity_t66 * 1.5, 1e-3)))
                else:
                    intensity = float(min(1.0, int_raw))
                return round(float(pol_cont), 3), round(intensity, 3), breakdown

            x = self.extractor.extract(title, body).reshape(1, -1)

            pol_probs = self.polarity_clf.predict_proba(x)[0]
            pol_values = [POLARITY_CLASS_VALUES[c] for c in self.polarity_clf.classes_]
            polarity = float(np.dot(pol_probs, pol_values))

            int_probs = self.intensity_clf.predict_proba(x)[0]
            int_values = [INTENSITY_CLASS_VALUES[c] for c in self.intensity_clf.classes_]
            intensity = float(np.dot(int_probs, int_values))

        return round(polarity, 3), round(intensity, 3), breakdown
