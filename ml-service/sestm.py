"""
SESTM — Sentiment Extraction via Screening and Topic Modeling (Phase 3).

Ke, Kelly & Xiu, "Predicting Returns with Text Data" (NBER w26186), adapted
to Artha's corpus. Sentiment is LEARNED from what moved prices, not assumed
from a dictionary:

1. Screening: for each vocabulary term, the fraction of its articles whose
   tagged symbol had a positive next-day return; keep terms whose fraction
   sits far from the base rate (|f_j - pi| > kappa) with enough support.
2. Topic weights: within the screened set, estimate positive/negative topic
   loadings O+ / O- from term frequencies in return-ranked articles.
3. Scoring: an article's sentiment p-hat maximizes the penalized likelihood
   of its screened-term counts under the two-topic mixture; we solve it on a
   grid, which is exact enough at this vocabulary size and fully
   deterministic.

Training pairs come from the platform's own point-in-time store: article
titles tagged with a symbol, joined to that symbol's next-day return from
pit.prices_eod. The trained model is a plain JSON artifact (terms + weights)
— versioned, inspectable, no pickle. Evaluation goes through the Phase 2
guards like every other signal; promotion into the engine only on an
out-of-sample win.
"""

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

import db
import monitor
import pit
import universe
import validation

MODEL_PATH = Path(__file__).parent / "data" / "sestm_model.json"

_TOKEN = re.compile(r"[a-z][a-z'-]+")
STOP = {"the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "as",
        "at", "by", "with", "from", "its", "his", "her", "their", "is", "are",
        "was", "were", "be", "been", "has", "have", "had", "will", "would",
        "after", "before", "over", "under", "into", "out", "up", "down",
        "this", "that", "these", "those", "it", "he", "she", "they", "we",
        "new", "says", "said", "say", "amid", "how", "why", "what", "who"}

KAPPA = 0.06        # screening distance from the base rate
MIN_COUNT = 8       # minimum articles containing a term
MAX_TERMS = 400
GRID = np.linspace(0.001, 0.999, 199)
LAMBDA = 2.0        # penalization toward neutrality (log-prior on p)


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall((text or "").lower())
            if len(t) > 2 and t not in STOP]


def build_training_pairs(days: int = 240) -> list[tuple[list[str], float]]:
    """(tokens, next-day return) for every symbol-tagged article whose symbol
    has PIT prices. All joins are as-of publication + 1 trading day."""
    conn = db.get_conn()
    rows = conn.execute(
        f"""SELECT title, date(published) AS d FROM articles
            WHERE datetime(published) > datetime('now', '-{int(days)} days')
              AND title IS NOT NULL""",
    ).fetchall()
    conn.close()

    pconn = pit.connect()
    try:
        px = pit.prices_asof(pconn, datetime.now(timezone.utc).isoformat())
    except Exception:
        return []
    if px.empty:
        return []
    px = px.sort_values(["symbol", "date"])
    px["next_ret"] = px.groupby("symbol")["close"].shift(-1) / px["close"] - 1
    ret_lookup = {(r.symbol, str(r.date)[:10]): r.next_ret
                  for r in px.itertuples() if r.next_ret == r.next_ret}

    pairs = []
    for r in rows:
        syms = universe.extract_symbols(r["title"])
        for sym in syms:
            ret = ret_lookup.get((sym, r["d"]))
            if ret is not None:
                pairs.append((_tokens(r["title"]), float(ret)))
                break
    return pairs


def train(days: int = 240) -> dict:
    pairs = build_training_pairs(days)
    if len(pairs) < 200:
        return {"error": f"only {len(pairs)} article-return pairs — the PIT price "
                         "store or the corpus needs to grow first"}

    labels = np.array([1.0 if ret > 0 else 0.0 for _, ret in pairs])
    pi = float(labels.mean())

    # ── 1. Screening ────────────────────────────────────────────────────────
    count: dict[str, int] = {}
    pos_count: dict[str, int] = {}
    for (toks, _), y in zip(pairs, labels):
        for t in set(toks):
            count[t] = count.get(t, 0) + 1
            if y == 1.0:
                pos_count[t] = pos_count.get(t, 0) + 1
    screened = []
    for t, n in count.items():
        if n < MIN_COUNT:
            continue
        f = pos_count.get(t, 0) / n
        if abs(f - pi) > KAPPA:
            screened.append((t, f, n))
    screened.sort(key=lambda x: -abs(x[1] - pi))
    screened = screened[:MAX_TERMS]
    if len(screened) < 20:
        return {"error": f"screening kept only {len(screened)} terms — corpus too small"}
    vocab = [t for t, _, _ in screened]
    v_index = {t: i for i, t in enumerate(vocab)}

    # ── 2. Topic weights: term distributions in top/bottom return halves ────
    rets = np.array([ret for _, ret in pairs])
    order = np.argsort(rets)
    lo_half, hi_half = order[: len(order) // 2], order[len(order) // 2:]
    O = np.zeros((len(vocab), 2))  # columns: [negative topic, positive topic]
    for col, idxs in ((0, lo_half), (1, hi_half)):
        for i in idxs:
            for t in pairs[i][0]:
                j = v_index.get(t)
                if j is not None:
                    O[j, col] += 1
        O[:, col] = (O[:, col] + 0.5) / (O[:, col].sum() + 0.5 * len(vocab))

    model = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "pairs": len(pairs), "base_rate": round(pi, 4),
        "vocab": vocab,
        "O_neg": O[:, 0].tolist(), "O_pos": O[:, 1].tolist(),
        "kappa": KAPPA, "days": days,
    }
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    MODEL_PATH.write_text(json.dumps(model))
    monitor.log_experiment("sestm-train", {"days": days},
                           {"pairs": len(pairs), "terms": len(vocab), "base_rate": pi})
    return {"trained": True, "pairs": len(pairs), "terms": len(vocab),
            "top_positive": _top_terms(model, "pos"), "top_negative": _top_terms(model, "neg")}


def _top_terms(model: dict, side: str, n: int = 12) -> list[str]:
    o_pos = np.array(model["O_pos"])
    o_neg = np.array(model["O_neg"])
    tilt = np.log((o_pos + 1e-9) / (o_neg + 1e-9))
    order = np.argsort(-tilt) if side == "pos" else np.argsort(tilt)
    return [model["vocab"][i] for i in order[:n]]


_loaded: dict | None = None


def load() -> dict | None:
    global _loaded
    if _loaded is None and MODEL_PATH.exists():
        _loaded = json.loads(MODEL_PATH.read_text())
    return _loaded


def score(text: str, model: dict | None = None) -> float | None:
    """Penalized-MLE sentiment in [-1, 1]; None when no screened term appears
    (SESTM's honest answer for off-topic text)."""
    model = model or load()
    if not model:
        return None
    v_index = {t: i for i, t in enumerate(model["vocab"])}
    counts: dict[int, int] = {}
    for t in _tokens(text):
        j = v_index.get(t)
        if j is not None:
            counts[j] = counts.get(j, 0) + 1
    if not counts:
        return None
    o_pos = np.array(model["O_pos"])
    o_neg = np.array(model["O_neg"])
    js = list(counts)
    ns = np.array([counts[j] for j in js], dtype=float)
    op, on = o_pos[js], o_neg[js]
    # log-likelihood over the p grid + penalty pulling toward neutrality
    ll = ns @ np.log(np.outer(op, GRID) + np.outer(on, 1 - GRID) + 1e-12)
    ll -= LAMBDA * np.abs(GRID - 0.5) * ns.sum() / max(4.0, ns.sum())
    p_hat = float(GRID[int(np.argmax(ll))])
    return round(2 * p_hat - 1, 3)


def evaluate(days: int = 240) -> dict:
    """Out-of-sample IC of SESTM scores vs the current engine blend, on a
    chronological 70/30 split — the promotion decision's evidence."""
    pairs = build_training_pairs(days)
    if len(pairs) < 300:
        return {"error": "not enough pairs for a split evaluation"}
    cut = int(len(pairs) * 0.7)
    # train on the early 70% only
    global _loaded
    keep_model, keep_loaded = None, _loaded
    if MODEL_PATH.exists():
        keep_model = MODEL_PATH.read_text()
    try:
        # temporary model trained on the early window via the same pipeline
        early_days_model = _train_on_pairs(pairs[:cut])
        if "error" in early_days_model:
            return early_days_model
        _loaded = early_days_model
        test = pairs[cut:]
        scores, rets = [], []
        for toks, ret in test:
            s = score(" ".join(toks), early_days_model)
            if s is not None:
                scores.append(s)
                rets.append(ret)
        if len(scores) < 50:
            return {"error": "too few scoreable test articles"}
        from scipy.stats import spearmanr
        ic, p = spearmanr(scores, rets)
        out = {"test_pairs": len(scores), "oos_rank_ic": round(float(ic), 4),
               "p_value": round(float(p), 4),
               "hurdle_note": f"promotion requires the Phase-2 gate "
                              f"(t-hurdle {validation.significance_hurdle(validation.trials_count() or 1)})"}
        monitor.log_experiment("sestm-eval", {"days": days}, out)
        return out
    finally:
        _loaded = keep_loaded
        if keep_model is not None:
            MODEL_PATH.write_text(keep_model)


def _train_on_pairs(pairs) -> dict:
    """The train() core, reused for the evaluation split."""
    labels = np.array([1.0 if ret > 0 else 0.0 for _, ret in pairs])
    pi = float(labels.mean())
    count: dict[str, int] = {}
    pos_count: dict[str, int] = {}
    for (toks, _), y in zip(pairs, labels):
        for t in set(toks):
            count[t] = count.get(t, 0) + 1
            if y == 1.0:
                pos_count[t] = pos_count.get(t, 0) + 1
    screened = [(t, pos_count.get(t, 0) / n, n) for t, n in count.items()
                if n >= MIN_COUNT and abs(pos_count.get(t, 0) / n - pi) > KAPPA]
    screened.sort(key=lambda x: -abs(x[1] - pi))
    screened = screened[:MAX_TERMS]
    if len(screened) < 20:
        return {"error": "screening kept too few terms on the training split"}
    vocab = [t for t, _, _ in screened]
    v_index = {t: i for i, t in enumerate(vocab)}
    rets = np.array([ret for _, ret in pairs])
    order = np.argsort(rets)
    lo_half, hi_half = order[: len(order) // 2], order[len(order) // 2:]
    O = np.zeros((len(vocab), 2))
    for col, idxs in ((0, lo_half), (1, hi_half)):
        for i in idxs:
            for t in pairs[i][0]:
                j = v_index.get(t)
                if j is not None:
                    O[j, col] += 1
        O[:, col] = (O[:, col] + 0.5) / (O[:, col].sum() + 0.5 * len(vocab))
    return {"vocab": vocab, "O_neg": O[:, 0].tolist(), "O_pos": O[:, 1].tolist(),
            "base_rate": pi}
