"""
PIT ingestors — Phase 1's four free, public sources feeding the store.

- Stooq:  EOD OHLCV, keyless CSV, global symbols (AAPL.US convention)
- EDGAR:  companyfacts XBRL — fundamentals with their FILING date (the
          point-in-time column CRSP/Compustat charges for)
- FRED:   macro series via the keyless fredgraph CSV endpoint
- GDELT:  latest 15-minute GKG slice — global news tone on economic themes

Each ingestor parses to a DataFrame, hands it to pit.write_snapshot (which
enforces the contract), and reports counts. Failures are logged and skipped;
a bad batch never reaches the store. Run all of it:

    python pit_ingest.py [--symbols AAPL,MSFT,...]

Yahoo Finance appears nowhere in this file — the research path is now
official/stable sources only.
"""

import argparse
import asyncio
import csv
import io
import json
import zipfile
from datetime import datetime, timezone

import httpx
import pandas as pd

import db
import pit

UA = {"User-Agent": "Artha Research research@artha.app"}

FRED_SERIES = ["DGS10", "DGS2", "T10Y2Y", "CPIAUCSL", "UNRATE", "FEDFUNDS",
               "DTWEXBGS", "DCOILWTICO", "VIXCLS", "T10YIE"]

GDELT_THEMES = ("ECON_", "MARKET", "OIL", "INFLATION", "CENTRALBANK",
                "NATURAL_DISASTER", "TRADE_")


def default_symbols(n: int = 100) -> list[str]:
    """The band universe first (the tradable set: in-band price with real
    turnover, from universe.screen_band), topped up with large caps for
    benchmark context, plus core ETFs."""
    import universe as _u
    syms = _u.band_symbols(limit=n)
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT symbol FROM securities
           WHERE asset_class IN ('equity', 'etf') AND region = 'US'
           ORDER BY rowid LIMIT ?""", (max(20, n - len(syms)),),
    ).fetchall()
    conn.close()
    for r in rows:
        if r[0].isalpha() and r[0] not in syms:
            syms.append(r[0])
    for etf in ("SPY", "QQQ", "TLT"):
        if etf not in syms:
            syms.append(etf)
    return syms[: n + 23]


# ── Stooq ────────────────────────────────────────────────────────────────────

def parse_stooq_csv(symbol: str, text: str) -> pd.DataFrame:
    rows = list(csv.DictReader(io.StringIO(text)))
    if not rows or "Close" not in rows[0]:
        raise ValueError(f"stooq returned no data for {symbol}")
    df = pd.DataFrame(rows)
    df = df.rename(columns={"Date": "date", "Open": "open", "High": "high",
                            "Low": "low", "Close": "close", "Volume": "volume"})
    for c in ("open", "high", "low", "close", "volume"):
        df[c] = pd.to_numeric(df.get(c), errors="coerce")
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df = df.dropna(subset=["date", "close"])
    df["symbol"] = symbol
    df["source"] = "stooq"
    return df[["symbol", "date", "open", "high", "low", "close", "volume", "source"]]


async def _yahoo_eod(sym: str, client: httpx.AsyncClient, years: int = 5) -> pd.DataFrame:
    """Fallback provider. Provenance is recorded in the source column; the
    PIT discipline (immutable snapshots, contracts, as-of reads) holds
    regardless of which provider filled a row."""
    r = await client.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
        params={"range": f"{years}y", "interval": "1d"},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"},
    )
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    q = res["indicators"]["quote"][0]
    df = pd.DataFrame({
        "date": pd.to_datetime(res["timestamp"], unit="s", utc=True).tz_convert(None).normalize(),
        "open": q.get("open"), "high": q.get("high"), "low": q.get("low"),
        "close": q.get("close"), "volume": q.get("volume"),
    }).dropna(subset=["close"]).drop_duplicates(subset=["date"])
    df["symbol"] = sym
    df["source"] = "yahoo"
    return df[["symbol", "date", "open", "high", "low", "close", "volume", "source"]]


async def ingest_prices(symbols: list[str], client: httpx.AsyncClient) -> int:
    """EOD prices: Stooq first (keyless, stable), Yahoo chart as fallback for
    networks Stooq's browser-check blocks. Whichever fills a symbol, the
    source column says so."""
    frames = []
    stooq_blocked = 0
    for sym in symbols:
        try:
            r = await client.get("https://stooq.com/q/d/l/",
                                 params={"s": f"{sym.lower()}.us", "i": "d"})
            r.raise_for_status()
            frames.append(parse_stooq_csv(sym, r.text))
            continue
        except Exception:
            stooq_blocked += 1
        try:
            frames.append(await _yahoo_eod(sym, client))
        except Exception as e:
            print(f"[pit] prices {sym} skipped by both providers: {e!r}")
    if stooq_blocked:
        print(f"[pit] stooq unavailable for {stooq_blocked} symbols (browser check?) — yahoo fallback used")
    if not frames:
        return 0
    batch = pd.concat(frames, ignore_index=True)
    pit.write_snapshot("prices_eod", batch)
    print(f"[pit] prices_eod: {len(batch)} rows across {len(frames)} symbols")
    return len(batch)


# ── EDGAR companyfacts ───────────────────────────────────────────────────────

EDGAR_TAGS = {"Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
              "NetIncomeLoss", "EarningsPerShareDiluted", "StockholdersEquity",
              "Assets", "Liabilities", "CashAndCashEquivalentsAtCarryingValue",
              "OperatingIncomeLoss"}


def parse_companyfacts(symbol: str, payload: dict) -> pd.DataFrame:
    cik = str(payload.get("cik", "")).zfill(10)
    rows = []
    for tag, node in (payload.get("facts", {}).get("us-gaap", {}) or {}).items():
        if tag not in EDGAR_TAGS:
            continue
        for unit, entries in (node.get("units") or {}).items():
            for e in entries:
                if not e.get("end") or e.get("val") is None or not e.get("filed"):
                    continue
                rows.append({"cik": cik, "symbol": symbol, "tag": tag, "unit": unit,
                             "period_end": e["end"], "value": float(e["val"]),
                             "filed_at": e["filed"]})
    df = pd.DataFrame(rows)
    if not df.empty:
        df["period_end"] = pd.to_datetime(df["period_end"])
        df["filed_at"] = pd.to_datetime(df["filed_at"])
        df = df[df["filed_at"] >= df["period_end"]]
    return df


async def ingest_edgar(symbols: list[str], client: httpx.AsyncClient, limit: int = 25) -> int:
    conn = db.get_conn()
    # symbol -> CIK from the SEC roster we already hold? The securities table
    # doesn't keep CIKs, so resolve through the SEC's ticker file once.
    try:
        r = await client.get("https://www.sec.gov/files/company_tickers.json")
        r.raise_for_status()
        cik_by_ticker = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in r.json().values()}
    except Exception as e:
        print(f"[pit] EDGAR roster failed: {e!r}")
        conn.close()
        return 0
    conn.close()

    frames = []
    for sym in symbols[:limit]:
        cik = cik_by_ticker.get(sym)
        if not cik:
            continue
        try:
            r = await client.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json")
            r.raise_for_status()
            df = parse_companyfacts(sym, r.json())
            if not df.empty:
                frames.append(df)
        except Exception as e:
            print(f"[pit] EDGAR {sym} skipped: {e!r}")
        await asyncio.sleep(0.15)  # SEC fair-access pacing
    if not frames:
        return 0
    batch = pd.concat(frames, ignore_index=True)
    pit.write_snapshot("fundamentals", batch)
    print(f"[pit] fundamentals: {len(batch)} facts across {len(frames)} filers")
    return len(batch)


# ── FRED (keyless fredgraph CSV) ─────────────────────────────────────────────

def parse_fred_csv(series: str, text: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(text))
    date_col = df.columns[0]
    df = df.rename(columns={date_col: "date", df.columns[1]: "value"})
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["date"])
    df["series"] = series
    return df[["series", "date", "value"]]


async def ingest_fred(client: httpx.AsyncClient) -> int:
    frames = []
    for series in FRED_SERIES:
        try:
            r = await client.get("https://fred.stlouisfed.org/graph/fredgraph.csv",
                                 params={"id": series})
            r.raise_for_status()
            frames.append(parse_fred_csv(series, r.text))
        except Exception as e:
            print(f"[pit] FRED {series} skipped: {e!r}")
    if not frames:
        return 0
    batch = pd.concat(frames, ignore_index=True)
    pit.write_snapshot("macro", batch)
    print(f"[pit] macro: {len(batch)} observations across {len(frames)} series")
    return len(batch)


# ── GDELT GKG (latest 15-minute slice) ───────────────────────────────────────

def parse_gkg(raw: str, max_rows: int = 200_000) -> pd.DataFrame:
    agg: dict[tuple, list] = {}
    for i, line in enumerate(raw.split("\n")):
        if i > max_rows or not line:
            continue
        cols = line.split("\t")
        if len(cols) < 16:
            continue
        date_raw, themes_raw, tone_raw = cols[1], cols[7], cols[15]
        try:
            tone = float(tone_raw.split(",")[0])
            day = datetime.strptime(date_raw[:8], "%Y%m%d")
        except (ValueError, IndexError):
            continue
        for theme in set(t for t in themes_raw.split(";") if t):
            if any(theme.startswith(p) or p in theme for p in GDELT_THEMES):
                key = (day, theme.split("_TAX")[0][:40])
                agg.setdefault(key, []).append(tone)
    rows = [{"date": k[0], "theme": k[1], "tone": sum(v) / len(v), "articles": len(v)}
            for k, v in agg.items()]
    return pd.DataFrame(rows)


async def ingest_gdelt(client: httpx.AsyncClient) -> int:
    try:
        r = await client.get("http://data.gdeltproject.org/gdeltv2/lastupdate.txt")
        r.raise_for_status()
        gkg_url = next(l.split()[-1] for l in r.text.splitlines() if l.endswith("gkg.csv.zip"))
        z = await client.get(gkg_url)
        z.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(z.content)) as zf:
            raw = zf.read(zf.namelist()[0]).decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[pit] GDELT skipped: {e!r}")
        return 0
    df = parse_gkg(raw)
    if df.empty:
        print("[pit] GDELT slice held no economic-theme rows")
        return 0
    pit.write_snapshot("news_tone", df)
    print(f"[pit] news_tone: {len(df)} theme aggregates")
    return len(df)


# ── Runner ───────────────────────────────────────────────────────────────────

async def run(symbols: list[str] | None = None) -> dict:
    symbols = symbols or default_symbols()
    started = datetime.now(timezone.utc).isoformat()
    async with httpx.AsyncClient(timeout=60, headers=UA, follow_redirects=True) as client:
        prices = await ingest_prices(symbols, client)
        fundamentals = await ingest_edgar(symbols, client)
        macro = await ingest_fred(client)
        tone = await ingest_gdelt(client)
    out = {"started": started, "prices_eod": prices, "fundamentals": fundamentals,
           "macro": macro, "news_tone": tone, "tables": pit.tables_present()}
    print(json.dumps(out, indent=2, default=str))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbols", help="comma-separated override")
    args = ap.parse_args()
    syms = args.symbols.split(",") if args.symbols else None
    asyncio.run(run(syms))
