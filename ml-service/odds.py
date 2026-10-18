"""
The odds on the plan — the portfolio priced as a distribution, not a number.

The book is the Core target allocation (portfolio-research allocation/
target.yaml), in percentages. Each sleeve is stood in for by a Ken French
research portfolio with the same tilt, so the record goes back to July 1991
instead of to a fund's launch. Months are resampled in 12-month blocks, all
sleeves together, which keeps the crashes, the streaks and the way sleeves
fall at the same time.

What the odds assume: the next 15 years draw from the same months as the
last 35. The proxies are paper portfolios before costs; FEES takes off a
typical factor-fund expense ratio, nothing for taxes.
"""

import io
import time
import zipfile
from pathlib import Path

import httpx
import numpy as np

import portfolio

FRENCH = "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/{}_CSV.zip"
CACHE = Path(__file__).parent / "data" / "french"
CACHE_DAYS = 7

FEES = 0.003            # a year, roughly what Avantis/DFA factor funds charge
HORIZONS = (5, 10, 15)  # years; the IPS horizon is 10-15
GOALS = (0.15, 0.20)    # a year: the floor and the target
BLOCK = 12              # months per resampled block
PATHS = 10_000
SEED = 7

# (region, factor) -> (French file, columns averaged). Real estate and
# inflation-focused have no French tilt portfolio; industries stand in.
PROXIES = {
    ("us-developed", "large-value"): ("6_Portfolios_2x3", ["BIG HiBM"]),
    ("us-developed", "small-value"): ("6_Portfolios_2x3", ["SMALL HiBM"]),
    ("us-developed", "profitability"): ("6_Portfolios_ME_OP_2x3", ["BIG HiOP"]),
    ("us-developed", "real-estate"): ("49_Industry_Portfolios", ["RlEst"]),
    ("us-developed", "inflation-focused"): ("49_Industry_Portfolios", ["Oil", "Mines", "Agric"]),
    ("international-developed", "large-value"): ("Developed_ex_US_6_Portfolios_ME_BE-ME", ["BIG HiBM"]),
    ("international-developed", "small-value"): ("Developed_ex_US_6_Portfolios_ME_BE-ME", ["SMALL HiBM"]),
    ("international-developed", "profitability"): ("Developed_ex_US_6_Portfolios_ME_OP", ["BIG HiOP"]),
    ("emerging", "value"): ("Emerging_Markets_6_Portfolios_ME_BE-ME", ["BIG HiBM"]),
    ("emerging", "profitability"): ("Emerging_Markets_6_Portfolios_ME_OP", ["BIG HiOP"]),
    ("global", "quality"): ("Developed_6_Portfolios_ME_OP", ["BIG HiOP"]),
}
# The plain alternatives: a whole-market index fund, Mkt-RF + RF.
BENCHMARKS = {"us": ("F-F_Research_Data_Factors", "US index fund"),
              "world": ("Developed_3_Factors", "World index fund (developed markets)")}


def parse_french(text: str, block: int = 0) -> dict[str, dict[str, float]]:
    """{YYYYMM: {column: monthly return as a fraction}} from the `block`-th
    table of a French library CSV: in the portfolio files, 0 is value-weighted
    monthly returns, 1 equal-weighted. Missing values (-99.99) are left out."""
    out: dict[str, dict[str, float]] = {}
    header, seen = None, -1
    for line in text.splitlines():
        cells = [c.strip() for c in line.split(",")]
        if header is None:
            if len(cells) > 1 and cells[0] == "" and cells[1]:
                seen += 1
                if seen == block:
                    header = cells[1:]
            continue
        if len(cells[0]) == 6 and cells[0].isdigit():
            out[cells[0]] = {h: float(v) / 100 for h, v in zip(header, cells[1:])
                             if v not in ("", "-99.99", "-999")}
        elif out:
            break
    return out


def french_text(name: str) -> str:
    """A French library CSV as text, the file kept on disk for CACHE_DAYS."""
    path = CACHE / f"{name}.zip"
    if not path.exists() or time.time() - path.stat().st_mtime > CACHE_DAYS * 86400:
        r = httpx.get(FRENCH.format(name), timeout=60, follow_redirects=True)
        r.raise_for_status()
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_bytes(r.content)
    z = zipfile.ZipFile(io.BytesIO(path.read_bytes()))
    return z.read(z.namelist()[0]).decode("latin-1")


def french(name: str, block: int = 0) -> dict[str, dict[str, float]]:
    """One table of a French file."""
    return parse_french(french_text(name), block)


def key(region: str, factor: str) -> str:
    return f"{region}/{factor}"


def sleeves(weights: dict[str, float] | None = None) -> list[dict]:
    """The Core allocation — or a what-if, {"region/factor": percent} — as
    weights summing to 1, each with its proxy. Zero-weight sleeves are left out."""
    if weights is None:
        rows = [(r.get("region"), r.get("factor"), r["weight"])
                for r in portfolio.targets()["allocations"]]
    else:
        rows = [(*k.split("/", 1), w) for k, w in weights.items()]
    if any(w < 0 for *_, w in rows):
        raise ValueError("weights cannot be negative")
    total = sum(w for *_, w in rows)
    if total <= 0:
        raise ValueError("weights must add up to more than zero")
    out = []
    for region, factor, w in rows:
        if (region, factor) not in PROXIES:
            raise ValueError(f"no proxy for sleeve {(region, factor)}")
        if w > 0:
            out.append({"region": region, "factor": factor, "weight": w / total,
                        "proxy": PROXIES[(region, factor)]})
    return out


def history() -> tuple[list[str], dict[str, np.ndarray], dict[str, np.ndarray]]:
    """Every sleeve's and benchmark's monthly returns over the months they all
    have — one window, so a what-if is priced on the same months as the plan."""
    files = {name: french(name) for name, _ in PROXIES.values()}
    benches = {k: french(name) for k, (name, _) in BENCHMARKS.items()}
    series = {key(*k): {m: sum(v[c] for c in cols) / len(cols)
                        for m, v in files[name].items() if all(c in v for c in cols)}
              for k, (name, cols) in PROXIES.items()}
    months = sorted(set.intersection(*map(set, series.values()), *map(set, benches.values())))
    S = {k: np.array([ser[m] for m in months]) for k, ser in series.items()}
    b = {k: np.array([f[m]["Mkt-RF"] + f[m]["RF"] for m in months]) for k, f in benches.items()}
    return months, S, b


def block_bootstrap(n_months: int, length: int, rng) -> np.ndarray:
    """PATHS x length month indices: blocks of BLOCK consecutive months from
    random starts, wrapping round the end of the record."""
    blocks = -(-length // BLOCK)
    starts = rng.integers(0, n_months, size=(PATHS, blocks))
    idx = (starts[:, :, None] + np.arange(BLOCK)) % n_months
    return idx.reshape(PATHS, -1)[:, :length]


def max_drawdown(r: np.ndarray) -> np.ndarray:
    """Deepest peak-to-trough fall along the last axis, as a negative fraction."""
    wealth = np.cumprod(1 + r, axis=-1)
    peak = np.maximum.accumulate(np.maximum(wealth, 1.0), axis=-1)
    return (wealth / peak - 1).min(axis=-1)


def cagr(r: np.ndarray) -> np.ndarray:
    return np.prod(1 + r, axis=-1) ** (12 / r.shape[-1]) - 1


def rolling(r: np.ndarray, months: int) -> np.ndarray:
    """Annualised return of every window of `months` in the record."""
    growth = np.concatenate([[0.0], np.cumsum(np.log1p(r))])
    return np.exp((growth[months:] - growth[:-months]) * 12 / months) - 1


def distribution(r: np.ndarray, rng) -> dict:
    """The odds for one monthly return series, beside its own record."""
    idx = block_bootstrap(len(r), max(HORIZONS) * 12, rng)
    paths = r[idx]
    worst = int(np.argmin(rolling(r, 12)))
    out = {"record": {"cagr": float(cagr(r)), "vol": float(r.std(ddof=1) * np.sqrt(12)),
                      "max_drawdown": float(max_drawdown(r)),
                      "worst_12m": float(rolling(r, 12)[worst]), "worst_12m_index": worst + 11},
           "horizons": []}
    for years in HORIZONS:
        g = cagr(paths[:, :years * 12])
        real = rolling(r, years * 12) if len(r) >= years * 12 else np.array([])
        out["horizons"].append({
            "years": years,
            "percentiles": {str(p): float(np.percentile(g, p)) for p in (5, 25, 50, 75, 95)},
            "p_goal": {f"{goal:.2f}": float((g >= goal).mean()) for goal in GOALS},
            "p_loss": float((g < 0).mean()),
            # None when the record is shorter than the horizon.
            "history_share": {f"{goal:.2f}": float((real >= goal).mean()) if len(real) else None
                              for goal in GOALS},
        })
    year = cagr(paths[:, :12])
    dd = max_drawdown(paths)
    out["bad_year"] = {"one_in_20": float(np.percentile(year, 5)),
                       "one_in_100": float(np.percentile(year, 1))}
    out["drawdown"] = {"median": float(np.median(dd)), "one_in_20": float(np.percentile(dd, 5)),
                       "p_beyond_50": float((dd <= -0.50).mean()),
                       "p_beyond_75": float((dd <= -0.75).mean())}
    return out


def odds(weights: dict[str, float] | None = None) -> dict:
    """The plan priced; with `weights`, a what-if priced the same way."""
    books = sleeves(weights)
    months, S, benches = history()
    R = np.column_stack([S[key(s["region"], s["factor"])] for s in books])
    w = np.array([s["weight"] for s in books])
    plan = R @ w - FEES / 12

    # Each sleeve's share of the plan's variance: w_i (Cov w)_i / w' Cov w.
    cov = np.atleast_2d(np.cov(R, rowvar=False))
    risk_share = w * (cov @ w) / (w @ cov @ w)

    def priced(r: np.ndarray, label: str) -> dict:
        # The same seed for every series: they are compared on the same draws.
        d = {"label": label, **distribution(r, np.random.default_rng(SEED))}
        m = months[d["record"].pop("worst_12m_index")]
        d["record"]["worst_12m_ending"] = f"{m[:4]}-{m[4:]}"
        return d

    return {
        "since": f"{months[0][:4]}-{months[0][4:]}",
        "through": f"{months[-1][:4]}-{months[-1][4:]}",
        "months": len(months),
        "fees": FEES,
        "goals": list(GOALS),
        "plan": priced(plan, "Your plan" if weights is None else "What if"),
        "benchmarks": [priced(b, BENCHMARKS[k][1]) for k, b in benches.items()],
        "choices": [key(*k) for k in PROXIES],
        "sleeves": [{"key": key(s["region"], s["factor"]), "region": s["region"],
                     "factor": s["factor"], "weight": s["weight"],
                     "proxy": f"{s['proxy'][0]}: {' + '.join(s['proxy'][1])}",
                     "cagr": float(cagr(R[:, i])),
                     "vol": float(R[:, i].std(ddof=1) * np.sqrt(12)),
                     "risk_share": float(risk_share[i])}
                    for i, s in enumerate(books)],
    }
