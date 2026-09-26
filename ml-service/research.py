"""
Research bench — model bakeoff on real labeled data.

Stocktwits posts arrive with native Bullish/Bearish tags (stored in
social_posts.label): free supervised data. The bench trains and cross-
validates three classifiers on TF-IDF features of the post text —

  - logistic regression (the production engine's family)
  - a feed-forward neural network (MLP, one hidden layer — deep learning
    at the scale this corpus can support)
  - the VADER-style rule scorer (finlex), as the no-training baseline

and reports accuracy side by side, plus the majority-class floor. The point
is an honest harness: same features, same folds, no cherry-picking. When the
corpus grows past a few thousand labels, this is where a deeper model earns
its way into the engine — or doesn't.
"""

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import cross_val_score
from sklearn.neural_network import MLPClassifier

import db
import finlex

MIN_LABELS = 40


def model_bakeoff() -> dict:
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT title, label FROM social_posts
           WHERE label IN ('Bullish', 'Bearish') AND title IS NOT NULL""",
    ).fetchall()
    conn.close()

    texts = [r["title"] for r in rows]
    y = np.array([1 if r["label"] == "Bullish" else 0 for r in rows])
    n = len(texts)
    if n < MIN_LABELS:
        return {"error": f"only {n} labeled posts so far — need {MIN_LABELS}. "
                         "The ingester collects more every 15 minutes."}

    majority = float(max(y.mean(), 1 - y.mean()))
    vec = TfidfVectorizer(stop_words="english", min_df=2, ngram_range=(1, 2), max_features=4000)
    X = vec.fit_transform(texts)
    cv = min(5, max(2, n // 20))

    def cv_acc(clf) -> float:
        try:
            return float(cross_val_score(clf, X, y, cv=cv, scoring="accuracy").mean())
        except ValueError:
            return float("nan")

    logit_acc = cv_acc(LogisticRegression(max_iter=1000, class_weight="balanced"))
    mlp_acc = cv_acc(MLPClassifier(hidden_layer_sizes=(64,), max_iter=400,
                                   early_stopping=n >= 200, random_state=7))
    rule_pred = np.array([1 if finlex.social_score(t) > 0 else 0 for t in texts])
    rule_acc = float((rule_pred == y).mean())

    def rd(x: float) -> float | None:
        return None if x != x else round(x, 3)

    return {
        "labeled_posts": n,
        "class_balance": {"bullish": round(float(y.mean()), 3), "bearish": round(float(1 - y.mean()), 3)},
        "cv_folds": cv,
        "results": [
            {"model": "Majority-class floor", "accuracy": round(majority, 3), "kind": "baseline"},
            {"model": "Rule scorer (VADER-style)", "accuracy": round(rule_acc, 3), "kind": "rules"},
            {"model": "Logistic regression (TF-IDF)", "accuracy": rd(logit_acc), "kind": "linear"},
            {"model": "Neural net — MLP 64 hidden (TF-IDF)", "accuracy": rd(mlp_acc), "kind": "deep"},
        ],
        "note": ("Labels are Stocktwits' native Bullish/Bearish tags; same features and folds "
                 "for every model. A deeper model joins the engine only when it beats the "
                 "linear one out-of-sample at a corpus size that justifies it."),
    }
