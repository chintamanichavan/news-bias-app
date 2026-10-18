# Artha — a personal investment statistician

Artha prices the S&P 500's businesses from their SEC filings and tests,
against free public data, which company traits have paid over the long run.
It has five pages:

| Page | What it shows |
|---|---|
| Companies | Every S&P 500 member: moat, return on capital, industry share, growth, Altman Z, share discipline; the implied return and value a share from 5,000 simulated futures; and the buyback, profitability and momentum groups each company sits in |
| Portfolio | The research workspace's watchlist against live prices, the target allocation, the replay of the return rule and the timing test |
| Odds | The allocation priced as a distribution: the odds of reaching 15% or 20% a year over 5, 10 and 15 years |
| Proof | Whether any of it has worked: the live forward record, sixty years of survivor-free evidence from Ken French's data library, and every backtest with its caveats |
| Lab | A statistical dossier for any security (reached from Portfolio) |

## Data

All free and public: SEC companyfacts and submissions (filings as first
filed, so the past reads as it was known), Yahoo daily prices with splits
and dividends, FRED, Ken French's data library, and the fja05680 S&P 500
membership history. Prices and filings land in a point-in-time parquet
store (`ml-service/pit.py`), read through DuckDB.

## Modules

- `scorecard.py` — each company's record from its filings
- `pricer.py` — implied return and value a share over simulated futures
- `evidence.py` — sixty years of trait returns; each company's groups
- `proof.py`, `forecast.py`, `beyond.py` — the backtests, with their caveats
- `tracker.py` — the live record: monthly snapshots, committed to `ml-service/record/`
- `odds.py` — the allocation priced as a distribution
- `pit_ingest.py` — the nightly ingest

## Run

```sh
cd ml-service && pip install -r requirements.txt -r requirements-dev.txt && uvicorn main:app --port 8421
cd frontend && pnpm install && pnpm build && pnpm start -p 4321
```

On this machine both run as user systemd units, with timers for the nightly
ingest and the monthly live-record snapshot: see `ops/systemd/README.md`.

## Tests

```sh
pytest ml-service/tests -q   # offline: no network calls in the suite
```

## Status

Personal research platform. Not financial advice.
