"""The live record: which names a snapshot lists, how a period's return is
read, and that a snapshot is never rewritten."""

import json

import pandas as pd
import pytest

import pit
import tracker


@pytest.fixture()
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(pit, "PIT_ROOT", tmp_path / "pit")
    monkeypatch.setattr(tracker, "DIR", tmp_path / "tracker")
    return tmp_path


def _g(won):
    return {"won_10y": won, "label": "x"}


def test_lists():
    groups = {"A": {"issuance": _g(.93), "profitability": _g(.87), "momentum": _g(.94)},
              "B": {"issuance": _g(.93), "profitability": _g(.73), "momentum": _g(.3)},
              "C": {"issuance": _g(.02), "profitability": _g(.87), "momentum": _g(.94)},
              "D": {"profitability": _g(.87)}}
    out = tracker.lists(groups)
    assert out["good_all_three"] == ["A"]
    assert out["buyback_profitable"] == ["A", "B"]
    assert out["control"] == ["A", "B", "C", "D"]


def _prices(rows):
    pit.write_snapshot("prices_eod", pd.DataFrame(
        [{"symbol": s, "date": pd.Timestamp(d), "open": None, "high": None, "low": None,
          "close": float(c), "volume": 1.0, "source": "test"} for s, d, c in rows]))


def test_period_return_adds_dividends_and_keeps_a_dead_name_at_its_last_price(tmp_store):
    _prices([("A", "2026-01-30", 100), ("A", "2026-02-27", 110),
             ("GONE", "2026-01-30", 50), ("GONE", "2026-02-10", 40)])
    pit.write_snapshot("corporate_actions", pd.DataFrame(
        [{"symbol": "A", "date": pd.Timestamp("2026-02-15"), "kind": "dividend", "value": 2.0,
          "source": "test"}]))
    r = tracker.period_returns(["A", "GONE", "NEW"], "2026-01-31", "2026-02-28")
    assert r["A"] == pytest.approx(0.12)
    assert r["GONE"] == pytest.approx(-0.2)
    assert "NEW" not in r


def test_record_chains_the_periods(tmp_store, monkeypatch):
    tracker.DIR.mkdir(parents=True)
    for day, price_day, names in (("2026-01-31", "2026-01-30", ["A"]), ("2026-02-28", "2026-02-27", ["A"])):
        (tracker.DIR / f"{day}.json").write_text(json.dumps({
            "date": day, "price_date": price_day,
            "lists": {"good_all_three": names, "buyback_profitable": names, "control": names}}))
    returns = {("2026-01-30", "2026-02-27"): {"A": 0.10, "SPY": 0.05},
               ("2026-02-27", "2026-03-31"): {"A": -0.05, "SPY": 0.02}}
    monkeypatch.setattr(tracker, "period_returns", lambda names, s, e: returns[(s, e)])
    out = tracker.record(latest="2026-03-31")
    assert [p["good_all_three"] for p in out["periods"]] == [0.10, -0.05]
    assert out["total"]["good_all_three"] == pytest.approx(1.10 * 0.95 - 1)
    assert out["total"]["spy"] == pytest.approx(1.05 * 1.02 - 1)


def test_a_snapshot_is_never_rewritten(tmp_store, monkeypatch):
    monkeypatch.setattr(tracker.scorecard, "cards", lambda day: [{"ticker": "A"}])
    monkeypatch.setattr(tracker.evidence, "company_groups", lambda day, t: {"A": {}})
    monkeypatch.setattr(tracker.pricer, "market_values",
                        lambda day, t: {"A": {"price": 1.0, "date": day}, "SPY": {"price": 1.0, "date": day}})
    tracker.snapshot("2026-03-31")
    with pytest.raises(FileExistsError):
        tracker.snapshot("2026-03-31")
