import asyncio
from pathlib import Path

import db

SENTIMENT_MODELS_DIR = Path(__file__).parent / "data" / "models"
SCORE_BATCH = 25  # articles per write transaction

_retraining_bias = False
_retraining_sentiment = False


# ── Sentiment ────────────────────────────────────────────────────────────────

async def check_and_retrain_sentiment(sentiment_model):
    global _retraining_sentiment
    conn = db.get_conn()
    since = db.count_sentiment_feedback_since_last_retrain(conn)
    conn.close()
    if since >= SENTIMENT_RETRAIN_THRESHOLD and not _retraining_sentiment:
        asyncio.create_task(_run_sentiment_retrain(sentiment_model))


async def run_sentiment_bootstrap(sentiment_model):
    conn = db.get_conn()
    if db.has_trained_sentiment_model(conn):
        conn.close()
        return
    articles = db.get_all_articles_with_text(conn)
    conn.close()
    if len(articles) < 10:
        return
    await asyncio.to_thread(_train_and_save_sentiment, sentiment_model, articles, [])


async def _run_sentiment_retrain(sentiment_model):
    global _retraining_sentiment
    _retraining_sentiment = True
    try:
        conn = db.get_conn()
        articles = db.get_all_articles_with_text(conn)
        feedback = db.get_sentiment_feedback(conn)
        conn.close()
        await asyncio.to_thread(_train_and_save_sentiment, sentiment_model, articles, feedback)
    finally:
        _retraining_sentiment = False


def _train_and_save_sentiment(sentiment_model, articles: list[dict], feedback: list[dict]):
    pol_acc, int_acc = sentiment_model.train(articles, feedback)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    conn = db.get_conn()
    version = db.save_sentiment_model_version(
        conn, len(feedback), pol_acc, int_acc,
        str(MODELS_DIR / "sentiment_v_tmp.joblib"),
    )
    file_path = str(MODELS_DIR / f"sentiment_v{version}.joblib")
    conn.execute(
        "UPDATE sentiment_model_versions SET file_path=? WHERE version=?",
        (file_path, version),
    )
    conn.commit()
    conn.close()

    sentiment_model.save(version, file_path)

    # Re-score sentiment for all articles in batches
    for i in range(0, len(articles), SCORE_BATCH):
        batch = articles[i:i + SCORE_BATCH]
        conn = db.get_conn()
        for art in batch:
            polarity, intensity, breakdown = sentiment_model.predict(
                art["title"] or "", art.get("body") or ""
            )
            db.update_article_sentiment(
                conn, art["id"], polarity, intensity, breakdown, version
            )
        conn.commit()
        conn.close()

    print(f"[sentiment retrain] v{version} — polarity_acc={pol_acc}, intensity_acc={int_acc}, articles={len(articles)}")
