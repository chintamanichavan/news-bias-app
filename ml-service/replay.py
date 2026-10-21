"""
Historical replay of the return rule: did the names it liked go on to earn
what it said?

Each 30 June from FIRST_YEAR on, every company is valued exactly as the
Portfolio page values it today, but from the record as it was known that day
(screen.Records). Then the clock runs forward and the return a buyer actually
got over 1, 3 and 5 years is set beside the estimate.

Read the result with these in mind — they are returned with it:
- the companies are today's survivors, so every group's return is flattered;
- the 5-year windows overlap, so ten start years are far fewer than ten
  independent tests;
- the rule's caps were chosen in 2026, after the years it is tested on.
"""

import json
import statistics
from datetime import date, datetime, timezone
from pathlib import Path

from scipy.stats import spearmanr

import monitor
import pit
import screen
import validation
import valuation

FIRST_YEAR = 2012          # five years of XBRL earnings exist for most filers by then
HORIZONS = (1, 3, 5)
RESULT_PATH = pit.PIT_ROOT.parent / "replay.json"

FLOOR = valuation.MIN_RETURN * 100
TARGET = valuation.TARGET_RETURN * 100
# (label, lowest expected %/yr, highest) — the last two are the buy zone
GROUPS = [
    ("below 0%", float("-inf"), 0.0),
    ("0% to 8%", 0.0, 8.0),
    (f"8% to {FLOOR:.0f}%", 8.0, FLOOR),
    (f"{FLOOR:.0f}% to {TARGET:.0f}%", FLOOR, TARGET),
    (f"{TARGET:.0f}% and up", TARGET, float("inf")),
]

CAVEATS = [
    validation.SURVIVORSHIP_CAVEAT,
    "The universe is today's largest filers. A company that was small then and large now "
    "is in; one that was large then and failed is not.",
    "Five-year windows from yearly start dates overlap. The years tested are one long "
    "rising market with two sharp falls, not many separate tests.",
    "The rule's caps (growth, exit P/E) were chosen in 2026, after these years.",
    "Returns are price change plus dividends, not reinvested, before costs and taxes.",
]


def observe(records: screen.Records, first_year: int = FIRST_YEAR,
            last_year: int | None = None) -> list[dict]:
    """One row per company per start year: what the rule said on 30 June and
    what the next 1, 3 and 5 years returned (None where not yet known)."""
    last_year = last_year or datetime.now(timezone.utc).year - 1
    rows = []
    for year in range(first_year, last_year + 1):
        start = date(year, 6, 30)
        day = start.toordinal()
        for sym in records.symbols:
            a = records.assess(sym, start)
            v = a and a["valuation"]
            if not v or v["expected_return_pct"] is None:
                continue
            rows.append({
                "year": year, "ticker": sym,
                "expected": v["expected_return_pct"],
                "suspect": v["suspect"], "quality": a["quality"], "durable": a["durable"],
                **{f"got_{h}y": _pct(records.total_return(sym, day, h)) for h in HORIZONS},
            })
    return rows


def _pct(r: float | None) -> float | None:
    return round(r * 100, 2) if r is not None else None


def _outcome(got: list[float]) -> dict:
    if not got:
        return {"n": 0, "median": None, "mean": None, "reached_floor_pct": None, "lost_money_pct": None}
    return {
        "n": len(got),
        "median": round(statistics.median(got), 1),
        "mean": round(statistics.fmean(got), 1),
        "reached_floor_pct": round(100 * sum(g >= FLOOR for g in got) / len(got), 1),
        "lost_money_pct": round(100 * sum(g < 0 for g in got) / len(got), 1),
    }


# Ways of choosing companies, each judged against everyone bought the same day.
SELECTIONS = [
    ("picks", f"Scored {FLOOR:.0f}% or more", lambda r: r["expected"] >= FLOOR),
    ("quality", "Passed the quality screen", lambda r: r["quality"]),
    ("quality_picks", f"Both: quality and {FLOOR:.0f}% or more",
     lambda r: r["quality"] and r["expected"] >= FLOOR),
    ("durable", "Durable by numbers (ten-year record)", lambda r: r["durable"] is True),
    ("durable_picks", f"Durable and {FLOOR:.0f}% or more",
     lambda r: r["durable"] is True and r["expected"] >= FLOOR),
]


def _selection(done: list[dict], key: str, median_all: dict[int, float], chosen) -> dict:
    """How the chosen companies did, in total and against the typical company
    bought the same year. `lead` is a name's return minus that year's median."""
    picked = [r for r in done if chosen(r)]
    leads = [r[key] - median_all[r["year"]] for r in picked]
    by_year = []
    for year in sorted(median_all):
        got = [r[key] for r in picked if r["year"] == year]
        by_year.append({
            "year": year, "n": len(got),
            "median": round(statistics.median(got), 1) if got else None,
            "lead": round(statistics.median(got) - median_all[year], 1) + 0.0 if got else None,
        })
    yearly = [y["lead"] for y in by_year if y["lead"] is not None]
    return {
        **_outcome([r[key] for r in picked]),
        "median_lead": round(statistics.median(leads), 1) + 0.0 if leads else None,
        "beat_their_year_pct": round(100 * sum(x > 0 for x in leads) / len(leads), 1) if leads else None,
        "years_tested": len(yearly),
        "years_ahead": sum(x > 0 for x in yearly),
        "mean_yearly_lead": round(statistics.fmean(yearly), 1) + 0.0 if yearly else None,  # no "-0.0"
        "by_year": by_year,
    }


def summarize(rows: list[dict], horizon: int) -> dict:
    """The rule's estimate against what happened, over `horizon` years."""
    key = f"got_{horizon}y"
    done = [r for r in rows if r[key] is not None and not r["suspect"]]

    median_all, by_year = {}, []
    for year in sorted({r["year"] for r in done}):
        cohort = [r for r in done if r["year"] == year]
        median_all[year] = statistics.median(r[key] for r in cohort)
        rank = spearmanr([r["expected"] for r in cohort], [r[key] for r in cohort])[0] \
            if len(cohort) >= 20 else None
        by_year.append({
            "year": year, "companies": len(cohort), "median": round(median_all[year], 1),
            "rank_correlation": round(float(rank), 3) if rank is not None and rank == rank else None,
        })
    ranks = [y["rank_correlation"] for y in by_year if y["rank_correlation"] is not None]

    return {
        "horizon_years": horizon,
        "groups": [{"expected": label,
                    **_outcome([r[key] for r in done if lo <= r["expected"] < hi])}
                   for label, lo, hi in GROUPS],
        "all": {**_outcome([r[key] for r in done]), "by_year": by_year},
        "selections": [{"key": name, "label": label, **_selection(done, key, median_all, chosen)}
                       for name, label, chosen in SELECTIONS],
        "mean_rank_correlation": round(statistics.fmean(ranks), 3) if ranks else None,
        "suspect_dropped": len([r for r in rows if r[key] is not None and r["suspect"]]),
    }


def verdict(five: dict) -> dict:
    """The five-year result in plain words. The picks must beat the other
    companies of the same start year, in most years and by a clear margin,
    before this calls it an edge: a group that only looks good pooled may
    just have been bought in good years."""
    picks = next(x for x in five["selections"] if x["key"] == "picks")
    tested, ahead, lead = picks["years_tested"], picks["years_ahead"], picks["mean_yearly_lead"]
    reliable = bool(tested) and ahead >= 0.8 * tested and lead >= 2.0
    return {
        "reliable_edge": reliable,
        "headline": ("The rule's picks beat the other companies in most years."
                     if reliable else
                     "No reliable edge: the rule's picks did not beat the other "
                     "companies of the same year by a clear margin."),
        "detail": (f"Names scored {FLOOR:.0f}% or more earned a median {picks['median']}% a year "
                   f"over the next five years; all companies earned {five['all']['median']}%. "
                   f"Set against companies of the same start year, the picks were ahead in "
                   f"{ahead} of {tested} years, by {lead} points on average. "
                   f"{picks['reached_floor_pct']}% of the picks reached {FLOOR:.0f}% a year."),
    }


def compute() -> dict:
    rows = observe(screen.Records.load())
    horizons = [summarize(rows, h) for h in HORIZONS]
    return {
        "ran_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "rule": {"floor_pct": FLOOR, "target_pct": TARGET,
                 "horizon_years": valuation.HORIZON,
                 "growth_cap_pct": valuation.GROWTH_CAP * 100,
                 "exit_pe_cap": valuation.EXIT_PE_CAP},
        "start_dates": "30 June of each year",
        "first_year": FIRST_YEAR,
        "observations": len(rows),
        "verdict": verdict(horizons[-1]),
        "horizons": horizons,
        "caveats": CAVEATS,
    }


def run() -> dict:
    """Replay the rule over the whole store, save the result, log the trial."""
    out = compute()
    RESULT_PATH.write_text(json.dumps(out, indent=1))
    five = out["horizons"][-1]
    monitor.log_experiment(
        "replay", {"first_year": FIRST_YEAR, "floor_pct": FLOOR, "observations": out["observations"]},
        {"mean_rank_correlation_5y": five["mean_rank_correlation"],
         **{f"{x['key']}_5y": {k: x[k] for k in ("n", "median_lead", "years_ahead", "years_tested")}
            for x in five["selections"]}})
    return out


def latest() -> dict | None:
    try:
        return json.loads(RESULT_PATH.read_text())
    except (OSError, ValueError):
        return None


if __name__ == "__main__":
    result = run()
    for h in result["horizons"]:
        print(f"\n== {h['horizon_years']}-year outcome ==  all companies: median {h['all']['median']}%")
        for x in h["selections"]:
            print(f"  {x['label']:<34} n={x['n']:>5}  median {x['median']}%  "
                  f"lead on their year {x['median_lead']} pts  beat it {x['beat_their_year_pct']}%  "
                  f"ahead in {x['years_ahead']} of {x['years_tested']} years")
