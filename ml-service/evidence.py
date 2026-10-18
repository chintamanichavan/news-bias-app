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


def result() -> dict | None:
    return json.loads(RESULT.read_text()) if RESULT.exists() else None


if __name__ == "__main__":
    r = run()
    for k, v in r["tests"].items():
        print(f"{k:28} {v['spread_a_year']:+.3f} t={v['t']:+.2f} won5y={v['won_5y']:.2f} "
              f"won10y={v['won_10y']:.2f} since2007 {v['recent_a_year']:+.3f} (t {v['recent_t']:+.2f}) "
              f"best {v['best_group_growth']:.3f} worst {v['worst_group_growth']:.3f} mkt {v['market_growth']:.3f}")
