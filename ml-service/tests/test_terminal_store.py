"""Terminal step 16: watchlists, notes and alerts, against a throwaway file."""

import json
from pathlib import Path

import pytest

from terminal import alerts, quotes, store


@pytest.fixture(autouse=True)
def tmp_store(tmp_path, monkeypatch):
    monkeypatch.setattr(store, "PATH", tmp_path / "terminal.db")


def test_watchlists_keep_order_ignore_repeats_and_upper_case():
    store.add_member("Main", "aapl")
    store.add_member("Main", "MSFT")
    store.add_member("Main", "AAPL")
    store.add_member("Tech", "NVDA")
    assert store.members("Main") == ["AAPL", "MSFT"]
    assert store.lists() == [{"name": "Main", "count": 2}, {"name": "Tech", "count": 1}]
    store.remove_member("Main", "aapl")
    assert store.members("Main") == ["MSFT"]


def test_notes_by_security_and_all():
    store.add_note("aapl", "watch services margin")
    store.add_note(None, "Fed on the 28th")
    assert [n["body"] for n in store.notes("AAPL")] == ["watch services margin"]
    assert len(store.notes(None)) == 2
    store.delete_note(store.notes("AAPL")[0]["id"])
    assert store.notes("AAPL") == []


def test_values_never_reach_the_sql_text():
    store.add_note("X'); DROP TABLE notes; --", "hostile")
    assert len(store.notes(None)) == 1


def test_alert_rule_and_firing_once():
    assert alerts.crossed("above", 100, 100) and not alerts.crossed("above", 100, 99.9)
    assert alerts.crossed("below", 100, 99) and not alerts.crossed("below", 100, 101)
    a = store.add_alert("aapl", "above", 350.0, None)
    store.add_alert("MSFT", "below", 500.0, "buy zone")
    waiting = [x for x in store.alerts() if x["triggered_at"] is None]
    fired = alerts.due(waiting, {"AAPL": 351.0, "MSFT": 520.0})
    assert [(x["symbol"], p) for x, p in fired] == [("AAPL", 351.0)]
    store.mark_triggered(a, 351.0)
    store.mark_triggered(a, 360.0)                       # a second firing changes nothing
    done = next(x for x in store.alerts() if x["id"] == a)
    assert done["triggered_price"] == 351.0
    assert store.alerts()[0]["symbol"] == "MSFT"         # still-waiting alerts list first


def test_quote_batch_parse():
    got = quotes.parse(json.loads((Path(__file__).parent / "fixtures" / "quote_batch.json").read_text()))
    assert set(got) == {"AAPL", "MSFT", "VOD.L", "EURUSD=X", "^GSPC", "BTC-USD"}
    assert got["AAPL"]["price"] == 343.46 and got["AAPL"]["bid"] == 340.0
