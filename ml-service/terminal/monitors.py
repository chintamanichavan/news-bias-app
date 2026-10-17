"""Market-wide monitors: WEIF (index futures against spot), GMM (the day's
moves across markets in standard deviations), IRR (world indices ranked by
calendar-year return), MRV (valuation by country from country ETFs), CRYP
(crypto), FX24 (currency moves by trading session) and HALT (trading
halts). All from Yahoo except HALT, which is Nasdaq Trader's public feed.
"""

import asyncio
import statistics
import xml.etree.ElementTree as ET

from . import movers, quotes, returns, web

INDEX_FUTURES = [  # future, spot, name, contract multiplier note
    ("ES=F", "^GSPC", "S&P 500 E-mini"), ("NQ=F", "^NDX", "Nasdaq-100 E-mini"), ("YM=F", "^DJI", "Dow E-mini"),
    ("RTY=F", "^RUT", "Russell 2000 E-mini"), ("NIY=F", "^N225", "Nikkei 225 (yen, CME)"),
]

MACRO = [
    ("^GSPC", "S&P 500", "Equity"), ("^NDX", "Nasdaq-100", "Equity"), ("^RUT", "Russell 2000", "Equity"),
    ("^STOXX50E", "Euro Stoxx 50", "Equity"), ("^FTSE", "FTSE 100", "Equity"), ("^GDAXI", "DAX", "Equity"),
    ("^N225", "Nikkei 225", "Equity"), ("^HSI", "Hang Seng", "Equity"), ("000001.SS", "Shanghai", "Equity"),
    ("^BSESN", "Sensex", "Equity"), ("^BVSP", "Bovespa", "Equity"),
    ("EURUSD=X", "Euro", "Currency"), ("JPY=X", "Dollar-yen", "Currency"), ("GBPUSD=X", "Sterling", "Currency"),
    ("CNY=X", "Dollar-yuan", "Currency"), ("AUDUSD=X", "Australian dollar", "Currency"), ("MXN=X", "Dollar-peso", "Currency"),
    ("^IRX", "US 3-month bill", "Rates"), ("^FVX", "US 5-year", "Rates"), ("^TNX", "US 10-year", "Rates"), ("^TYX", "US 30-year", "Rates"),
    ("CL=F", "WTI crude", "Commodity"), ("BZ=F", "Brent", "Commodity"), ("NG=F", "Natural gas", "Commodity"),
    ("GC=F", "Gold", "Commodity"), ("SI=F", "Silver", "Commodity"), ("HG=F", "Copper", "Commodity"),
    ("ZC=F", "Corn", "Commodity"), ("ZW=F", "Wheat", "Commodity"), ("ZS=F", "Soybeans", "Commodity"),
    ("BTC-USD", "Bitcoin", "Crypto"), ("ETH-USD", "Ether", "Crypto"), ("^VIX", "VIX", "Volatility"),
]

WORLD_INDICES = [
    ("^GSPC", "S&P 500", "US"), ("^DJI", "Dow Jones", "US"), ("^IXIC", "Nasdaq Composite", "US"), ("^RUT", "Russell 2000", "US"),
    ("^GSPTSE", "S&P/TSX", "Canada"), ("^BVSP", "Bovespa", "Brazil"), ("^MXX", "IPC", "Mexico"),
    ("^FTSE", "FTSE 100", "UK"), ("^GDAXI", "DAX", "Germany"), ("^FCHI", "CAC 40", "France"), ("^STOXX50E", "Euro Stoxx 50", "Euro area"),
    ("^IBEX", "IBEX 35", "Spain"), ("FTSEMIB.MI", "FTSE MIB", "Italy"), ("^AEX", "AEX", "Netherlands"), ("^SSMI", "SMI", "Switzerland"),
    ("^N225", "Nikkei 225", "Japan"), ("^HSI", "Hang Seng", "Hong Kong"), ("000001.SS", "Shanghai Composite", "China"),
    ("^KS11", "KOSPI", "South Korea"), ("^TWII", "Taiex", "Taiwan"), ("^BSESN", "Sensex", "India"), ("^AXJO", "ASX 200", "Australia"),
    ("^STI", "Straits Times", "Singapore"), ("^JN0U.JO", "JSE Top 40", "South Africa"),
]

COUNTRY_ETFS = [
    ("SPY", "United States"), ("EWC", "Canada"), ("EWW", "Mexico"), ("EWZ", "Brazil"), ("EWU", "United Kingdom"),
    ("EWG", "Germany"), ("EWQ", "France"), ("EWI", "Italy"), ("EWP", "Spain"), ("EWN", "Netherlands"), ("EWL", "Switzerland"),
    ("EWD", "Sweden"), ("EWJ", "Japan"), ("MCHI", "China"), ("EWH", "Hong Kong"), ("EWY", "South Korea"), ("EWT", "Taiwan"),
    ("INDA", "India"), ("EWA", "Australia"), ("EWS", "Singapore"), ("EZA", "South Africa"), ("EEM", "Emerging markets"),
    ("EFA", "Developed ex-US"),
]

FX_PAIRS = ["EURUSD=X", "JPY=X", "GBPUSD=X", "AUDUSD=X", "CAD=X", "CHF=X"]
SESSIONS = [("Asia", 0, 7), ("Europe", 7, 13), ("Americas", 13, 21)]   # UTC hours, start inclusive, end exclusive

HALTS = "https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts"


def z_move(closes: list[float]) -> dict | None:
    """Today's move against the past year's daily moves: the move in percent
    and in standard deviations of daily percent moves."""
    if len(closes) < 60:
        return None
    moves = [(b / a - 1) * 100 for a, b in zip(closes, closes[1:]) if a]
    today, past = moves[-1], moves[-253:-1]
    sd = statistics.stdev(past)
    return {"change_pct": today, "sd_pct": sd, "z": today / sd if sd else None}


def calendar_returns(rows: list[dict]) -> dict[int, float]:
    """Price return per calendar year, from each year's last close."""
    last: dict[int, float] = {}
    for r in rows:
        last[int(r["date"][:4])] = r["close"]
    years = sorted(last)
    return {y: (last[y] / last[p] - 1) * 100 for p, y in zip(years, years[1:])}


def session_of(stamp: str, offset_hours: float) -> str | None:
    """Trading session of a bar stamped in local exchange time."""
    h = (int(stamp[11:13]) + int(stamp[14:16]) / 60 - offset_hours) % 24
    for name, start, end in SESSIONS:
        if start <= h < end:
            return name
    return None


def session_moves(bars: list[dict], offset_hours: float) -> dict[str, dict]:
    """Average absolute and net percent move in each session, bar by bar."""
    acc: dict[str, list[float]] = {n: [] for n, _, _ in SESSIONS}
    for a, b in zip(bars, bars[1:]):
        s = session_of(b["date"], offset_hours)
        if s and a["close"]:
            acc[s].append((b["close"] / a["close"] - 1) * 100)
    days = len({b["date"][:10] for b in bars}) or 1
    return {s: {"net_pct": sum(v), "per_day_abs_pct": sum(abs(x) for x in v) / days} for s, v in acc.items()}


def parse_halts(xml: str) -> list[dict]:
    root = ET.fromstring(xml.lstrip("﻿"))
    ns = {"ndaq": "http://www.nasdaqtrader.com/"}
    out = []
    for item in root.iter("item"):
        def get(tag):
            e = item.find(f"ndaq:{tag}", ns)
            return e.text.strip() if e is not None and e.text else None
        out.append({"symbol": get("IssueSymbol"), "name": get("IssueName"), "market": get("Market"),
                    "reason": get("ReasonCode"), "halt_date": get("HaltDate"), "halt_time": get("HaltTime"),
                    "resume_quote_time": get("ResumptionQuoteTime"), "resume_trade_time": get("ResumptionTradeTime")})
    return out


HALT_CODES = {
    "T1": "News pending", "T2": "News released", "T3": "News and resumption times", "T5": "Single-stock pause (volatility)",
    "T6": "Extraordinary market activity", "T7": "Quotation-only period", "T8": "ETF halt", "T12": "Additional information requested",
    "H4": "Non-compliance", "H9": "Not current in filings", "H10": "SEC trading suspension", "H11": "Regulatory concern",
    "LUDP": "Volatility pause (limit up-limit down)", "LUDS": "Volatility pause, straddle", "MWC1": "Market-wide circuit breaker level 1",
    "MWC2": "Market-wide circuit breaker level 2", "MWC3": "Market-wide circuit breaker level 3", "IPO1": "IPO not yet trading",
    "M1": "Corporate action", "M2": "Quotation not available", "D": "Security deleted",
}


async def weif() -> dict:
    got = await quotes.quotes([s for f, sp, _ in INDEX_FUTURES for s in (f, sp)])
    rows = []
    for fut, spot, name in INDEX_FUTURES:
        f, s = got.get(fut), got.get(spot)
        if not f:
            continue
        rows.append({"future": fut, "spot": spot, "name": name, "future_price": f["price"], "future_change_pct": f["change_pct"],
                     "spot_price": s["price"] if s else None, "spot_change_pct": s["change_pct"] if s else None,
                     "basis": f["price"] - s["price"] if s else None,
                     "premium_pct": (f["price"] / s["price"] - 1) * 100 if s else None})
    return {"rows": rows, "missing": "European and other Asian index futures (Euro Stoxx 50, DAX, FTSE, Hang Seng) are not on Yahoo."}


async def gmm() -> dict:
    async def make():
        bars = await asyncio.gather(*(returns.bars(sym, "2y") for sym, _, _ in MACRO), return_exceptions=True)
        rows = []
        for (sym, name, kind), b in zip(MACRO, bars):
            if isinstance(b, Exception) or not b:
                continue
            z = z_move([x["close"] for x in b])
            if z:
                rows.append({"symbol": sym, "name": name, "kind": kind, "last": b[-1]["close"], "date": b[-1]["date"], **z})
        rows.sort(key=lambda r: -abs(r["z"] or 0))
        return {"rows": rows}
    return await web.cached("gmm", 600, make)


async def irr() -> dict:
    async def make():
        bars = await asyncio.gather(*(returns.bars(sym, "10y") for sym, _, _ in WORLD_INDICES), return_exceptions=True)
        rows = []
        for (sym, name, country), b in zip(WORLD_INDICES, bars):
            if isinstance(b, Exception) or not b:
                continue
            rows.append({"symbol": sym, "name": name, "country": country, "years": calendar_returns(b),
                         "ytd": (b[-1]["close"] / next((r["close"] for r in reversed(b) if r["date"][:4] < b[-1]["date"][:4]), b[0]["close"]) - 1) * 100})
        return {"rows": rows}
    return await web.cached("irr", 3600, make)


async def mrv() -> dict:
    got = await quotes.quotes([s for s, _ in COUNTRY_ETFS])
    rows = []
    for sym, country in COUNTRY_ETFS:
        q = got.get(sym)
        if q:
            rows.append({"symbol": sym, "country": country, "pe": q["pe"], "dividend_yield": q["dividend_yield"],
                         "price_to_book": q["price_to_book"], "change_52w_pct": q["change_52w_pct"], "change_pct": q["change_pct"]})
    return {"rows": rows}


async def crypto() -> dict:
    async def make():
        async with web.client() as c:
            return {"rows": await movers._screen(c, "all_cryptocurrencies_us", 50)}
    return await web.cached("cryp", 120, make)


async def fx24() -> dict:
    async def make():
        out = []
        for pair in FX_PAIRS:
            async with web.client() as c:
                r = await c.get(returns.CHART.format(symbol=pair), params={"range": "1mo", "interval": "30m"})
                r.raise_for_status()
                payload = r.json()
            offset = payload["chart"]["result"][0]["meta"].get("gmtoffset", 0) / 3600
            bars = returns.parse_intraday(payload)
            out.append({"pair": pair.replace("=X", ""), "sessions": session_moves(bars, offset), "bars": len(bars)})
        return {"pairs": out, "sessions": [{"name": n, "utc": f"{s:02d}:00–{e:02d}:00"} for n, s, e in SESSIONS]}
    return await web.cached("fx24", 1800, make)


async def halts() -> dict:
    async def make():
        async with web.client() as c:
            r = await c.get(HALTS)
            r.raise_for_status()
            rows = parse_halts(r.text)
        for h in rows:
            h["reason_text"] = HALT_CODES.get(h["reason"] or "", h["reason"])
        return {"rows": rows}
    return await web.cached("halts", 60, make)
