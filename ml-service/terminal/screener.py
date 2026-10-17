"""EQS: one row of measures for every company in the point-in-time store,
for the terminal's screener to filter and sort.

Built from as-filed SEC numbers and stored daily closes, so it covers US
filers only. The expected yearly return is read from the Portfolio page's
own screen (portfolio.valuations), so the two pages never disagree.
"""

import asyncio
from datetime import datetime, timezone

import pandas as pd

import db
import pit
import portfolio
import valuation

from . import web

EPS = "EarningsPerShareDiluted"
REVENUE = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"]
SHARES = "WeightedAverageNumberOfDilutedSharesOutstanding"
DIVIDENDS = ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"]
TRADING_YEAR = 252


def _annual(f: pd.DataFrame) -> pd.DataFrame:
    """Facts covering one fiscal year (300 to 400 days)."""
    flows = f[f["period_start"].notna()].copy()
    days = (flows["period_end"] - flows["period_start"]).dt.days
    return flows[(days >= 300) & (days <= 400)]


def _series(rows: pd.DataFrame, tags: list[str], unit: str | None = None) -> list[tuple[int, float]]:
    """(fiscal year, value) oldest first, one value per year."""
    sub = rows[rows["tag"].isin(tags)]
    if unit:
        sub = sub[sub["unit"] == unit]
    by_year: dict[int, float] = {}
    for end, value in zip(sub["period_end"], sub["value"]):
        by_year[pd.Timestamp(end).year] = float(value)
    return sorted(by_year.items())


def _latest(rows: pd.DataFrame, tag: str) -> float | None:
    sub = rows[rows["tag"] == tag].sort_values("period_end")
    return float(sub["value"].iloc[-1]) if len(sub) else None


def measures(symbol: str, annual: pd.DataFrame, facts: pd.DataFrame, px: pd.DataFrame) -> dict | None:
    """The screener's row for one company, or None without a price."""
    closes = px["close"].to_numpy()
    if len(closes) < 2:
        return None
    last = float(closes[-1])
    year = closes[-TRADING_YEAR:]
    row: dict = {
        "symbol": symbol,
        "price": round(last, 2),
        "chg_1y": round((last / float(closes[-TRADING_YEAR]) - 1) * 100, 1) if len(closes) > TRADING_YEAR else None,
        "vs_high": round((last / float(year.max()) - 1) * 100, 1),
    }

    # only the latest year's per-share figure is used, and the latest
    # filing restates it for any split, so no split adjustment is needed
    eps = _series(annual, [EPS], unit="USD/shares")
    revenue = _series(annual, REVENUE)
    shares = _series(annual, [SHARES])
    net_income = _series(annual, ["NetIncomeLoss"])
    equity = _latest(facts, "StockholdersEquity")

    row["mkt_cap"] = last * shares[-1][1] if shares else None
    row["pe"] = round(last / eps[-1][1], 1) if eps and eps[-1][1] > 0 else None
    row["roe"] = round(net_income[-1][1] / equity * 100, 1) if net_income and equity and equity > 0 else None
    row["margin"] = (round(net_income[-1][1] / revenue[-1][1] * 100, 1)
                     if net_income and revenue and revenue[-1][1] > 0 else None)
    growth = None
    if len(revenue) >= 4:
        growth = valuation.cagr(revenue[-4][1], revenue[-1][1], revenue[-1][0] - revenue[-4][0])
    row["growth"] = round(growth * 100, 1) if growth is not None else None

    paid = _series(annual, DIVIDENDS)
    dps = paid[-1][1] / shares[-1][1] if paid and shares and shares[-1][1] else 0.0
    # no dividend line in the filings is not the same as no dividend
    # (JNJ's filings lack it), so missing stays missing rather than 0%
    row["yield"] = round(dps / last * 100, 2) if dps > 0 else None
    return row


def credible(expected_pct: float | None) -> float | None:
    """The expected return if it is believable. Above valuation.MAX_CREDIBLE
    an estimate is far more likely a data fault (a mis-scaled EPS fact, a
    reused ticker) than a bargain, so it is set aside."""
    if expected_pct is None or expected_pct > valuation.MAX_CREDIBLE * 100:
        return None
    return expected_pct


def _names() -> dict[str, str]:
    conn = db.get_conn()
    try:
        return {r[0]: r[1] for r in conn.execute("SELECT symbol, name FROM securities")}
    finally:
        conn.close()


def build() -> list[dict]:
    now = datetime.now(timezone.utc).isoformat()
    conn = pit.connect()
    facts = pit.fundamentals_asof(conn, now)
    symbols = sorted(facts["symbol"].dropna().unique())
    px = pit.prices_asof(conn, now, symbols=list(symbols))
    annual_by = dict(tuple(_annual(facts).groupby("symbol")))
    facts_by = dict(tuple(facts.groupby("symbol")))
    names = _names()
    valued = portfolio.valuations()
    rows = []
    for symbol, prices in px.groupby("symbol"):
        if symbol not in annual_by:
            continue
        row = measures(symbol, annual_by[symbol], facts_by[symbol], prices.sort_values("date"))
        if row:
            row["name"] = names.get(symbol, symbol)
            raw = valued.get(symbol, {}).get("expected_return_pct")
            row["exp_return"] = credible(raw)
            row["set_aside"] = raw is not None and row["exp_return"] is None
            rows.append(row)
    return rows


async def table() -> dict:
    async def make():
        rows = await asyncio.to_thread(build)
        return {"rows": rows, "set_aside": sum(r["set_aside"] for r in rows),
                "built_at": datetime.now(timezone.utc).isoformat()}
    return await web.cached("eqs", 3600, make)
