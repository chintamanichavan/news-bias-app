"""
Portfolio-research bridge — the long-horizon workspace merged into the
platform.

Reads the ~/code/portfolio-research workspace directly (CSV / YAML / ADR
markdown; no cross-service dependency) and joins it with what only this
platform has: live quotes and the signal engine's composites. The watchlist
is the centerpiece — each quality business with its buy-below level against
the live price, plus whatever short-horizon signal the engine currently
carries on it.
"""

import csv
import os
import re
from pathlib import Path

import yaml

import db
import valuation

PF_DIR = Path(os.environ.get("PORTFOLIO_RESEARCH_DIR",
                             os.path.expanduser("~/code/portfolio-research")))


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


def latest_composites() -> dict[str, float]:
    """Most recent composite per entity from the engine's snapshots."""
    conn = db.get_conn()
    rows = conn.execute(
        """SELECT entity, composite FROM signal_snapshots
           WHERE id IN (SELECT MAX(id) FROM signal_snapshots GROUP BY entity)""",
    ).fetchall()
    conn.close()
    return {r["entity"]: r["composite"] for r in rows}


def report(quotes: dict[str, float]) -> dict:
    """The joined view: workspace + live prices + engine composites."""
    composites = latest_composites()
    names = []
    for w in watchlist():
        price = quotes.get(w["ticker"])
        entry = {**w, "price": price, "composite": composites.get(w["ticker"])}
        if price is not None and w["buy_below"]:
            entry["to_buy_zone_pct"] = round((price / w["buy_below"] - 1) * 100, 1)
            entry["in_buy_zone"] = price <= w["buy_below"]
        if price is not None and w["intrinsic_value"]:
            entry["upside_pct"] = round((w["intrinsic_value"] / price - 1) * 100, 1)
        names.append(entry)

    # Nearest to their buy zones first — that's what a check-in wants to see
    names.sort(key=lambda n: n.get("to_buy_zone_pct", 1e9))

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

_screen_cache: dict = {"at": 0.0, "rows": [], "valuations": {}}


def valuations() -> dict[str, dict]:
    """ticker -> return-rule valuation for every filer with enough record,
    quality screen or not. Shares the screen's hourly cache."""
    screen_candidates(exclude=set(), limit=1)
    return _screen_cache["valuations"]


def screen_candidates(exclude: set[str], limit: int = 8) -> list[dict]:
    """Quality compounders from the PIT fundamentals: ROE > 15%, positive
    FCF, revenue growing, shares not inflating — ranked by expected yearly
    return under the return rule (valuation.py). These carry NO thesis:
    candidates for research, never for a verdict (ADR 0007)."""
    import time as _t
    if _t.time() - _screen_cache["at"] < 3600 and _screen_cache["rows"]:
        return [r for r in _screen_cache["rows"] if r["ticker"] not in exclude][:limit]

    import pandas as pd
    import pit
    from datetime import datetime, timezone
    try:
        conn = pit.connect()
        now = datetime.now(timezone.utc).isoformat()
        f = pit.fundamentals_asof(conn, now)
        symbols = sorted(f["symbol"].dropna().unique())
        px = pit.prices_asof(conn, now, symbols=list(symbols))
    except Exception as e:
        print(f"[portfolio] screen unavailable: {e!r}")
        return []
    if f.empty or px.empty:
        return []

    flows = f[f["period_start"].notna()].copy()
    flows["dur"] = (flows["period_end"] - flows["period_start"]).dt.days
    annual = flows[(flows["dur"] >= 300) & (flows["dur"] <= 400)]

    # split once per table: filtering the whole frame per symbol does not
    # survive a universe of thousands
    annual_by = dict(tuple(annual.groupby("symbol")))
    facts_by = dict(tuple(f.groupby("symbol")))
    px_by = dict(tuple(px.groupby("symbol")))

    out = []
    vals: dict[str, dict] = {}
    for sym in symbols:
        fa = annual_by.get(sym)
        fi = facts_by.get(sym)
        if fa is None or fa.empty or sym not in px_by:
            continue

        def latest(tags, frame):
            sub = frame[frame["tag"].isin(tags)].sort_values("period_end")
            return float(sub["value"].iloc[-1]) if len(sub) else None

        def series(tags, unit=None):
            sub = fa[fa["tag"].isin(tags)]
            if unit:
                sub = sub[sub["unit"] == unit]
            sub = sub.sort_values("period_end")
            return [(pd.Timestamp(r.period_end).year, float(r.value)) for r in sub.itertuples()]

        ni = latest(["NetIncomeLoss"], fa)
        eq = latest(["StockholdersEquity"], fi)
        ocf = latest(["NetCashProvidedByUsedInOperatingActivities"], fa)
        capex = latest(["PaymentsToAcquirePropertyPlantAndEquipment"], fa) or 0.0
        rev = series(["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"])
        shares = series(["WeightedAverageNumberOfDilutedSharesOutstanding"])

        roe = ni / eq * 100 if ni is not None and eq else None
        fcf = ocf - capex if ocf is not None else None
        rev_cagr = None
        if len(rev) >= 4 and rev[0][1] > 0 and rev[-1][1] > 0:
            yrs = max(1, rev[-1][0] - rev[0][0])
            rev_cagr = ((rev[-1][1] / rev[0][1]) ** (1 / yrs) - 1) * 100
        dilution = None
        if len(shares) >= 3 and shares[0][1]:
            dilution = (shares[-1][1] / shares[0][1] - 1) * 100

        p = px_by[sym].sort_values("date").reset_index(drop=True)
        last = float(p["close"].iloc[-1])
        hi52 = float(p["close"].tail(252).max())
        discount = (last / hi52 - 1) * 100

        # The return rule: what does today's price imply per year, on the
        # company's own record? Growth is the slower of revenue and EPS,
        # the exit multiple its own decade-median P/E — both capped.
        # Dollar earnings only: an ADR that files in yen or yuan cannot be
        # set against its dollar price.
        eps_series = series(["EarningsPerShareDiluted"], unit="USD/shares")
        val = None
        this_year = datetime.now(timezone.utc).year
        eps_base = valuation.base_eps([e for _, e in eps_series])
        if (len(eps_series) >= 5 and eps_base
                and eps_series[-1][0] >= this_year - valuation.MAX_EPS_AGE_YEARS):
            pe_hist = []
            pdates = p["date"]
            for fy, eps in eps_series:
                if eps and eps > 0:
                    at = p[pdates.dt.year == fy]
                    if len(at):
                        pe_hist.append(float(at["close"].iloc[-1]) / eps)
            if len(pe_hist) >= 5:
                pe_hist.sort()
                median_pe = pe_hist[len(pe_hist) // 2]
                eps_now = eps_base
                eps_cagr = valuation.cagr(eps_series[0][1], eps_series[-1][1],
                                          eps_series[-1][0] - eps_series[0][0])
                rev_recent = (valuation.cagr(rev[-4][1], rev[-1][1], rev[-1][0] - rev[-4][0])
                              if len(rev) >= 4 else None)
                growth = valuation.conservative_growth(
                    rev_cagr / 100 if rev_cagr is not None else None, rev_recent, eps_cagr)
                # dividends: the lowest of the last three years, so a special
                # payout is not counted as if it came every year
                declared = series(["CommonStockDividendsPerShareDeclared"], unit="USD/shares")
                if declared and declared[-1][0] >= eps_series[-1][0] - 1:
                    dps = min(d for _, d in declared[-3:])
                else:
                    paid = series(["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"])
                    per_share = (min(d for _, d in paid[-3:]) / shares[-1][1]
                                 if paid and shares and shares[-1][1]
                                 and paid[-1][0] >= eps_series[-1][0] - 1 else 0.0)
                    dps = max(0.0, per_share)
                ret = valuation.expected_return(last, eps_now, growth, median_pe, dps)
                floor_px = valuation.price_for_return(
                    valuation.MIN_RETURN, eps_now, growth, median_pe, dps)
                target_px = valuation.price_for_return(
                    valuation.TARGET_RETURN, eps_now, growth, median_pe, dps)
                val = {
                    "expected_return_pct": round(ret * 100, 1) if ret is not None else None,
                    "tier": valuation.tier(ret),
                    "buy_below": round(floor_px, 2) if floor_px else None,
                    "target_below": round(target_px, 2) if target_px else None,
                    "fair_value": round(median_pe * eps_now, 2),
                    "growth_pct": round(growth * 100, 1),
                    "exit_pe": round(min(median_pe, valuation.EXIT_PE_CAP), 1),
                    "div_yield_pct": round(dps / last * 100, 2) if last else 0.0,
                    "to_zone_pct": round((last / floor_px - 1) * 100, 1) if floor_px else None,
                    "in_zone": valuation.tier(ret) is not None,
                    "suspect": ret is not None and ret > valuation.MAX_CREDIBLE,
                }
                vals[sym] = val

        if (roe is not None and roe > 15 and fcf is not None and fcf > 0
                and rev_cagr is not None and rev_cagr > 5
                and (dilution is None or dilution <= 5)):
            out.append({
                "ticker": sym, "price": round(last, 2),
                "vs_52w_high_pct": round(discount, 1),
                "roe_pct": round(roe, 1), "rev_cagr_pct": round(rev_cagr, 1),
                "fcf": round(fcf, 0),
                "dilution_pct": round(dilution, 1) if dilution is not None else None,
                **(val or {"expected_return_pct": None, "tier": None,
                           "buy_below": None, "target_below": None,
                           "fair_value": None, "growth_pct": None,
                           "exit_pe": None, "div_yield_pct": None,
                           "to_zone_pct": None, "in_zone": False, "suspect": False}),
            })

    # highest expected return first; names with no estimate last
    out.sort(key=lambda r: -(r["expected_return_pct"]
                             if r["expected_return_pct"] is not None else -1e9))
    _screen_cache.update(at=_t.time(), rows=out, valuations=vals)
    return [r for r in out if r["ticker"] not in exclude][:limit]


def analysis_queue(names: list[dict], min_size: int = 5) -> dict:
    """A merged buy-zone queue of holdable businesses, all held to the return
    rule: 15% a year is the floor, 20% the target. Watchlist names must be
    under their thesis price AND clear the floor; quality-screen names need
    only clear the floor. Topped up with the nearest names until at least
    `min_size` sit in the row. Distances are always shown; a fifth name is
    never manufactured by loosening the bar."""
    watchlist_tickers = {n["ticker"] for n in names}
    quality = screen_candidates(exclude=set(), limit=400)
    vals = valuations()

    entries: dict[str, dict] = {}
    for n in names:
        if n.get("to_buy_zone_pct") is None:
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
        # clears the return floor on the numbers but did NOT pass the quality
        # screen and has no thesis — leads to research, nothing more
        "clears_rule_unscreened": sorted(
            ({"ticker": s, "expected_return_pct": v["expected_return_pct"], "tier": v["tier"]}
             for s, v in vals.items()
             if v["in_zone"] and s not in entries),
            key=lambda r: -r["expected_return_pct"])[:8],
        "rule": {"min_pct": valuation.MIN_RETURN * 100,
                 "target_pct": valuation.TARGET_RETURN * 100,
                 "horizon_years": valuation.HORIZON,
                 "growth_cap_pct": valuation.GROWTH_CAP * 100,
                 "exit_pe_cap": valuation.EXIT_PE_CAP},
        "screened": [q for q in quality if q["expected_return_pct"] is not None
                     and not q["suspect"]][:40],
        "suspect_count": len([1 for v in vals.values() if v["suspect"]]),
    }
