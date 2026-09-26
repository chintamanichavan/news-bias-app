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
        "decisions": decisions(),
    }
