import threading
from pathlib import Path

import numpy as np
import joblib
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.metrics import mean_absolute_error

from features import FeatureExtractor

MODELS_DIR = Path(__file__).parent / "data" / "models"
# The five AllSides categories, on the same -2..+2 scale that
# `data/sources.json` labels outlets with. These two lists must stay in step
# with `allsides_score`: `SCORE_BINS` splits a label into a class, and
# `CLASS_SCORES` maps that class back to a score.
#
# They previously assumed a -5..+5 scale, so every source from `left` through
# `lean_right` fell into the single middle bin. The model was then trained on
# two classes (center, right), `model.classes_` held [2, 3], and the expectation
# in `predict` could only ever land in [0, 2.5] — no article could come out
# left-leaning no matter what it said.
CLASS_SCORES = [-2.0, -1.0, 0.0, 1.0, 2.0]
SCORE_BINS = [-1.5, -0.5, 0.5, 1.5]  # boundaries between 5 classes


def _score_to_class(score: float) -> int:
    for i, boundary in enumerate(SCORE_BINS):
        if score < boundary:
            return i
    return len(SCORE_BINS)


class BiasModel:
    def __init__(self):
        self.model: LogisticRegression | None = None
        self.extractor = FeatureExtractor()
        self.version: int = 0
        self._lock = threading.Lock()

    def load_latest(self) -> bool:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        files = sorted(MODELS_DIR.glob("model_v*.joblib"))
        if not files:
            return False
        data = joblib.load(files[-1])
        with self._lock:
            self.model = data["model"]
            self.extractor = data["extractor"]
            self.version = data["version"]
        return True

    def save(self, version: int, file_path: str):
        with self._lock:
            self.version = version
            joblib.dump({"model": self.model, "extractor": self.extractor, "version": version}, file_path)

    def train(self, articles: list[dict], feedback: list[dict]) -> tuple[float | None, float | None]:
        if not articles:
            return None, None

        from feed_manager import SOURCE_MAP

        label_overrides = {f["article_id"]: f["user_score"] for f in feedback}

        X_list = []
        y_list = []
        texts = [f"{a['title']} {a.get('body', '')}" for a in articles]

        extractor = FeatureExtractor()
        extractor.fit(texts)

        for a in articles:
            source_score = SOURCE_MAP.get(a["source_id"], {}).get("allsides_score", 0.0)
            label = label_overrides.get(a["id"], source_score)
            feat = extractor.extract(a["title"] or "", a.get("body") or "", source_score)
            X_list.append(feat)
            y_list.append(_score_to_class(label))

        X = np.array(X_list)
        y = np.array(y_list)

        model = LogisticRegression(
            multi_class="multinomial",
            max_iter=1000,
            C=1.0,
            class_weight="balanced",
            solver="lbfgs",
        )
        model.fit(X, y)

        accuracy: float | None = None
        mae: float | None = None
        try:
            if len(set(y)) > 1:
                scores = cross_val_score(model, X, y, cv=min(3, len(set(y))), scoring="accuracy")
                accuracy = float(scores.mean())
            preds = model.predict(X)
            pred_scores = [CLASS_SCORES[p] for p in preds]
            true_scores = [CLASS_SCORES[c] for c in y]
            mae = float(mean_absolute_error(true_scores, pred_scores))
        except Exception:
            pass

        with self._lock:
            self.model = model
            self.extractor = extractor

        return accuracy, mae

    def predict(self, title: str, body: str, source_score: float) -> tuple[float, float]:
        with self._lock:
            if self.model is None:
                return round(source_score, 2), 0.3

            x = self.extractor.extract(title, body, source_score).reshape(1, -1)
            probs = self.model.predict_proba(x)[0]
            confidence = float(probs.max())
            class_values = [CLASS_SCORES[c] for c in self.model.classes_]
            bias_score = float(np.dot(probs, class_values))

        return round(bias_score, 2), round(confidence, 3)
