# ClearLens — market & weather signal research

A strictly markets + weather news app wrapped around a multi-channel signal
pipeline. Every text source is scored by a classical ML sentiment engine and
composed into per-security signals across a global universe — built as
research input for systematic trading and long-term investing strategies.
No LLMs in the hot path.

## Signal channels

| Channel | Source | Scoring |
|---|---|---|
| News | RSS (finance + general outlets, scope-filtered) | Sentiment model + Loughran–McDonald finance lexicon (2011) |
| Social | Stocktwits streams; Reddit + Bluesky (blocked from this network, code in place) | Model blended with VADER-style rules (Hutto–Gilbert 2014) |
| Prediction markets | Polymarket (macro/crypto drift) | 24h probability change |
| Vol regime | Yahoo ^VIX | Whaley (2000) fear-gauge mapping |
| Weather risk | NWS active alerts + USGS M4.5+ quakes | Severity-weighted index |

Composites per Baker–Wurgler (2007); social damped by disagreement
(Antweiler–Frank 2004); volume-weighted mood after Bollen et al. (2011).
Snapshots accumulate in `signal_snapshots` every 15 minutes.

## Securities universe

`universe.py` seeds a registry from the SEC's full US-listed roster (~10k
issuers) plus global indices, FX, futures, and crypto. Symbol extraction
(cashtags, tickers, issuer names) runs against the registry, and the engine
scores whichever securities carry signal each cycle — coverage follows the
data, not a watchlist. A broader (paid) universe file can be imported without
touching the pipeline.

## Stack

- **Frontend** — Next.js 14, React 18, Tailwind, shadcn/ui
- **ML service** — FastAPI (`ml-service/main.py`)
- **Engine** — `signal_engine.py` (composites), `sentiment_model.py` (logistic
  regression + emotion features), `finlex.py` (research lexicons/rules)
- **Ingestion** — `feed_manager.py` (RSS), `social_manager.py`,
  `hazards.py`, `signal_manager.py` (Polymarket), `universe.py`
- **Reader features** — `particle.py`: topic tagging, key points, 5Ws,
  extractive Q&A, daily headline crossword

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
Reader feedback (tone/intensity ratings) retrains the sentiment model after
50 ratings. Stocktwits posts arrive with native Bullish/Bearish labels stored
in `social_posts.label` — free supervised data for future retraining.

## Status

Personal research platform. Signals are research output, not financial advice.
