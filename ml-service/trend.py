"""
Buying at a better time — a trend rule on small caps.

timing.py found that holding money back for a fall did not pay on the
S&P 500. This tests the other common rule: hold small caps only while they
are above their 10-month average, else Treasury bills (Faber, "A
Quantitative Approach to Tactical Asset Allocation", Journal of Wealth
Management, 2007), and the 12-month version (absolute momentum: hold while
the last year beat bills). Decided at each month-end, acted on the next
month, COST per switch.

Small caps are French's smallest fifth by size, equal-weighted, from July
1926, survivor-free; bills are French's RF. Borrowed money costs bills plus
SPREAD.
"""

import numpy as np
import pandas as pd

import monitor
import odds

COST = 0.005                  # each switch in or out
SPREAD = 0.01                 # a year over bills, to borrow
STARTS = ("192607", "196307", "199001")


def series() -> tuple[pd.Series, pd.Series]:
    d = odds.french("Portfolios_Formed_on_ME", 1)
    f = odds.french("F-F_Research_Data_Factors", 0)
    m = sorted(set(d) & set(f))
    return (pd.Series([d[k]["Lo 20"] for k in m], index=m),
            pd.Series([f[k]["RF"] for k in m], index=m))


def stats(r: pd.Series, base: pd.Series) -> dict:
    w = (1 + r).cumprod()
    yearly = (1 + r).groupby(r.index.str[:4]).prod() - 1
    gb, gr = np.log1p(base).rolling(240).sum(), np.log1p(r).rolling(240).sum()
    return {"yearly": float(w.iloc[-1] ** (12 / len(r)) - 1),
            "worst_fall": float((w / w.cummax()).min() - 1),
            "worst_year": float(yearly.min()),
            "ahead_20y": float((gr > gb)[gb.notna()].mean())}


def rules(small: pd.Series, bills: pd.Series) -> dict:
    level = (1 + small).cumprod()
    signals = {"average_10m": level > level.rolling(10).mean(),
               "beat_bills_12m": level / level.shift(12) - 1 > bills.rolling(12).sum()}
    out = {"hold": stats(small, small)}
    for lever in (1.0, 1.5, 2.0):
        held = lever * small - (lever - 1) * (bills + SPREAD / 12)
        if lever > 1:
            out[f"hold_{lever}x"] = stats(held, small)
        for name, sig in signals.items():
            inn = sig.shift(1, fill_value=True)
            switch = inn.astype(int).diff().abs().fillna(0)
            r = held.where(inn, bills) - switch * COST * lever
            out[f"{name}_{lever}x"] = {**stats(r, small), "in_market": float(inn.mean())}
    return out


def run() -> dict:
    small, bills = series()
    out = {s: rules(small[small.index >= s], bills[bills.index >= s]) for s in STARTS}
    monitor.log_experiment("trend:small_caps", {"cost": COST, "spread": SPREAD},
                           {s: v["average_10m_1.0x"]["yearly"] - v["hold"]["yearly"] for s, v in out.items()})
    return out


if __name__ == "__main__":
    for start, rows in run().items():
        print("from", start)
        for k, v in rows.items():
            print(f"  {k:22s}", {a: round(b, 3) for a, b in v.items()})
