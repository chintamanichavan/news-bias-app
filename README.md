# news-bias-app

Reads news feeds, scores articles for political bias and sentiment, and surfaces signals over time. Frontend is a Next.js dashboard; backend is a FastAPI service that owns ingestion, model inference, and signal aggregation.

## Stack

- **Frontend** — Next.js 14, React 18, Tailwind, shadcn/ui, lucide icons
- **ML service** — FastAPI (`ml-service/main.py`)
- **Models** — sentiment + bias classifiers (`sentiment_model.py`, `bias_model.py`)
- **Ingestion** — RSS feed manager (`feed_manager.py`), retraining job (`retrain.py`)
- **Signal aggregation** — `signal_manager.py`

## Run locally

ML service:
```sh
cd ml-service
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:
```sh
cd frontend
pnpm install
pnpm dev
```

## Retraining

```sh
cd ml-service
python retrain.py
```

## Status

Personal experiment exploring whether classical ML can usefully score news bias and sentiment over time, without large LLMs in the hot path.
