import asyncio
import time
from contextlib import asynccontextmanager
from typing import Awaitable, Callable

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import evidence
import forecast
import beyond
import lab
import monitor
import odds
import pit
import pricer
import proof
import portfolio
import scorecard
import smallcaps
import tracker
import universe


async def _background_startup():
    # The securities registry backs the Lab's search and the nightly ingest's
    # symbol list.
    try:
        await asyncio.to_thread(universe.seed)
        universe.load()
    except Exception as e:
        print(f"[startup] universe seed failed: {e!r}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    asyncio.create_task(_background_startup())
    yield


app = FastAPI(title="Artha ML Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4321", "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/lab/search")
def lab_search(q: str = Query(..., min_length=1, max_length=40)):
    """Registry search for the Lab; any Yahoo-valid symbol also works raw."""
    return {"results": lab.search(q)}


@app.get("/lab/{symbol}")
async def lab_dossier(symbol: str, days: int = Query(500, ge=60, le=1300)):
    """The full quantitative dossier for one security — any instrument class."""
    sym = symbol.upper()[:20]
    key = f"lab:{sym}:{days}"
    cached = _data_cache.get(key)
    if cached and time.time() - cached[0] < 900:
        return cached[1]
    out = await lab.dossier(sym, days)
    _data_cache[key] = (time.time(), out)
    return out


@app.get("/portfolio")
async def portfolio_report():
    """The merged portfolio-research workspace: watchlist joined with live
    quotes, target allocation, decision log."""
    cached = _data_cache.get("portfolio")
    if cached and time.time() - cached[0] < 300:
        return cached[1]
    tickers = [w["ticker"] for w in portfolio.watchlist()]
    quotes: dict[str, float] = {}
    if tickers:
        try:
            async with httpx.AsyncClient(timeout=15, headers=YAHOO_HEADERS) as client:
                qs = await _fetch_quotes(client, tickers)
            quotes = {q["symbol"]: float(q["price"]) for q in qs if q.get("price") is not None}
        except Exception:
            pass
    out = portfolio.report(quotes)
    _data_cache["portfolio"] = (time.time(), out)
    return out


@app.get("/pit/status")
def pit_status():
    """Snapshot counts per PIT table — the data foundation's heartbeat."""
    return {"tables": pit.tables_present(), "root": str(pit.PIT_ROOT)}


@app.post("/pit/ingest")
async def pit_run_ingest():
    """Kick a full PIT ingest (prices, EDGAR, FRED, GDELT). Long-running."""
    import pit_ingest
    return await pit_ingest.run()


@app.get("/odds")
def odds_on_plan():
    """The Core allocation priced as a distribution: the odds of reaching the
    15% / 20% a year goals over 5, 10 and 15 years, the bad year and the deep
    fall, beside plain index funds. Rebuilt at most daily."""
    cached = _data_cache.get("odds")
    if cached and time.time() - cached[0] < 86_400:
        return cached[1]
    out = odds.odds()
    _data_cache["odds"] = (time.time(), out)
    return out


class WhatIf(BaseModel):
    weights: dict[str, float]


@app.post("/odds/whatif")
def odds_what_if(body: WhatIf):
    """The same pricing for any mix of the Core sleeves, {"region/factor":
    percent}; weights are scaled to add up to 100."""
    try:
        return odds.odds(body.weights)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/scorecard")
def scorecard_cards(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Every S&P 500 member's moat, industry share, growth engine, fragility
    and share discipline, read from its filings as known on `as_of`
    (default today). Rebuilt at most hourly."""
    day = as_of or time.strftime("%Y-%m-%d")
    key = f"scorecard:{day}"
    cached = _data_cache.get(key)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    try:
        out = {"as_of": day, "cards": scorecard.cards(day)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _data_cache[key] = (time.time(), out)
    return out


@app.get("/pricer")
def pricer_prices(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Every non-financial S&P 500 member priced on `as_of` (default today):
    the range of its implied return over 5,000 futures of its sales growth
    and return on capital, against the market's value-weighted figure.
    Rebuilt at most hourly."""
    day = as_of or time.strftime("%Y-%m-%d")
    key = f"pricer:{day}"
    cached = _data_cache.get(key)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    try:
        out = pricer.price(day)
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    _data_cache[key] = (time.time(), out)
    return out


@app.get("/proof")
def proof_result():
    """The last replay of the pricer over every 30 June since 2014: how its
    portfolios did against SPY and against the survivor-biased universe.
    Rebuilt by running proof.py; this only reads the saved result."""
    out = proof.result()
    if out is None:
        raise HTTPException(status_code=404, detail="no replay yet: run proof.py")
    return out


@app.get("/forecast")
def forecast_result():
    """The Fama-MacBeth forecast of yearly returns from company traits, tested
    out of sample over 1, 3 and 5 years. Rebuilt by running forecast.py."""
    out = forecast.result()
    if out is None:
        raise HTTPException(status_code=404, detail="no forecast yet: run forecast.py")
    return out


@app.get("/beyond")
def beyond_result():
    """The moat and no-dilution rules tested outside the S&P 500, and inside
    it for comparison. Rebuilt by running beyond.py."""
    out = beyond.result()
    if out is None:
        raise HTTPException(status_code=404, detail="no result yet: run beyond.py")
    return out


@app.get("/evidence")
def evidence_result():
    """Sixty years of survivor-free returns to each company trait, from Ken
    French's data library. Rebuilt by running evidence.py."""
    out = evidence.result()
    if out is None:
        raise HTTPException(status_code=404, detail="no evidence yet: run evidence.py")
    return out


@app.get("/smallcaps")
def smallcaps_latest():
    """The latest monthly lose-less screen of small companies (smallcaps.py)."""
    out = smallcaps.latest()
    if out is None:
        raise HTTPException(status_code=404, detail="no screen yet: run smallcaps.py")
    return out


@app.get("/smallcaps/record")
def smallcaps_record():
    """The plan as lived since the first list, against IWM. Rebuilt at most
    hourly."""
    cached = _data_cache.get("smallcaps-record")
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    out = smallcaps.performance()
    _data_cache["smallcaps-record"] = (time.time(), out)
    return out


@app.get("/evidence/companies")
def evidence_companies(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Where each S&P 500 member sits in the groups the sixty years of
    evidence were measured on — buybacks, profitability, momentum — and what
    each group earned against the market. Rebuilt at most hourly."""
    day = as_of or time.strftime("%Y-%m-%d")
    key = f"evidence-companies:{day}"
    cached = _data_cache.get(key)
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    try:
        tickers = [c["ticker"] for c in scorecard.cards(day)]
        out = {"as_of": day, "groups": evidence.group_record(),
               "companies": evidence.company_groups(day, tickers)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    _data_cache[key] = (time.time(), out)
    return out


@app.get("/tracker")
def tracker_record():
    """The live record: the rule lists written down each month and how they
    have done since, against SPY and every member. Rebuilt at most hourly."""
    cached = _data_cache.get("tracker")
    if cached and time.time() - cached[0] < 3600:
        return cached[1]
    out = tracker.record()
    _data_cache["tracker"] = (time.time(), out)
    return out


@app.get("/experiments")
def list_experiments(limit: int = Query(20, ge=1, le=100)):
    return {"experiments": monitor.experiments(limit)}


_data_cache: dict[str, tuple[float, dict]] = {}


async def _cached(key: str, ttl: float, fetcher: Callable[[], Awaitable[dict]]) -> dict:
    now = time.time()
    hit = _data_cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    data = await fetcher()
    _data_cache[key] = (now, data)
    return data


YAHOO_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

_yahoo_sem = asyncio.Semaphore(6)


def _compact_chart(symbol: str, payload: dict) -> dict | None:
    try:
        result = payload["chart"]["result"][0]
    except (KeyError, IndexError, TypeError):
        return None
    meta = result.get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = (price - prev) if (price is not None and prev) else None
    change_pct = (change / prev * 100) if (change is not None and prev) else None

    closes: list[float] = []
    try:
        raw = result["indicators"]["quote"][0]["close"]
        closes = [c for c in raw if c is not None][-40:]
    except (KeyError, IndexError, TypeError):
        pass

    return {
        "symbol": meta.get("symbol", symbol),
        "name": meta.get("shortName") or meta.get("longName") or meta.get("symbol", symbol),
        "price": price,
        "previous_close": prev,
        "change": change,
        "change_pct": change_pct,
        "day_high": meta.get("regularMarketDayHigh"),
        "day_low": meta.get("regularMarketDayLow"),
        "volume": meta.get("regularMarketVolume"),
        "currency": meta.get("currency"),
        "exchange": meta.get("fullExchangeName") or meta.get("exchangeName"),
        "instrument_type": meta.get("instrumentType"),
        "spark": closes,
    }


async def _fetch_quote(client: httpx.AsyncClient, symbol: str) -> dict | None:
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    async with _yahoo_sem:
        try:
            r = await client.get(
                url,
                params={"range": "5d", "interval": "1d"},
                headers=YAHOO_HEADERS,
            )
            r.raise_for_status()
            return _compact_chart(symbol, r.json())
        except (httpx.HTTPError, ValueError):
            return None


async def _fetch_quotes(client: httpx.AsyncClient, symbols: list[str]) -> list[dict]:
    if not symbols:
        return []
    results = await asyncio.gather(*[_fetch_quote(client, s) for s in symbols])
    return [q for q in results if q]
