"""
The long-term screen: what a company's own filed record says about it, as
that record was KNOWN on a given day.

One reading of the record serves two callers. The Portfolio page asks about
today. The replay (replay.py) asks about a day years ago and then checks what
happened next. Both go through Records.assess(), so the replay tests the rule
that is actually in use.

Two rules keep a past reading honest:
- a filing counts only from the day it was filed, and a later restatement of
  the same year replaces the earlier figure only from its own filing day;
- prices after the day are never read.

Share units: prices are stored adjusted for every split since. A per-share
figure is in the share units of the day it was filed, so each one is brought
into today's units by the splits that came after its filing. A split is a
change of units, not news, so using later splits is not looking ahead.
"""

from bisect import bisect_right
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

import pit
import valuation

REVENUE = ("Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax")
NET_INCOME = ("NetIncomeLoss",)
EQUITY = ("StockholdersEquity",)
OPERATING_CASH = ("NetCashProvidedByUsedInOperatingActivities",)
CAPEX = ("PaymentsToAcquirePropertyPlantAndEquipment",)
SHARES = ("WeightedAverageNumberOfDilutedSharesOutstanding",)
EPS = ("EarningsPerShareDiluted",)
DPS_DECLARED = ("CommonStockDividendsPerShareDeclared",)
DIVIDENDS_PAID = ("PaymentsOfDividendsCommonStock", "PaymentsOfDividends")

_PER_SHARE = set(EPS + DPS_DECLARED)   # divided by later splits
_SHARE_COUNT = set(SHARES)             # multiplied by later splits
_TAGS = (REVENUE + NET_INCOME + EQUITY + OPERATING_CASH + CAPEX + SHARES + EPS
         + DPS_DECLARED + DIVIDENDS_PAID)

# The exit multiple is the company's own median P/E over this many years.
PE_HISTORY_YEARS = 10
# A close older than this is not a price for the day asked about.
STALE_DAYS = 10

# "Durable by numbers": a stand-in for a moat, read off the record alone. A
# moat is a judgment about why returns stay high; this only checks that they
# did. Fixed before it was tested (replay.py) — do not tune it to the result.
DURABLE_YEARS = 10       # fiscal years looked at
DURABLE_MIN_YEARS = 8    # fewer than this on record: no verdict
DURABLE_ROE = 15.0       # % return on equity that makes a strong year
DURABLE_STRONG = 0.8     # share of the years that must be strong

NO_VALUATION = {"expected_return_pct": None, "tier": None, "buy_below": None,
                "target_below": None, "fair_value": None, "growth_pct": None,
                "exit_pe": None, "div_yield_pct": None, "to_zone_pct": None,
                "in_zone": False, "suspect": False}


def _day(d) -> int:
    """A date as a day number, so days compare and subtract as plain ints."""
    return pd.Timestamp(d).toordinal()


class Records:
    """Filings, prices, splits and dividends for every company, loaded once
    and read as of any day."""

    def __init__(self, facts: pd.DataFrame, prices: pd.DataFrame,
                 splits: pd.DataFrame, dividends: pd.DataFrame):
        """facts: symbol, tag, unit, period_start, period_end, value, filed_at
        (annual flows, plus StockholdersEquity instants with no period_start).
        prices: symbol, date, close. splits, dividends: symbol, date, value."""
        self._splits = self._by_symbol(splits)
        self._dividends = self._by_symbol(dividends)
        self._prices = {
            sym: (np.array([_day(d) for d in p["date"]], dtype=np.int64),
                  p["close"].to_numpy(dtype=float))
            for sym, p in prices.sort_values("date").groupby("symbol")
        }
        # symbol -> tag -> filings in filing order: (filed, period_end, value, unit)
        self._facts: dict[str, dict[str, list[tuple[int, int, float, str]]]] = {}
        facts = facts.sort_values("filed_at", kind="stable")
        for sym, tag, unit, end, value, filed in zip(
                facts["symbol"], facts["tag"], facts["unit"],
                facts["period_end"], facts["value"], facts["filed_at"]):
            filed_day = _day(filed)
            if tag in _PER_SHARE:
                value /= self._splits_after(sym, filed_day)
            elif tag in _SHARE_COUNT:
                value *= self._splits_after(sym, filed_day)
            self._facts.setdefault(sym, {}).setdefault(tag, []).append(
                (filed_day, _day(end), float(value), unit))
        self.symbols = sorted(s for s in self._facts if s in self._prices)

    @classmethod
    def load(cls, price_years: int | None = None) -> "Records":
        """From the PIT store. `price_years` trims the price history for
        callers that only ask about today."""
        conn = pit.connect()
        tags = ",".join(f"'{t}'" for t in _TAGS)
        facts = conn.execute(f"""
            SELECT symbol, tag, unit, period_start, period_end, value, filed_at
            FROM fundamentals
            WHERE symbol IS NOT NULL AND tag IN ({tags})
              AND ((period_start IS NOT NULL
                    AND date_diff('day', period_start, period_end) BETWEEN 300 AND 400)
                   OR (tag = 'StockholdersEquity' AND period_start IS NULL))
            GROUP BY ALL
            ORDER BY filed_at, max(ingested_at)""").df()
        since = ""
        if price_years:
            since = f"WHERE date >= current_date - INTERVAL {int(price_years)} YEAR"
        prices = conn.execute(f"""
            SELECT symbol, date, close FROM (
              SELECT symbol, date, close, ROW_NUMBER() OVER (
                PARTITION BY symbol, date ORDER BY ingested_at DESC) AS rn
              FROM prices_eod {since}
            ) WHERE rn = 1""").df()
        return cls(facts, prices, pit.corporate_actions(conn, "split"),
                   pit.corporate_actions(conn, "dividend"))

    @staticmethod
    def _by_symbol(actions: pd.DataFrame) -> dict[str, list[tuple[int, float]]]:
        out: dict[str, list[tuple[int, float]]] = {}
        for sym, d, value in zip(actions["symbol"], actions["date"], actions["value"]):
            out.setdefault(sym, []).append((_day(d), float(value)))
        for rows in out.values():
            rows.sort()
        return out

    def _splits_after(self, sym: str, day: int) -> float:
        factor = 1.0
        for split_day, ratio in self._splits.get(sym, ()):
            if split_day > day:
                factor *= ratio
        return factor

    # ── The record as known on a day ─────────────────────────────────────────

    def _known(self, sym: str, tags: tuple[str, ...], day: int,
               unit: str | None = None) -> list[tuple[int, float]]:
        """(period end, value) for each period, oldest first, using only
        filings made on or before `day`. The first tag listed wins a period
        that two tags both report."""
        by_period: dict[int, float] = {}
        for tag in reversed(tags):
            for filed, end, value, fact_unit in self._facts[sym].get(tag, ()):
                if filed > day:
                    break
                if unit is None or fact_unit == unit:
                    by_period[end] = value
        return sorted(by_period.items())

    def _by_year(self, sym, tags, day, unit=None) -> list[tuple[int, float]]:
        return [(date.fromordinal(end).year, v) for end, v in self._known(sym, tags, day, unit)]

    def _latest(self, sym, tags, day) -> float | None:
        known = self._known(sym, tags, day)
        return known[-1][1] if known else None

    def price(self, sym: str, day: int) -> float | None:
        """The last close on or before `day`."""
        days, closes = self._prices[sym]
        i = bisect_right(days, day) - 1
        return float(closes[i]) if i >= 0 else None

    def total_return(self, sym: str, day: int, years: int) -> float | None:
        """What a buyer on `day` earned per year over the next `years`: price
        change plus dividends received, not reinvested. None when the stock
        has no fresh price at either end."""
        end = date.fromordinal(day)
        end = end.replace(year=end.year + years).toordinal()
        days, closes = self._prices[sym]
        i, j = bisect_right(days, day) - 1, bisect_right(days, end) - 1
        if i < 0 or day - days[i] > STALE_DAYS or end - days[j] > STALE_DAYS:
            return None
        dividends = sum(v for d, v in self._dividends.get(sym, ()) if day < d <= end)
        return float(((closes[j] + dividends) / closes[i]) ** (1 / years) - 1)

    def _year_end_close(self, sym: str, year: int, day: int) -> float | None:
        """The last close of calendar `year` that was known by `day`."""
        days, closes = self._prices[sym]
        i = bisect_right(days, min(day, date(year, 12, 31).toordinal())) - 1
        if i < 0 or date.fromordinal(int(days[i])).year != year:
            return None
        return float(closes[i])

    # ── The screen ───────────────────────────────────────────────────────────

    def assess(self, sym: str, as_of=None) -> dict | None:
        """Quality measures and the return-rule valuation for one company on
        one day (today when `as_of` is None). None when it had no annual
        filings or no price by then."""
        day = _day(as_of or datetime.now(timezone.utc).date())
        days, closes = self._prices[sym]
        i = bisect_right(days, day) - 1
        if i < 0 or not self._known(sym, NET_INCOME + REVENUE + EPS, day):
            return None
        last = float(closes[i])
        high_52w = float(closes[max(0, i - 251):i + 1].max())

        ni = self._latest(sym, NET_INCOME, day)
        equity = self._latest(sym, EQUITY, day)
        ocf = self._latest(sym, OPERATING_CASH, day)
        capex = self._latest(sym, CAPEX, day) or 0.0
        rev = self._by_year(sym, REVENUE, day)
        shares = self._by_year(sym, SHARES, day)

        roe = ni / equity * 100 if ni is not None and equity else None
        fcf = ocf - capex if ocf is not None else None
        rev_cagr = None
        if len(rev) >= 4 and rev[0][1] > 0 and rev[-1][1] > 0:
            years = max(1, rev[-1][0] - rev[0][0])
            rev_cagr = ((rev[-1][1] / rev[0][1]) ** (1 / years) - 1) * 100
        dilution = None
        if len(shares) >= 3 and shares[0][1]:
            dilution = (shares[-1][1] / shares[0][1] - 1) * 100

        quality = (roe is not None and roe > 15 and fcf is not None and fcf > 0
                   and rev_cagr is not None and rev_cagr > 5
                   and (dilution is None or dilution <= 5))
        durable = self._durable(sym, day)
        decade_ago = date.fromordinal(day)
        decade_ago = decade_ago.replace(year=decade_ago.year - 10).toordinal()
        ten_year = self.total_return(sym, decade_ago, 10)
        return {
            "ticker": sym, "price": round(last, 2),
            "vs_52w_high_pct": round((last / high_52w - 1) * 100, 1),
            "ten_year_return_pct": round(ten_year * 100, 1) if ten_year is not None else None,
            "roe_pct": round(roe, 1) if roe is not None else None,
            "rev_cagr_pct": round(rev_cagr, 1) if rev_cagr is not None else None,
            "fcf": round(fcf, 0) if fcf is not None else None,
            "dilution_pct": round(dilution, 1) if dilution is not None else None,
            "quality": quality,
            "durable": durable,
            "valuation": self._value(sym, day, last, rev, rev_cagr, shares),
        }

    def _durable(self, sym: str, day: int) -> bool | None:
        """Has the business earned high returns year after year? True when,
        over its last ten fiscal years, return on equity beat DURABLE_ROE in
        at least eight of ten, no year lost money, and the thinnest year's
        profit margin was at least half the usual one. None when the record
        is too short to say."""
        income = self._known(sym, NET_INCOME, day)[-DURABLE_YEARS:]
        equity = dict(self._known(sym, EQUITY, day))
        revenue = dict(self._known(sym, REVENUE, day))
        margins = [ni / revenue[end] for end, ni in income if revenue.get(end, 0) > 0]
        if len(income) < DURABLE_MIN_YEARS or len(margins) < DURABLE_MIN_YEARS:
            return None
        if any(ni <= 0 for _, ni in income):
            return False
        strong = sum(1 for end, ni in income
                     if equity.get(end, 0) > 0 and ni / equity[end] * 100 > DURABLE_ROE)
        usual = sorted(margins)[len(margins) // 2]
        return strong >= DURABLE_STRONG * len(income) and min(margins) >= usual / 2

    def _value(self, sym, day, last, rev, rev_cagr, shares) -> dict | None:
        """The return rule: what does this price imply per year, on the
        company's own record? Growth is the slowest of its records, the exit
        multiple its own decade-median P/E — both capped. Dollar earnings
        only: an ADR that files in yen or yuan cannot be set against its
        dollar price."""
        this_year = date.fromordinal(day).year
        eps = self._by_year(sym, EPS, day, unit="USD/shares")
        eps_base = valuation.base_eps([e for _, e in eps])
        if (len(eps) < 5 or not eps_base
                or eps[-1][0] < this_year - valuation.MAX_EPS_AGE_YEARS):
            return None

        pe_history = []
        for year, e in eps:
            if e > 0 and year >= this_year - PE_HISTORY_YEARS:
                close = self._year_end_close(sym, year, day)
                if close:
                    pe_history.append(close / e)
        if len(pe_history) < 5:
            return None
        pe_history.sort()
        median_pe = pe_history[len(pe_history) // 2]

        eps_cagr = valuation.cagr(eps[0][1], eps[-1][1], eps[-1][0] - eps[0][0])
        rev_recent = (valuation.cagr(rev[-4][1], rev[-1][1], rev[-1][0] - rev[-4][0])
                      if len(rev) >= 4 else None)
        growth = valuation.conservative_growth(
            rev_cagr / 100 if rev_cagr is not None else None, rev_recent, eps_cagr)

        # dividends: the lowest of the last three years, so a special payout
        # is not counted as if it came every year
        declared = self._by_year(sym, DPS_DECLARED, day, unit="USD/shares")
        if declared and declared[-1][0] >= eps[-1][0] - 1:
            dps = min(d for _, d in declared[-3:])
        else:
            paid = self._by_year(sym, DIVIDENDS_PAID, day)
            dps = 0.0
            if paid and shares and shares[-1][1] and paid[-1][0] >= eps[-1][0] - 1:
                dps = max(0.0, min(d for _, d in paid[-3:]) / shares[-1][1])

        ret = valuation.expected_return(last, eps_base, growth, median_pe, dps)
        floor_px = valuation.price_for_return(valuation.MIN_RETURN, eps_base, growth, median_pe, dps)
        target_px = valuation.price_for_return(valuation.TARGET_RETURN, eps_base, growth, median_pe, dps)
        return {
            "expected_return_pct": round(ret * 100, 1) if ret is not None else None,
            "tier": valuation.tier(ret),
            "buy_below": round(floor_px, 2) if floor_px else None,
            "target_below": round(target_px, 2) if target_px else None,
            "fair_value": round(median_pe * eps_base, 2),
            "growth_pct": round(growth * 100, 1),
            "exit_pe": round(min(median_pe, valuation.EXIT_PE_CAP), 1),
            "div_yield_pct": round(dps / last * 100, 2) if last else 0.0,
            "to_zone_pct": round((last / floor_px - 1) * 100, 1) if floor_px else None,
            "in_zone": valuation.tier(ret) is not None,
            "suspect": ret is not None and ret > valuation.MAX_CREDIBLE,
        }


def run() -> list[dict]:
    """Today's screen: every company with a record, each with its quality
    measures, a `quality` verdict and the return-rule valuation fields
    (empty when it cannot be valued). Highest expected return first; names
    with no estimate last."""
    records = Records.load(price_years=PE_HISTORY_YEARS + 1)
    rows = []
    for sym in records.symbols:
        a = records.assess(sym)
        if a is not None:
            val = a.pop("valuation")
            rows.append({**a, "valued": val is not None, **(val or NO_VALUATION)})
    rows.sort(key=lambda r: -(r["expected_return_pct"]
                              if r["expected_return_pct"] is not None else -1e9))
    return rows
