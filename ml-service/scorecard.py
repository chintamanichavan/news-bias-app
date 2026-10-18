"""
The company scorecard — what an S&P 500 business's own filings say about its
moat, its share of its industry, its growth engine, its fragility and its
discipline with shares, as the filings were KNOWN on a given day.

It is the first input to pricing a company: the moat decides how long the
business keeps earning above a normal return, so it decides how far ahead
its future is worth counting.

Measures, each from fiscal-year figures filed on or before the day:
- moat: return on invested capital (after a 21% tax; capital read from the
  operating side, so buybacks do not inflate it) in each of the last 10 years; "wide" when it cleared 15% in 8 of every 10 years on record,
  "narrow" when it cleared 10% in 6 of 10. Mauboussin's test: a moat is
  a return above the cost of capital that lasts.
- pricing power: gross margin, its level and how much it moved.
- share: the company's sales over the sales of every S&P 500 member filed
  under the same SIC industry group (first three digits). Filed peers
  only — not true market share.
- growth engine: sales growth, and the share of operating cash reinvested.
- fragility: Altman Z'' (the book-value form, no price needed) and debt
  over operating income.
- discipline: the yearly change in diluted share count.

Where the rules come from (published research; practitioner work is marked):
- Moat as lasting excess return on capital: Mauboussin & Callahan, "Measuring
  the Moat" (Credit Suisse / Morgan Stanley, practitioner, 2013-2024); return
  on capital fades toward the average, slowly for the best: Fama & French,
  "Forecasting Profitability and Earnings", Journal of Business 73 (2000).
- Gross margin as the cleanest read of profitability: Novy-Marx, "The Other
  Side of Value", Journal of Financial Economics 108 (2013).
- Fragility: Altman, "Financial Ratios, Discriminant Analysis and the
  Prediction of Corporate Bankruptcy", Journal of Finance 23 (1968); the
  book-value Z'' form: Altman, Hartzell & Peck (1995).
- Share issuance predicts low returns: Pontiff & Woodgate, "Share Issuance
  and Cross-sectional Returns", Journal of Finance 63 (2008).
- Heavy investment predicts low returns: Titman, Wei & Xie, "Capital
  Investments and Stock Returns", JFQA 39 (2004).

Banks and insurers (SIC 6000-6799) earn on borrowed money, so return on
capital and gross margin say nothing about them; their moat is read from
return on equity instead, and the other measures are left blank.

Industry codes and the member list are today's files, read as if known on
every day — a company's SIC code rarely changes; the member list carries
its own dates.
"""

import asyncio
import io
import json
import time
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

import pit

DATA = Path(__file__).parent / "data" / "scorecard"
MEMBERS_URL = ("https://raw.githubusercontent.com/fja05680/sp500/master/"
               "S%26P%20500%20Historical%20Components%20%26%20Changes%20(Updated).csv")
SEC = {"User-Agent": "Artha Research research@artha.app"}
REFRESH_DAYS = 7

# A company that moved its filings to a new SEC registrant (a new holding
# company) keeps its history under the old one. ticker -> earlier CIKs.
PREDECESSORS = {"XOM": ["0000034088"]}

TAX = 0.21
YEARS = 10
MIN_YEARS = 5            # fewer fiscal years on record: no moat verdict
WIDE = (0.15, 0.8)       # return on capital, share of years
NARROW = (0.10, 0.6)

# Fiscal-year figures the scorecard reads. Where companies file the same
# figure under different tags, the first tag present wins.
TAGS = {
    "revenue": ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax",
                "RevenueFromContractWithCustomerIncludingAssessedTax",
                "RegulatedAndUnregulatedOperatingRevenue", "RevenuesNetOfInterestExpense",
                "SalesRevenueNet"),
    "cost_of_revenue": ("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"),
    "gross_profit": ("GrossProfit",),
    "operating_income": ("OperatingIncomeLoss",),
    # for filers with no operating line (J&J): pretax income plus interest
    "pretax_income": ("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"),
    "interest_expense": ("InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"),
    "net_income": ("NetIncomeLoss",),
    "operating_cash": ("NetCashProvidedByUsedInOperatingActivities",),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"),
    "shares": ("WeightedAverageNumberOfDilutedSharesOutstanding",
               "WeightedAverageNumberOfShareOutstandingBasicAndDiluted"),
    "assets": ("Assets",),
    "liabilities": ("Liabilities",),
    "equity": ("StockholdersEquity",
               "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "cash": ("CashAndCashEquivalentsAtCarryingValue",
             "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"),
    # bonds held as a cash pile are not capital the business runs on
    "short_term_investments": ("MarketableSecuritiesCurrent", "ShortTermInvestments",
                               "AvailableForSaleSecuritiesDebtSecuritiesCurrent"),
    "cash_and_investments": ("CashCashEquivalentsAndShortTermInvestments",),
    "long_term_debt": ("LongTermDebtNoncurrent", "LongTermDebt",
                       "LongTermDebtAndCapitalLeaseObligations"),
    "total_debt": ("DebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount",
                   "LongTermDebtAndCapitalLeaseObligationsIncludingCurrentMaturities"),
    "noncurrent_liabilities": ("LiabilitiesNoncurrent",),
    "current_debt": ("LongTermDebtCurrent", "DebtCurrent"),
    "current_assets": ("AssetsCurrent",),
    "current_liabilities": ("LiabilitiesCurrent",),
    "retained_earnings": ("RetainedEarningsAccumulatedDeficit",),
}
FLOWS = {"revenue", "cost_of_revenue", "gross_profit", "operating_income", "pretax_income",
         "interest_expense", "net_income", "operating_cash", "capex", "shares"}
ALL_TAGS = {t for tags in TAGS.values() for t in tags}


# ── The member list and industry codes ──────────────────────────────────────

def _fresh(path: Path) -> bool:
    return path.exists() and time.time() - path.stat().st_mtime < REFRESH_DAYS * 86400


def membership() -> pd.DataFrame:
    """Dated S&P 500 member lists since 1996: date, tickers (a list)."""
    path = DATA / "sp500_members.csv"
    if not _fresh(path):
        r = httpx.get(MEMBERS_URL, timeout=60, follow_redirects=True)
        r.raise_for_status()
        DATA.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    df["tickers"] = df["tickers"].str.split(",")
    return df.sort_values("date").reset_index(drop=True)


def members(as_of: str) -> list[str]:
    """The S&P 500 on the day, from the last list dated on or before it."""
    df = membership()
    known = df[df["date"] <= pd.Timestamp(as_of)]
    if known.empty:
        raise ValueError(f"no member list on or before {as_of}")
    return sorted(known.iloc[-1]["tickers"])


def sec_ticker(ticker: str) -> str:
    return ticker.replace(".", "-")


def companies() -> dict[str, dict]:
    """ticker -> {cik, sic, industry, name} for every company collected."""
    path = DATA / "companies.json"
    return json.loads(path.read_text()) if path.exists() else {}


# ── Collection ──────────────────────────────────────────────────────────────

def parse_facts(ticker: str, payload: dict) -> pd.DataFrame:
    """The scorecard's tags from an SEC companyfacts payload, one row per
    filed figure, in the fundamentals table's shape."""
    cik = str(payload.get("cik", "")).zfill(10)
    rows = []
    for tag, node in (payload.get("facts", {}).get("us-gaap") or {}).items():
        if tag not in ALL_TAGS:
            continue
        for unit, entries in (node.get("units") or {}).items():
            for e in entries:
                if e.get("end") and e.get("val") is not None and e.get("filed"):
                    rows.append({"cik": cik, "symbol": ticker, "tag": tag, "unit": unit,
                                 "period_start": e.get("start"), "period_end": e["end"],
                                 "value": float(e["val"]), "filed_at": e["filed"]})
    df = pd.DataFrame(rows, columns=["cik", "symbol", "tag", "unit", "period_start",
                                     "period_end", "value", "filed_at"])
    df["period_start"] = pd.to_datetime(df["period_start"], errors="coerce")
    df["period_end"] = pd.to_datetime(df["period_end"])
    df["filed_at"] = pd.to_datetime(df["filed_at"])
    return df[df["filed_at"] >= df["period_end"]]


async def collect(tickers: list[str] | None = None, batch: int = 50,
                  refresh: bool = False) -> dict:
    """Fetch filings and industry codes for every company that has been in
    the S&P 500 since 2009 and is still filed under its ticker. Writes a PIT
    fundamentals snapshot every `batch` companies, so a stop loses little.
    Companies already collected are skipped unless `refresh`."""
    if tickers is None:
        df = membership()
        tickers = sorted({t for ts in df[df["date"] >= "2009-01-01"]["tickers"] for t in ts})
    known = companies()
    todo = [t for t in tickers if refresh or t not in known]
    frames, missing = [], []
    async with httpx.AsyncClient(timeout=60, headers=SEC, follow_redirects=True) as client:
        r = await client.get("https://www.sec.gov/files/company_tickers.json")
        r.raise_for_status()
        cik_by_ticker = {v["ticker"]: str(v["cik_str"]).zfill(10) for v in r.json().values()}
        for i, t in enumerate(todo):
            cik = cik_by_ticker.get(sec_ticker(t))
            if not cik:
                missing.append(t)
                continue
            try:
                sub = (await client.get(f"https://data.sec.gov/submissions/CIK{cik}.json")).json()
                await asyncio.sleep(0.12)
                for c in [*PREDECESSORS.get(t, []), cik]:
                    facts = await client.get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{c}.json")
                    await asyncio.sleep(0.12)
                    facts.raise_for_status()
                    frames.append(parse_facts(t, facts.json()))
                known[t] = {"cik": cik, "sic": str(sub.get("sic") or ""),
                            "industry": sub.get("sicDescription"), "name": sub.get("name")}
            except Exception as e:
                print(f"[scorecard] {t} skipped: {e!r}", flush=True)
                missing.append(t)
            if frames and (len(frames) >= batch or i == len(todo) - 1):
                pit.write_snapshot("fundamentals", pd.concat(frames, ignore_index=True))
                await asyncio.sleep(1.1)   # snapshot ids are stamped to the second
                frames = []
                DATA.mkdir(parents=True, exist_ok=True)
                (DATA / "companies.json").write_text(json.dumps(known, indent=1, sort_keys=True))
                print(f"[scorecard] {i + 1}/{len(todo)} companies", flush=True)
    return {"collected": len(known), "not_filed_under_ticker": sorted(missing)}


# ── Reading the record as it was known ──────────────────────────────────────

def annual(conn, as_of: str, tickers: list[str]) -> pd.DataFrame:
    """Fiscal-year figures known on `as_of`: one row per (ticker, fiscal year
    end), one column per measure in TAGS. A flow counts only over a ~1-year
    period. Each figure is the one FIRST filed: later filings restate for
    reasons not known on the day, and carry most of the filers' tagging
    slips (a quarter tagged as a year, a figure at the wrong scale)."""
    if not tickers:
        return pd.DataFrame()
    q = f"""
        SELECT symbol, tag, period_start, period_end, value FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY symbol, tag, period_start, period_end
            ORDER BY filed_at, ingested_at) AS rn
          FROM fundamentals
          WHERE filed_at <= CAST(? AS TIMESTAMP)
            AND ingested_at <= CAST(? AS TIMESTAMPTZ)
            AND unit IN ('USD', 'shares')
            AND tag IN ({','.join('?' * len(ALL_TAGS))})
            AND symbol IN ({','.join('?' * len(tickers))})
        ) WHERE rn = 1
    """
    # ingested_at is not a look-ahead guard here: the scorecard backfills
    # history today, and filed_at is what dates a figure.
    raw = conn.execute(q, [as_of, "9999-12-31", *sorted(ALL_TAGS), *tickers]).df()
    if raw.empty:
        return pd.DataFrame()
    days = (raw["period_end"] - raw["period_start"]).dt.days
    years = raw[raw["tag"].isin(_flow_tags())]
    years = years[days[years.index].between(350, 380)]
    # A flow's fiscal year is fixed by its end date; balance-sheet figures
    # are read at those same ends.
    ends = years.groupby("symbol")["period_end"].unique()
    # Early snapshots stored flows without their start date; only balance-
    # sheet tags may be read as instants.
    instants = raw[raw["period_start"].isna() & ~raw["tag"].isin(_flow_tags())]
    instants = instants[[e in set(ends.get(s, [])) for s, e in
                         zip(instants["symbol"], instants["period_end"])]]
    rows = pd.concat([years, instants])
    wide = rows.pivot_table(index=["symbol", "period_end"], columns="tag",
                            values="value", aggfunc="last")
    out = pd.DataFrame(index=wide.index)
    for measure, tags in TAGS.items():
        col = pd.Series(np.nan, index=wide.index)
        for t in reversed(tags):          # the first tag present wins
            if t in wide:
                col = wide[t].combine_first(col)
        out[measure] = col
    out["operating_income"] = out["operating_income"].combine_first(
        out["pretax_income"] + out["interest_expense"].fillna(0))
    # Cash on hand: cash plus short-term investments, or the combined line.
    out["cash"] = np.fmax(out["cash"] + out["short_term_investments"].fillna(0),
                          out["cash_and_investments"])
    # Many filers leave out one of equity and total liabilities.
    out["equity"] = out["equity"].combine_first(out["assets"] - out["liabilities"])
    out["liabilities"] = out["liabilities"].combine_first(out["assets"] - out["equity"])
    return out.reset_index().rename(columns={"symbol": "ticker", "period_end": "year_end"})


def share_changes(conn, as_of: str, tickers: list[str]) -> dict[str, list[float]]:
    """Yearly growth in diluted share count, oldest first. Each year's change
    is read from one filing — an annual report states this year and last in
    the same share units — so a stock split never reads as issuance."""
    tags = TAGS["shares"]
    raw = conn.execute(f"""
        SELECT symbol, tag, period_end, value, filed_at FROM fundamentals
        WHERE filed_at <= CAST(? AS TIMESTAMP) AND unit = 'shares'
          AND date_diff('day', period_start, period_end) BETWEEN 350 AND 380
          AND tag IN ({','.join('?' * len(tags))})
          AND symbol IN ({','.join('?' * len(tickers))})
    """, [as_of, *tags, *tickers]).df()
    out: dict[str, list[float]] = {}
    for sym, rows in raw.groupby("symbol"):
        change: dict = {}      # year end -> (filed_at, growth)
        for (_, filed), f in rows.groupby(["tag", "filed_at"]):
            v = f.drop_duplicates("period_end").set_index("period_end")["value"].sort_index()
            for prev, cur in zip(v.index[:-1], v.index[1:]):
                if 300 <= (cur - prev).days <= 430 and v[prev] > 0 and \
                        (cur not in change or filed > change[cur][0]):
                    change[cur] = (filed, v[cur] / v[prev] - 1)
        out[sym] = [g for _, (_, g) in sorted(change.items())]
    return out


def _flow_tags() -> set[str]:
    return {t for m in FLOWS for t in TAGS[m]}


# ── The card ────────────────────────────────────────────────────────────────

def is_financial(sic: str) -> bool:
    return sic.isdigit() and 6000 <= int(sic) <= 6799


def invested_capital(y: pd.DataFrame) -> pd.Series:
    """What the business has tied up in operations: assets less cash less the
    current liabilities that carry no interest (suppliers, customers' deposits).
    Read from the operating side, so buybacks that push book equity below
    zero do not shrink it. Without the current-liability split, the financing
    side: equity plus debt less cash."""
    operating = y["assets"] - y["cash"].fillna(0) - \
        (y["current_liabilities"] - y["current_debt"].fillna(0))
    financing = y["equity"] + debt(y) - y["cash"].fillna(0)
    return operating.combine_first(financing)


def debt(y: pd.DataFrame) -> pd.Series:
    """Borrowings: the total line, else long-term plus current, else — for
    filers that tag debt only under their own labels — every non-current
    liability, which overstates debt and so errs toward saying no."""
    col = lambda c: y[c] if c in y else pd.Series(np.nan, index=y.index)   # noqa: E731
    lt, cur = col("long_term_debt"), col("current_debt")
    parts = (lt.fillna(0) + cur.fillna(0)).where(lt.notna() | cur.notna())
    noncurrent = col("noncurrent_liabilities").combine_first(
        col("liabilities") - col("current_liabilities"))
    return col("total_debt").combine_first(parts).combine_first(noncurrent).fillna(0)


def roic(y: pd.DataFrame) -> pd.Series:
    """Operating income after tax over invested capital."""
    capital = invested_capital(y)
    return (y["operating_income"] * (1 - TAX) / capital).where(capital > 0)


def moat_grade(returns: pd.Series) -> str | None:
    """wide / narrow / none from yearly returns on capital, oldest first.
    A year with no measurable capital counts as a miss."""
    r = returns.tail(YEARS)
    if len(r) < MIN_YEARS:
        return None
    for name, (hurdle, share) in (("wide", WIDE), ("narrow", NARROW)):
        if (r.fillna(-np.inf) >= hurdle).mean() >= share:
            return name
    return "none"


def altman_z2(last: pd.Series) -> float | None:
    """Altman Z'' (1995): above 2.6 safe, below 1.1 distressed."""
    a, l = last["assets"], last["liabilities"]
    parts = [last["current_assets"], last["current_liabilities"],
             last["retained_earnings"], last["operating_income"], last["equity"]]
    if not (a and a > 0 and l and l > 0) or any(pd.isna(p) for p in parts):
        return None
    wc = last["current_assets"] - last["current_liabilities"]
    return float(6.56 * wc / a + 3.26 * last["retained_earnings"] / a
                 + 6.72 * last["operating_income"] / a + 1.05 * last["equity"] / l)


def growth(series: pd.Series, years: int) -> float | None:
    s = series.dropna()
    if len(s) <= years or s.iloc[-1 - years] <= 0 or s.iloc[-1] <= 0:
        return None
    return float((s.iloc[-1] / s.iloc[-1 - years]) ** (1 / years) - 1)


def _num(x) -> float | None:
    return None if x is None or pd.isna(x) or not np.isfinite(x) else float(x)


def card(ticker: str, y: pd.DataFrame, sic: str, shares: list[float] | None = None) -> dict:
    """One company's card from its fiscal years, oldest first."""
    y = y.sort_values("year_end").tail(YEARS + 1)
    last = y.iloc[-1]
    financial = is_financial(sic)
    gross = y["gross_profit"].combine_first(y["revenue"] - y["cost_of_revenue"]) / y["revenue"]
    ret = (y["net_income"] / y["equity"]).where(y["equity"] > 0) if financial else roic(y)
    ret = ret.replace([np.inf, -np.inf], np.nan)
    borrowed = debt(y).iloc[-1]
    reinvest = (y["capex"] / y["operating_cash"]).where(y["operating_cash"] > 0)
    return {
        "ticker": ticker,
        "fiscal_year_end": last["year_end"].date().isoformat(),
        "years": int(len(y)),
        "financial": financial,
        "moat": moat_grade(ret),
        "return_measure": "return on equity" if financial else "return on capital",
        "return_median": _num(ret.tail(YEARS).median()),
        "return_latest": _num(ret.iloc[-1]),
        "return_by_year": [_num(v) for v in ret.tail(YEARS)],
        "gross_margin": None if financial else _num(gross.tail(5).median()),
        "gross_margin_swing": None if financial else _num(gross.tail(YEARS).max() - gross.tail(YEARS).min()),
        "revenue": _num(last["revenue"]),
        "sales_growth_5y": growth(y["revenue"], 5),
        "reinvestment": None if financial else _num(reinvest.tail(5).median()),
        "altman_z": None if financial else altman_z2(last),
        "debt_to_operating_income": None if financial or not last["operating_income"] or last["operating_income"] <= 0
                                    else _num(borrowed / last["operating_income"]),
        "share_change_yearly": _num(np.prod([1 + g for g in shares[-5:]]) ** (1 / len(shares[-5:])) - 1)
                               if shares else None,
    }


def cards(as_of: str) -> list[dict]:
    """Every S&P 500 member on the day that has filings, with its share of
    its industry's member sales."""
    tickers = members(as_of)
    info = companies()
    conn = pit.connect()
    tickers = [t for t in tickers if t in info]
    years = annual(conn, as_of, tickers)
    shares = share_changes(conn, as_of, tickers)
    out = []
    for t, y in years.groupby("ticker"):
        y = y[y["revenue"].notna() | y["net_income"].notna()]
        if not y.empty:
            out.append({**card(t, y, info[t]["sic"], shares.get(t)), "name": info[t]["name"],
                        "sic": info[t]["sic"], "industry": info[t]["industry"]})
    # Share of industry: sales over the sales of members in the same group,
    # each at its latest fiscal year. Stale years (over 18 months old) sit out.
    cutoff = (pd.Timestamp(as_of) - pd.Timedelta(days=548)).date().isoformat()
    by_group: dict[str, list[dict]] = {}
    for c in out:
        if c["revenue"] and c["fiscal_year_end"] >= cutoff:
            by_group.setdefault(c["sic"][:3], []).append(c)
    for c in out:
        peers = by_group.get(c["sic"][:3], [])
        total = sum(p["revenue"] for p in peers)
        c["industry_peers"] = len(peers)
        c["industry_share"] = c["revenue"] / total if c in peers and total else None
    return sorted(out, key=lambda c: c["ticker"])
