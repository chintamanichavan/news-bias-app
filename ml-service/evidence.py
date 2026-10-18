"""
The evidence — sixty years of which company traits paid, from portfolios
that include every company that failed or was bought.

Artha's own stock-level tests reach back only to 2014 and hold only the
companies that still trade, so they cannot say much about long-term returns
(proof.py, beyond.py). Ken French's data library publishes, free, the
monthly returns of portfolios sorted on each trait, built from the full CRSP
file since July 1963 — dead companies included. Each trait is tested as its
best group minus its worst:

- profitability: operating profitability, top fifth minus bottom (Novy-Marx,
  "The Other Side of Value", Journal of Financial Economics 108, 2013; Fama
  & French, "A Five-Factor Asset Pricing Model", JFE 116, 2015) — and among
  the largest fifth of companies alone, the closest thing to a moat test;
- low_issuance: companies that bought back shares minus the fifth that
  issued most (Pontiff & Woodgate, Journal of Finance 63, 2008; Daniel &
  Titman, "Market Reactions to Tangible and Intangible Information",
  Journal of Finance 61, 2006);
- conservative: the fifth that grew its assets least minus most (Titman, Wei
  & Xie 2004; Fama & French 2015);
- cheapness: highest book-to-market fifth minus lowest (Fama & French, "The
  Cross-Section of Expected Stock Returns", Journal of Finance 47, 1992);
- momentum: last year's top tenth minus bottom, last month skipped
  (Jegadeesh & Titman 1993).

Value-weighted portfolios behave like large companies, equal-weighted like
small ones; both are reported. The t-statistic uses Newey-West standard
errors over twelve months, as monthly returns of these spreads are not quite
independent (Newey & West, Econometrica 55, 1987).
"""

import json
import time

import numpy as np
import pandas as pd

import odds
import pit
import proof
import scorecard

START = "196307"
RECENT = "200701"        # the years value investing struggled
SIGNALS = {
    "profitability": ("Portfolios_Formed_on_OP", "Hi 20", "Lo 20", (0, 1)),
    "profitability_big": ("25_Portfolios_ME_OP_5x5", "BIG HiOP", "BIG LoOP", (0,)),
    "low_issuance": ("Portfolios_Formed_on_NI", "< 0", "Hi 20", (0, 1)),
    "conservative": ("Portfolios_Formed_on_INV", "Lo 20", "Hi 20", (0, 1)),
    "cheapness": ("Portfolios_Formed_on_BE-ME", "Hi 20", "Lo 20", (0, 1)),
    "momentum": ("10_Portfolios_Prior_12_2", "Hi PRIOR", "Lo PRIOR", (0, 1)),
}
WEIGHTING = {0: "value", 1: "equal"}
RESULT = scorecard.DATA / "evidence.json"


def newey_west_t(x: np.ndarray, lags: int = 12) -> float:
    """Mean over its Newey-West standard error."""
    n = len(x)
    e = x - x.mean()
    var = e @ e / n
    for k in range(1, lags + 1):
        var += 2 * (1 - k / (lags + 1)) * (e[k:] @ e[:-k]) / n
    return float(x.mean() / np.sqrt(var / n))


def windows_won(long: pd.Series, short: pd.Series, months: int) -> float:
    """Share of rolling windows of `months` in which the long side grew more."""
    gl = np.log1p(long).rolling(months).sum()
    gs = np.log1p(short).rolling(months).sum()
    ok = gl.notna() & gs.notna()
    return float((gl[ok] > gs[ok]).mean())


def growth(r: pd.Series) -> float:
    return float(np.exp(np.log1p(r).mean() * 12) - 1)


def test(long: pd.Series, short: pd.Series, market: pd.Series) -> dict:
    spread = (long - short).dropna()
    recent = spread[spread.index >= RECENT]
    decades = {}
    for d in range(1960, 2030, 10):
        part = spread[(spread.index >= f"{d}01") & (spread.index < f"{d + 10}01")]
        if len(part) >= 24:
            decades[f"{d}s"] = float(part.mean() * 12)
    return {
        "since": f"{spread.index[0][:4]}-{spread.index[0][4:]}", "months": len(spread),
        "spread_a_year": float(spread.mean() * 12), "t": newey_west_t(spread.to_numpy()),
        "won_5y": windows_won(long, short, 60), "won_10y": windows_won(long, short, 120),
        "recent_a_year": float(recent.mean() * 12), "recent_t": newey_west_t(recent.to_numpy()),
        "best_group_growth": growth(long), "worst_group_growth": growth(short),
        "market_growth": growth(market[market.index.isin(long.index)]),
        "decades": decades,
    }


def run() -> dict:
    started = time.time()
    ff = odds.french("F-F_Research_Data_Factors")
    market = pd.Series({m: v["Mkt-RF"] + v["RF"] for m, v in ff.items()}).sort_index()
    out = {}
    for name, (file, hi, lo, blocks) in SIGNALS.items():
        for b in blocks:
            data = odds.french(file, b)
            months = sorted(m for m in data if m >= START and hi in data[m] and lo in data[m])
            long = pd.Series({m: data[m][hi] for m in months})
            short = pd.Series({m: data[m][lo] for m in months})
            out[f"{name}:{WEIGHTING[b]}"] = {"signal": name, "weighting": WEIGHTING[b],
                                            "long": hi, "short": lo, **test(long, short, market)}
    result = {"run_at": time.strftime("%Y-%m-%d %H:%M"), "seconds": round(time.time() - started),
              "through": max(market.index), "tests": out}
    RESULT.write_text(json.dumps(result, indent=1))
    return result


# ── Where each company sits today ───────────────────────────────────────────
#
# Each company is placed in the groups the sixty years were measured on, and
# shown what that group earned against the market:
# - issuance: last fiscal year's change in diluted share count (read within
#   one filing, so splits do not count). A fall is the buyback group, no
#   change the zero group; French publishes no breakpoints for issuers, so
#   they are split into fifths among the companies here;
# - profitability: operating profit less interest over book equity (French's
#   OP: revenue less cost of goods, SG&A and interest; SG&A in Compustat
#   includes R&D, as operating income does), against his NYSE fifths for the
#   year. Negative book equity is not sorted, as in his portfolios;
# - momentum: the twelve months to the month before, against his NYSE tenths.

GROUPS = {
    "issuance": ("Portfolios_Formed_on_NI", ["< 0", "ZERO", "Lo 20", "Qnt 2", "Qnt 3", "Qnt 4", "Hi 20"]),
    "profitability": ("Portfolios_Formed_on_OP", ["Lo 20", "Qnt 2", "Qnt 3", "Qnt 4", "Hi 20"]),
    "momentum": ("10_Portfolios_Prior_12_2", ["Lo PRIOR", "PRIOR 2", "PRIOR 3", "PRIOR 4", "PRIOR 5",
                                               "PRIOR 6", "PRIOR 7", "PRIOR 8", "PRIOR 9", "Hi PRIOR"]),
}
LABELS = {
    "issuance": ["buys back", "no change", "issues: lowest fifth", "issues: 2nd fifth",
                 "issues: 3rd fifth", "issues: 4th fifth", "issues most"],
    "profitability": ["least profitable fifth", "2nd fifth", "3rd fifth", "4th fifth", "most profitable fifth"],
    "momentum": [f"{i} of 10" for i in range(1, 11)],
}
COMPANIES = scorecard.DATA / "evidence_companies.json"


def group_record() -> dict[str, list[dict]]:
    """Each group's value-weighted growth against the market since 1963 and
    since 2007, and the share of ten-year windows it beat the market."""
    ff = odds.french("F-F_Research_Data_Factors")
    market = pd.Series({m: v["Mkt-RF"] + v["RF"] for m, v in ff.items()}).sort_index()
    out = {}
    for trait, (file, cols) in GROUPS.items():
        data = odds.french(file, 0)
        rows = []
        for col, label in zip(cols, LABELS[trait]):
            r = pd.Series({m: v[col] for m, v in data.items() if m >= START and col in v}).sort_index()
            mkt = market[market.index.isin(r.index)]
            recent = r.index >= RECENT
            rows.append({"group": col, "label": label,
                         "excess": growth(r) - growth(mkt),
                         "excess_recent": growth(r[recent]) - growth(mkt[mkt.index >= RECENT]),
                         "won_10y": windows_won(r, mkt, 120)})
        out[trait] = rows
    return out


def breakpoints(name: str) -> dict[str, list[float]]:
    """{period: the 5th, 10th ... 100th NYSE percentiles, as fractions}."""
    out = {}
    for line in odds.french_text(name).splitlines():
        cells = [c.strip() for c in line.split(",")]
        if cells[0].isdigit() and len(cells) >= 22:
            out[cells[0]] = [float(v) / 100 for v in cells[2:22]]
    return out


def place(value: float, cuts: list[float]) -> int:
    """Index of the group `value` falls in, given the cut-offs between groups."""
    return int(np.searchsorted(cuts, value, side="right"))


def operating_profitability(y: pd.DataFrame) -> float | None:
    last = y.sort_values("year_end").iloc[-1]
    oi, eq = last["operating_income"], last["equity"]
    if pd.isna(oi) or pd.isna(eq) or eq <= 0:
        return None
    return float((oi - (0 if pd.isna(last["interest_expense"]) else last["interest_expense"])) / eq)


def company_groups(as_of: str, tickers: list[str]) -> dict[str, dict]:
    """ticker -> {trait: {index, label, excess, excess_recent, won_10y}} on `as_of`."""
    record = group_record()
    conn = pit.connect()
    years = scorecard.annual(conn, as_of, tickers)
    changes = scorecard.share_changes(conn, as_of, tickers)
    rets = proof.monthly_returns(tickers)
    mom = proof.momentum(rets, as_of)

    day = pd.Timestamp(as_of)
    op_cuts = breakpoints("OP_Breakpoints")
    year = str(day.year if day.month >= 7 else day.year - 1)
    op_year = op_cuts.get(year) or op_cuts[max(op_cuts)]
    op = [op_year[i] for i in (3, 7, 11, 15)]                       # 20th..80th
    mom_cuts = breakpoints("Prior_2-12_Breakpoints")
    month = max(m for m in mom_cuts if m <= day.strftime("%Y%m"))
    mo = [mom_cuts[month][i] for i in range(1, 19, 2)]               # 10th..90th

    last_change = {t: c[-1] for t, c in changes.items() if c}
    issuers = sorted(v for v in last_change.values() if v > 0)
    iss_cuts = [issuers[int(len(issuers) * q / 5)] for q in range(1, 5)] if len(issuers) >= 5 else []

    out = {}
    for t in tickers:
        groups = {}
        c = last_change.get(t)
        if c is not None:
            i = 0 if c < 0 else 1 if c == 0 else 2 + place(c, iss_cuts)
            groups["issuance"] = i
        y = years[years["ticker"] == t]
        p = operating_profitability(y) if len(y) else None
        if p is not None:
            groups["profitability"] = place(p, op)
        if t in mom:
            groups["momentum"] = place(mom[t], mo)
        out[t] = {trait: {"index": i, **record[trait][i]} for trait, i in groups.items()}
    return out


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    r = run()
    for k, v in r["tests"].items():
        print(f"{k:28} {v['spread_a_year']:+.3f} t={v['t']:+.2f} won5y={v['won_5y']:.2f} "
              f"won10y={v['won_10y']:.2f} since2007 {v['recent_a_year']:+.3f} (t {v['recent_t']:+.2f}) "
              f"best {v['best_group_growth']:.3f} worst {v['worst_group_growth']:.3f} mkt {v['market_growth']:.3f}")
