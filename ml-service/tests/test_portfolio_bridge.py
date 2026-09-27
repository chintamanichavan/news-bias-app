import portfolio


def _workspace(tmp_path):
    (tmp_path / "watchlist").mkdir()
    (tmp_path / "allocation").mkdir()
    (tmp_path / "decisions").mkdir()
    (tmp_path / "watchlist" / "businesses.csv").write_text(
        "ticker,name,exchange,currency,sector,moat_type,moat_strength,balance_sheet,status,"
        "date_added,last_reviewed,one_liner,doc_path,buy_below_price,intrinsic_value_estimate,track\n"
        "AAA,Alpha Co,NYSE,USD,tech,network,wide,strong,researching,2026-01-01,2026-01-02,"
        "Best in class.,watchlist/AAA.md,100,150,long_horizon\n"
        "BBB,Beta Co,NYSE,USD,tech,scale,narrow,ok,researching,2026-01-01,2026-01-02,"
        "Runner up.,watchlist/BBB.md,50,60,long_horizon\n"
    )
    (tmp_path / "allocation" / "target.yaml").write_text(
        "base_currency: USD\nallocations:\n"
        "  - { asset_class: equity, region: us-developed, factor: broad, weight: 60 }\n"
        "  - { asset_class: equity, region: emerging, factor: value, weight: 40 }\n"
    )
    (tmp_path / "decisions" / "0001-test.md").write_text(
        "# 0001 — Test decision\n\n- **Status:** Accepted\n"
    )
    (tmp_path / "ips.md").write_text(
        "# IPS\n\n> a blockquote to skip\n\nThe **policy** is simple: `hold` through drawdowns and rebalance on thresholds only.\n"
    )
    return tmp_path


def test_report_joins_and_buy_zones(tmp_path, tmp_db, monkeypatch):
    monkeypatch.setattr(portfolio, "PF_DIR", _workspace(tmp_path))
    rep = portfolio.report({"AAA": 90.0, "BBB": 55.0})

    by = {n["ticker"]: n for n in rep["watchlist"]}
    assert by["AAA"]["in_buy_zone"] is True          # 90 <= 100
    assert by["BBB"]["in_buy_zone"] is False         # 55 > 50
    assert by["AAA"]["to_buy_zone_pct"] == -10.0
    assert by["AAA"]["upside_pct"] > 60              # 150/90 - 1
    assert rep["in_buy_zone"] == ["AAA"]
    assert rep["watchlist"][0]["ticker"] == "AAA"    # sorted by distance to zone

    assert rep["targets"]["allocations"][0]["weight"] == 60
    assert rep["decisions"][0]["status"] == "Accepted"
    # markdown syntax stripped from the IPS excerpt
    assert "**" not in rep["ips_excerpt"] and "`" not in rep["ips_excerpt"]
    assert rep["ips_excerpt"].startswith("The policy is simple")


def test_missing_workspace_degrades(tmp_path, tmp_db, monkeypatch):
    monkeypatch.setattr(portfolio, "PF_DIR", tmp_path / "nope")
    rep = portfolio.report({})
    assert rep["available"] is False
    assert rep["watchlist"] == [] and rep["decisions"] == []
