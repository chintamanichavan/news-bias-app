"""The two-tier mandate must stay coherent: both books present, the firewall
non-empty, and the snapshot assembling live status without a network."""

import mandates


def test_mandate_snapshot_offline(tmp_db, monkeypatch):
    import portfolio
    monkeypatch.setattr(portfolio, "watchlist", lambda: [{"ticker": "WDFC"}])
    snap = mandates.snapshot()
    keys = [m["key"] for m in snap["mandates"]]
    assert keys == ["wealth", "rich"]
    assert snap["firewall"] and all(isinstance(r, str) for r in snap["firewall"])
    wealth, rich = snap["mandates"]
    assert wealth["status"]["watchlist_names"] == 1
    # A fresh registry has no cleared alpha study: the gate must be closed.
    assert rich["status"]["alpha_gate"]["cleared"] is False
    for m in snap["mandates"]:
        assert m["entry_discipline"] and m["exit_discipline"]
