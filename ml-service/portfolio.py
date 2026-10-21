"""
Portfolio-research bridge — the long-horizon workspace merged into the
platform.

Reads the ~/code/portfolio-research workspace directly (CSV / YAML / ADR
markdown; no cross-service dependency) and joins it with what only this
platform has: live quotes. The watchlist is the centerpiece — each quality
business with its buy-below level against the live price.
"""

import csv
import os
import re
from pathlib import Path

import yaml

import screen
import valuation

PF_DIR = Path(os.environ.get("PORTFOLIO_RESEARCH_DIR",
                             os.path.expanduser("~/code/portfolio-research")))


# Only a business whose moat the watchlist rates this strong may enter the buy
# zone or the analysis queue. A moat is a judgment written down by hand, so a
# name with no rating is simply not eligible yet.
REQUIRED_MOAT = "wide"


def _num(v: str) -> float | None:
    try:
        return float(v) if v not in ("", None) else None
    except ValueError:
        return None


def watchlist() -> list[dict]:
    path = PF_DIR / "watchlist" / "businesses.csv"
    if not path.exists():
        return []
    out = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            out.append({
                "ticker": row["ticker"],
                "name": row["name"],
                "sector": row.get("sector"),
                "moat_type": row.get("moat_type"),
                "moat_strength": row.get("moat_strength"),
                "status": row.get("status"),
                "one_liner": row.get("one_liner"),
                "buy_below": _num(row.get("buy_below_price")),
                "intrinsic_value": _num(row.get("intrinsic_value_estimate")),
                "track": row.get("track"),
                "last_reviewed": row.get("last_reviewed"),
            })
    return out


def targets() -> dict:
    path = PF_DIR / "allocation" / "target.yaml"
    if not path.exists():
        return {"allocations": []}
    with open(path) as f:
        data = yaml.safe_load(f) or {}
    return {"base_currency": data.get("base_currency", "USD"),
            "allocations": data.get("allocations", [])}


_ADR_STATUS = re.compile(r"\*\*Status:\*\*\s*(.+)$", re.MULTILINE)


def decisions() -> list[dict]:
    ddir = PF_DIR / "decisions"
    if not ddir.exists():
        return []
    out = []
    for p in sorted(ddir.glob("[0-9]*.md")):
        try:
            head = p.read_text()[:600]
        except OSError:
            continue
        title = next((ln.lstrip("# ").strip() for ln in head.splitlines()
                      if ln.startswith("#")), p.stem)
        m = _ADR_STATUS.search(head)
        out.append({"file": p.name, "title": title,
                    "status": m.group(1).strip() if m else None})
    return out


def ips_excerpt(max_chars: int = 400) -> str | None:
    path = PF_DIR / "ips.md"
    if not path.exists():
        return None
    text = path.read_text()
    # First substantive prose paragraph: skip headings, blockquotes and
    # status lines, then strip markdown inline syntax for clean display.
    for para in text.split("\n\n"):
        p = para.strip()
        if not p or p.startswith(("#", ">", "|", "-", "*")) or "Status:" in p:
            continue
        p = re.sub(r"[*_`]|\[([^\]]+)\]\([^)]*\)", r"\1", p)
        p = re.sub(r"\s+", " ", p).strip()
        if len(p) > 40:
            return p[:max_chars] + ("…" if len(p) > max_chars else "")
    return None


def report(quotes: dict[str, float]) -> dict:
    """The joined view: workspace + live prices."""
    names = []
    for w in watchlist():
        price = quotes.get(w["ticker"])
        entry = {**w, "price": price,
                 "moat_ok": w["moat_strength"] == REQUIRED_MOAT}
        if price is not None and w["buy_below"]:
            entry["to_buy_zone_pct"] = round((price / w["buy_below"] - 1) * 100, 1)
            entry["in_buy_zone"] = entry["moat_ok"] and price <= w["buy_below"]
        if price is not None and w["intrinsic_value"]:
            entry["upside_pct"] = round((w["intrinsic_value"] / price - 1) * 100, 1)
        names.append(entry)

    # Nearest to their buy zones first — that's what a check-in wants to see.
    # Names outside the moat rule go last: they cannot be acted on.
    names.sort(key=lambda n: (not n["moat_ok"], n.get("to_buy_zone_pct", 1e9)))

    return {
        "workspace": str(PF_DIR),
        "available": PF_DIR.exists(),
        "ips_excerpt": ips_excerpt(),
        "targets": targets(),
        "watchlist": names,
        "in_buy_zone": [n["ticker"] for n in names if n.get("in_buy_zone")],
        "analysis_queue": analysis_queue(names),
        "decisions": decisions(),
    }


# ── The analysis queue: never fewer than five things worth studying ─────────

_VALUATION_FIELDS = tuple(screen.NO_VALUATION)
_screen_cache: dict = {"at": 0.0, "everyone": []}


def screened() -> list[dict]:
    """Today's screen of every company on record (screen.run), ranked by
    expected return. Kept for an hour; the service refreshes it in the
    background before then, so no page load pays for it."""
    import time as _t
    if _t.time() - _screen_cache["at"] >= 3600 or not _screen_cache["everyone"]:
        refresh_screen()
    return _screen_cache["everyone"]


def refresh_screen() -> None:
    """Run the screen now. It takes about 10 s over the wide universe."""
    import time as _t
    try:
        _screen_cache.update(at=_t.time(), everyone=screen.run())
    except Exception as e:
        print(f"[portfolio] screen unavailable: {e!r}")


def valuations() -> dict[str, dict]:
    """ticker -> return-rule valuation for every filer with enough record,
    quality screen or not."""
    return {r["ticker"]: {k: r[k] for k in _VALUATION_FIELDS}
            for r in screened() if r["valued"]}


def screen_candidates(exclude: set[str], limit: int = 8) -> list[dict]:
    """Quality compounders from the PIT fundamentals: ROE > 15%, positive
    FCF, revenue growing, shares not inflating — ranked by expected yearly
    return under the return rule (valuation.py). These carry NO thesis:
    candidates for research, never for a verdict (ADR 0007)."""
    return [r for r in screened() if r["quality"] and r["ticker"] not in exclude][:limit]


WINNERS_SHOWN = 50

_RESEARCH_FIELDS = ("ticker", "price", "expected_return_pct", "tier", "buy_below",
                    "target_below", "growth_pct", "exit_pe", "vs_52w_high_pct",
                    "ten_year_return_pct", "roe_pct", "rev_cagr_pct", "quality")


def _research_row(r: dict, moats: dict[str, str | None]) -> dict:
    return {**{k: r[k] for k in _RESEARCH_FIELDS}, "moat": moats.get(r["ticker"])}


def analysis_queue(names: list[dict], min_size: int = 5) -> dict:
    """A merged buy-zone queue of holdable businesses, all held to the return
    rule: 15% a year is the floor, 20% the target. Watchlist names must be
    under their thesis price AND clear the floor; quality-screen names need
    only clear the floor. Topped up with the nearest names until at least
    `min_size` sit in the row. Distances are always shown; a fifth name is
    never manufactured by loosening the bar.

    Only names the watchlist rates REQUIRED_MOAT are eligible. Everything
    else that clears the floor is returned apart as `research`, and the best
    ten-year records as `winners`: things to study, not a queue."""
    watchlist_tickers = {n["ticker"] for n in names}
    moats = {n["ticker"]: n.get("moat_strength") for n in names}
    eligible = {n["ticker"] for n in names if n.get("moat_ok")}
    quality = screen_candidates(exclude=set(), limit=400)
    vals = valuations()

    entries: dict[str, dict] = {}
    for n in names:
        if n.get("to_buy_zone_pct") is None:
            continue
        if n["ticker"] not in eligible:
            continue
        v = vals.get(n["ticker"])
        ret = v["expected_return_pct"] if v else None
        under_thesis = bool(n.get("in_buy_zone"))
        # no dollar earnings to value (losses, foreign filer) = the floor
        # cannot be shown to be met, so the name does not count as in zone
        clears = bool(v and v["in_zone"])
        entries[n["ticker"]] = {
            "ticker": n["ticker"], "name": n["name"], "kind": "thesis",
            "in_zone": under_thesis and clears,
            "to_zone_pct": n["to_buy_zone_pct"],
            "price": n.get("price"), "buy_below": n.get("buy_below"),
            "note": n.get("one_liner"), "on_watchlist": True,
            "expected_return_pct": ret,
            "tier": v["tier"] if v else None,
            "target_below": v["target_below"] if v else None,
            "rule_blocked": under_thesis and not clears,
            "rule_unchecked": ret is None,
            "suspect": bool(v and v["suspect"]),
        }
    for q in quality:
        if q.get("to_zone_pct") is None or q.get("suspect"):
            continue
        if q["ticker"] not in eligible:
            continue
        prev = entries.get(q["ticker"])
        cand = {
            "ticker": q["ticker"], "name": q["ticker"], "kind": "value",
            "in_zone": bool(q["in_zone"]), "to_zone_pct": q["to_zone_pct"],
            "price": q["price"], "buy_below": q["buy_below"],
            "note": (f"ROE {q['roe_pct']}% · growth {q['growth_pct']}%/yr · "
                     f"exit P/E {q['exit_pe']}"),
            "on_watchlist": q["ticker"] in watchlist_tickers,
            "expected_return_pct": q["expected_return_pct"],
            "tier": q["tier"], "target_below": q["target_below"],
            "rule_blocked": False, "rule_unchecked": False,
        }
        # a name can be out of its strict thesis zone yet inside the value
        # zone — surface whichever view puts it closer to actionable
        if prev is None or (cand["in_zone"] and not prev["in_zone"]):
            entries[q["ticker"]] = cand

    # Falling-knife + stale-thesis context: an in-zone badge means nothing
    # without knowing HOW the name got there and how old the thesis is.
    try:
        import pit
        from datetime import datetime, timezone
        pconn = pit.connect()
        px = pit.prices_asof(pconn, datetime.now(timezone.utc).isoformat(),
                             symbols=list(entries))
        by_review = {n["ticker"]: n.get("last_reviewed") for n in names}
        for sym, e in entries.items():
            p = px[px["symbol"] == sym]
            if len(p) > 20:
                last = float(p["close"].iloc[-1])
                hi52 = float(p["close"].tail(252).max())
                e["vs_52w_high_pct"] = round((last / hi52 - 1) * 100, 1)
            lr = by_review.get(sym)
            if e["kind"] == "thesis" and lr:
                try:
                    age = (datetime.now(timezone.utc)
                           - datetime.fromisoformat(lr).replace(tzinfo=timezone.utc)).days
                    e["thesis_age_days"] = age
                except ValueError:
                    pass
            warnings = []
            if e.get("suspect"):
                warnings.append(f"estimate of {e['expected_return_pct']}% a year is not credible — "
                                f"likely a data fault; check the filings by hand")
            elif e.get("rule_blocked") and e.get("rule_unchecked"):
                warnings.append("under your buy price, but no dollar earnings to value — "
                                "the 15% floor cannot be shown, so it stays out of the zone")
            elif e.get("rule_blocked"):
                warnings.append(f"under your buy price, but only {e['expected_return_pct']}% a year "
                                f"expected — below the 15% floor")
            if e.get("vs_52w_high_pct") is not None and e["vs_52w_high_pct"] < -40:
                warnings.append(f"entered via {e['vs_52w_high_pct']}% collapse — falling knife until re-underwritten")
            if e.get("thesis_age_days") and e["thesis_age_days"] > 90:
                warnings.append(f"thesis {e['thesis_age_days']}d old — re-read before acting")
            e["warnings"] = warnings
    except Exception as exc:
        print(f"[portfolio] queue context unavailable: {exc!r}")

    # in the zone: best expected return first; outside it: nearest first
    ranked = sorted(entries.values(),
                    key=lambda e: (not e["in_zone"],
                                   -(e.get("expected_return_pct") or 0) if e["in_zone"]
                                   else (e["to_zone_pct"] if e["to_zone_pct"] is not None else 1e9)))
    in_zone = [e for e in ranked if e["in_zone"]]
    # the cards hold the best ten; the table below carries the full list
    queue = ranked[: max(min_size, min(10, len(in_zone)))]
    return {
        "queue": queue,
        "in_zone_count": len(in_zone),
        "target_count": len([e for e in in_zone if e.get("tier") == "target"]),
        "rule": {"min_pct": valuation.MIN_RETURN * 100,
                 "target_pct": valuation.TARGET_RETURN * 100,
                 "horizon_years": valuation.HORIZON,
                 "growth_cap_pct": valuation.GROWTH_CAP * 100,
                 "exit_pe_cap": valuation.EXIT_PE_CAP},
        "required_moat": REQUIRED_MOAT,
        "research": [_research_row(r, moats) for r in screened()
                     if r["in_zone"] and not r["suspect"]],
        "winners": [_research_row(r, moats) for r in sorted(
            (r for r in screened() if r["ten_year_return_pct"] is not None),
            key=lambda r: -r["ten_year_return_pct"])[:WINNERS_SHOWN]],
        "suspect_count": len([1 for v in vals.values() if v["suspect"]]),
    }
