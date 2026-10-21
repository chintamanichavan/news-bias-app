import asyncio
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import db
import evidence
import forecast
import beyond
import cache
import lab
import monitor
import odds
import pit
import pricer
import proof
import portfolio
import replay
import scorecard
import smallcaps
import timing
import tracker
import universe

results = cache.ResultCache()


async def _background_startup():
    # The securities registry backs the Lab's search and the nightly ingest's
    # symbol list; then keep the slow results warm.
    try:
        await asyncio.to_thread(universe.seed)
        universe.load()
    except Exception as e:
        print(f"[startup] universe seed failed: {e!r}")
    _keep_research_warm()
    asyncio.create_task(results.warm_forever())


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


HOUR, DAY = 3600, 86_400
# A price shown as current must not be older than this, even while a refresh
# is on its way.
QUOTES_STALE_OK = 600


def _keep_research_warm():
    """The Portfolio page's quality screen keeps its own hourly copy."""
    results.keep_warm("portfolio-screen", HOUR, lambda: asyncio.to_thread(portfolio.refresh_screen))
    for name in COMPANIES_TODAY:
        results.keep_warm(f"{name}:today", HOUR, _today_compute(name))


@app.get("/lab/search")
def lab_search(q: str = Query(..., min_length=1, max_length=40)):
    """Registry search for the Lab; any Yahoo-valid symbol also works raw."""
    return {"results": lab.search(q)}


@app.get("/lab/{symbol}")
async def lab_dossier(symbol: str, days: int = Query(500, ge=60, le=1300)):
    """The full quantitative dossier for one security — any instrument class."""
    sym = symbol.upper()[:20]
    return await results.get(f"lab:{sym}:{days}", 900, 6 * HOUR, lambda: lab.dossier(sym, days))


@app.get("/portfolio")
async def portfolio_report():
    """The merged portfolio-research workspace: watchlist joined with live
    quotes, target allocation, decision log."""
    async def build() -> dict:
        tickers = [w["ticker"] for w in portfolio.watchlist()]
        quotes: dict[str, float] = {}
        if tickers:
            try:
                async with httpx.AsyncClient(timeout=15, headers=YAHOO_HEADERS) as client:
                    qs = await _fetch_quotes(client, tickers)
                quotes = {q["symbol"]: float(q["price"]) for q in qs if q.get("price") is not None}
            except Exception:
                pass
        return await asyncio.to_thread(portfolio.report, quotes)

    return await results.get("portfolio", 300, QUOTES_STALE_OK, build)


@app.get("/replay")
def replay_latest():
    """The last historical replay of the return rule. Served from the saved
    result: a replay is a trial and is logged, so only a deliberate run
    (POST /replay/run) makes a new one."""
    return replay.latest() or {"error": "the replay has not been run yet"}


@app.post("/replay/run")
async def replay_run():
    return await asyncio.to_thread(replay.run)


@app.get("/timing")
def timing_latest():
    """The last run of the timing test: investing every month against waiting
    for a fall. Saved result; POST /timing/run makes a new one."""
    return timing.latest() or {"error": "the timing test has not been run yet"}


@app.post("/timing/run")
async def timing_run():
    await timing.ingest_index()
    return await asyncio.to_thread(timing.run)


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


def _scorecard_on(day: str) -> dict:
    return {"as_of": day, "cards": scorecard.cards(day)}


def _evidence_on(day: str) -> dict:
    tickers = [c["ticker"] for c in scorecard.cards(day)]
    return {"as_of": day, "groups": evidence.group_record(), "companies": evidence.company_groups(day, tickers)}


# The Companies page asks for these three at once; cold they take 7, 17 and
# 8 seconds (measured 2026-10-19). Today's copies are kept warm so no visitor
# waits; a copy up to a day old is served while the next one is built.
COMPANIES_TODAY = {"scorecard": _scorecard_on, "pricer": pricer.price, "evidence-companies": _evidence_on}


def _today_compute(name: str):
    return lambda: asyncio.to_thread(COMPANIES_TODAY[name], time.strftime("%Y-%m-%d"))


async def _companies_data(name: str, as_of: str | None):
    """Today's copy from the warm cache; another day's from the hourly one."""
    try:
        if as_of is None:
            return await results.get(f"{name}:today", HOUR, 23 * HOUR, _today_compute(name))
        key = f"{name}:{as_of}"
        cached = _data_cache.get(key)
        if cached and time.time() - cached[0] < 3600:
            return cached[1]
        out = await asyncio.to_thread(COMPANIES_TODAY[name], as_of)
        _data_cache[key] = (time.time(), out)
        return out
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/scorecard")
async def scorecard_cards(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Every S&P 500 member's moat, industry share, growth engine, fragility
    and share discipline, read from its filings as known on `as_of`
    (default today)."""
    return await _companies_data("scorecard", as_of)


@app.get("/pricer")
async def pricer_prices(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Every non-financial S&P 500 member priced on `as_of` (default today):
    the range of its implied return over 5,000 futures of its sales growth
    and return on capital, against the market's value-weighted figure."""
    return await _companies_data("pricer", as_of)


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
async def evidence_companies(as_of: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")):
    """Where each S&P 500 member sits in the groups the sixty years of
    evidence were measured on — buybacks, profitability, momentum — and what
    each group earned against the market."""
    return await _companies_data("evidence-companies", as_of)


@app.get("/experiments")
def list_experiments(limit: int = Query(20, ge=1, le=100)):
    return {"experiments": monitor.experiments(limit)}


_data_cache: dict[str, tuple[float, dict]] = {}


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
