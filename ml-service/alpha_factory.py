"""
Alpha factory — Phase 4: the Gu–Kelly–Xiu protocol on Artha's own data.

Feature library in the Alpha158 spirit (price/volume expressions over the
point-in-time store), a LightGBM baseline, and the GKX evaluation discipline:

- strictly chronological train / validation / test (60/20/20)
- out-of-sample R² against the zero forecast (their Eq. 3.24 convention)
- daily cross-sectional rank IC on the test window
- quantile long-short spread, top minus bottom
- every run logged to the experiments registry (trials feed the DSR/hurdle)

Everything reads prices through pit.prices_asof — the factory cannot see a
row the store didn't hold at the as-of instant. The model artifact is
LightGBM's own text format, saved under data/models/.
"""

import math
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

import monitor
import pit
import validation

MODEL_DIR = Path(__file__).parent / "data" / "models"
HORIZON = 5          # forward days for the label
MIN_HISTORY = 80     # bars a symbol needs before it contributes rows


def triple_barrier_labels(closes: pd.Series, pt: float = 2.0, sl: float = 2.0,
                          horizon: int = HORIZON) -> pd.Series:
    """López de Prado (2018, *Advances in Financial ML*, ch. 3): the label is
    the return at the FIRST barrier touched — profit-take at +pt·σ, stop at
    −sl·σ (σ = trailing 20-day daily vol scaled to the horizon), or the
    vertical barrier at `horizon` days. A fixed-horizon label grades a path
    by where it ends; this grades it by what a holder with a stop would have
    actually experienced."""
    c = closes.reset_index(drop=True)
    sigma = c.pct_change().rolling(20).std() * math.sqrt(horizon)
    out = np.full(len(c), np.nan)
    for i in range(len(c) - 1):
        s = sigma.iloc[i]
        if not np.isfinite(s) or s <= 0 or not c.iloc[i]:
            continue
        up, dn = pt * s, -sl * s
        last = min(i + horizon, len(c) - 1)
        for j in range(i + 1, last + 1):
            r = c.iloc[j] / c.iloc[i] - 1
            if r >= up or r <= dn:
                out[i] = r
                break
        else:
            out[i] = c.iloc[last] / c.iloc[i] - 1
    return pd.Series(out, index=closes.index)


def build_features(px: pd.DataFrame, label_mode: str = "fixed") -> pd.DataFrame:
    """px: prices_asof output. Returns one row per (symbol, date) with the
    feature panel and the label — forward-HORIZON return ("fixed") or the
    first-barrier-touch return ("tb")."""
    frames = []
    for sym, g in px.groupby("symbol"):
        g = g.sort_values("date").reset_index(drop=True)
        if len(g) < MIN_HISTORY:
            continue
        c, h, l, v = g["close"], g["high"], g["low"], g["volume"]
        f = pd.DataFrame({"symbol": sym, "date": g["date"]})
        r1 = c.pct_change()
        for w in (1, 5, 10, 20, 60):
            f[f"ret_{w}"] = c.pct_change(w)
        for w in (5, 10, 20, 60):
            f[f"ma_ratio_{w}"] = c / c.rolling(w).mean() - 1
            f[f"vol_{w}"] = r1.rolling(w).std()
        f["mom_gap"] = f["ret_20"] - f["ret_5"]
        rng = (h - l).replace(0, np.nan)
        f["rsv_10"] = ((c - l) / rng).rolling(10).mean()
        f["hl_spread_10"] = (rng / c).rolling(10).mean()
        vol_ma = v.rolling(20).mean()
        f["vol_z_20"] = (v - vol_ma) / v.rolling(20).std()
        f["turn_trend_10"] = v.rolling(10).mean() / v.rolling(60).mean() - 1
        f["corr_cv_10"] = c.rolling(10).corr(v)
        f["max_dd_20"] = c / c.rolling(20).max() - 1
        if label_mode == "tb":
            f["label"] = triple_barrier_labels(c).to_numpy()
        else:
            f["label"] = c.shift(-HORIZON) / c - 1
        frames.append(f)
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)
    return out.replace([np.inf, -np.inf], np.nan).dropna()


def _verdict(ic_mean, ic_t, hurdle, spread) -> str:
    """IC is not money: a candidate needs the significant rank IC AND a
    positive top-minus-bottom spread — a model that ranks the middle well
    while its extreme picks lose is untradable, however pretty the t-stat."""
    if ic_t is None or ic_mean is None:
        return "too little test data for a verdict"
    if abs(ic_t) >= hurdle and ic_mean > 0.02 and (spread or 0) > 0:
        return "clears the trials-adjusted bar with a tradable spread — a candidate for the gate"
    if abs(ic_t) >= hurdle and (spread or 0) <= 0:
        return ("significant rank IC but a NEGATIVE quintile spread — the extremes "
                "invert; untradable as-is, logged as a research finding")
    return "does not clear the bar — logged, not deployed"


def _r2_oos(y: np.ndarray, yhat: np.ndarray) -> float:
    """GKX out-of-sample R²: benchmarked against a zero forecast, not the mean."""
    return float(1 - np.sum((y - yhat) ** 2) / np.sum(y ** 2))


def run(as_of: str | None = None, label_mode: str = "fixed") -> dict:
    as_of = as_of or datetime.now(timezone.utc).isoformat()
    conn = pit.connect()
    try:
        px = pit.prices_asof(conn, as_of)
    except Exception as e:
        return {"error": f"PIT store unavailable: {e!r}"}
    if px.empty or px["symbol"].nunique() < 5:
        return {"error": "PIT price store too thin — run pit_ingest first"}

    panel = build_features(px, label_mode=label_mode)
    if len(panel) < 2000:
        return {"error": f"only {len(panel)} feature rows — need more history/symbols"}

    feature_cols = [c for c in panel.columns if c not in ("symbol", "date", "label")]
    panel = panel.sort_values("date").reset_index(drop=True)
    dates = np.sort(panel["date"].unique())
    t1, t2 = dates[int(len(dates) * 0.6)], dates[int(len(dates) * 0.8)]
    train = panel[panel.date < t1]
    valid = panel[(panel.date >= t1) & (panel.date < t2)]
    test = panel[panel.date >= t2]

    model = lgb.LGBMRegressor(
        n_estimators=600, learning_rate=0.03, num_leaves=31,
        subsample=0.8, colsample_bytree=0.8, random_state=7, verbosity=-1,
    )
    model.fit(train[feature_cols], train["label"],
              eval_set=[(valid[feature_cols], valid["label"])],
              callbacks=[lgb.early_stopping(50, verbose=False)])

    test = test.copy()
    test["pred"] = model.predict(test[feature_cols])

    r2 = _r2_oos(test["label"].to_numpy(), test["pred"].to_numpy())

    # daily cross-sectional rank IC + quantile spread on the test window
    ics, spreads = [], []
    for _, day in test.groupby("date"):
        if len(day) < 5:
            continue
        ic, _ = spearmanr(day["pred"], day["label"])
        if ic == ic:
            ics.append(float(ic))
        ranked = day.sort_values("pred")
        k = max(1, len(day) // 5)
        spreads.append(float(ranked["label"].tail(k).mean() - ranked["label"].head(k).mean()))
    ic_mean = float(np.mean(ics)) if ics else None
    ic_t = (float(np.mean(ics) / np.std(ics, ddof=1) * np.sqrt(len(ics)))
            if len(ics) > 5 and np.std(ics, ddof=1) > 0 else None)

    importance = sorted(zip(feature_cols, model.feature_importances_.tolist()),
                        key=lambda x: -x[1])[:8]

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    model.booster_.save_model(str(MODEL_DIR / f"factory_lgbm_{stamp}.txt"))

    n_trials = validation.trials_count("factory") + 1
    hurdle = validation.significance_hurdle(n_trials)
    out = {
        "as_of": as_of,
        "rows": {"train": len(train), "valid": len(valid), "test": len(test)},
        "symbols": int(panel["symbol"].nunique()),
        "features": len(feature_cols),
        "horizon_days": HORIZON,
        "label_mode": label_mode,
        "caveats": [validation.SURVIVORSHIP_CAVEAT],
        "r2_oos": round(r2, 5),
        "rank_ic": {"mean": round(ic_mean, 4) if ic_mean is not None else None,
                    "t_stat": round(ic_t, 2) if ic_t is not None else None,
                    "days": len(ics), "hurdle": hurdle},
        "quintile_spread_daily": round(float(np.mean(spreads)), 5) if spreads else None,
        "top_features": [{"name": n, "gain": g} for n, g in importance],
        "model_artifact": f"data/models/factory_lgbm_{stamp}.txt",
        "verdict": _verdict(ic_mean, ic_t, hurdle,
                            float(np.mean(spreads)) if spreads else None),
    }
    monitor.log_experiment("factory", {"horizon": HORIZON, "features": len(feature_cols),
                                       "symbols": out["symbols"], "labels": label_mode},
                           {"r2_oos": out["r2_oos"], "ic": out["rank_ic"],
                            "spread": out["quintile_spread_daily"]})
    return out
