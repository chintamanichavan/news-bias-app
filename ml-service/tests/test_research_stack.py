"""The statistics and — critically — the no-lookahead property of the
research stack. The lookahead test is the release-bar regression: it fails
if anyone ever lets day-t's signal trade day-t's return."""

import math

import alpha
import backtest
import monitor
import signal_engine
import simulation


def test_stats_known_series():
    s = backtest._stats([0.01] * 10)
    assert s["total_return_pct"] > 10.0
    assert s["max_drawdown_pct"] == 0.0
    down = backtest._stats([-0.10, 0.05])
    assert down["max_drawdown_pct"] <= -10.0
    empty = simulation._stats([])
    assert empty["total_return_pct"] == 0.0


def test_no_lookahead_in_portfolio_backtest():
    # 6 trading days; a single +50% pop on day 2 for the only signaled name.
    dates = [f"2026-01-0{i}" for i in range(1, 7)]
    closes = {
        "AAA": {d: p for d, p in zip(dates, [100, 100, 150, 150, 150, 150])},
        "BBB": {d: 100.0 for d in dates},
        "CCC": {d: 100.0 for d in dates},
        "DDD": {d: 100.0 for d in dates},
    }
    # Signal appears ONLY on the pop day itself — clairvoyant if leaked.
    panel = {"AAA": {dates[2]: 1.0}, "BBB": {}, "CCC": {}, "DDD": {}}
    rets = backtest._daily_strategy_returns(dates, closes, panel, list(closes), window=1, lo=1, hi=len(dates))
    total = math.prod(1 + r for r in rets) - 1
    # Day-2's +50% must NOT be captured (signal known only after the close);
    # a leaky implementation returns ~+50% here.
    assert total < 0.05, f"lookahead leak: strategy captured {total:.1%}"


def test_hurst_and_acf_discriminate():
    import lab

    import math as _m
    # persistent drift with mild deterministic wobble (pure trend has zero
    # return variance, which R/S can't use)
    rets = [0.01 + 0.005 * _m.sin(i / 3) for i in range(240)]
    trending = [100.0]
    for r in rets:
        trending.append(trending[-1] * (1 + r))
    h = lab._hurst(trending)
    assert h is not None and h > 0.55  # the Lab's own "trending" boundary
    # perfectly alternating returns: strong negative lag-1 autocorrelation
    assert lab._acf([(-1.0) ** i for i in range(50)], 1) < -0.9


def test_alpha_verdict_rules():
    assert "null" in alpha._verdict({"mean": -0.01, "t_stat": -0.3}).lower()
    assert "not significant" in alpha._verdict({"mean": 0.01, "t_stat": 1.0})
    assert "worth sizing" in alpha._verdict({"mean": 0.05, "t_stat": 2.5})


def test_signal_engine_composites_offline(tmp_db, offline_universe):
    conn = tmp_db.get_conn()
    conn.execute(
        "INSERT INTO articles (id, source_id, title, body, url, published, sentiment_score) "
        "VALUES ('a1', 'reuters', 'Fed signals rate cut as inflation cools', '', 'u', datetime('now'), -0.5)"
    )
    conn.commit(); conn.close()

    results = signal_engine.compute_composites(vix=30.0)
    by_entity = {r["entity"]: r for r in results}
    assert {"markets", "weather"} <= set(by_entity)
    mkts = by_entity["markets"]
    assert mkts["components"]["news"] is not None and mkts["components"]["news"] < 0
    assert mkts["components"]["vol"] < 0  # VIX 30 is a risk-off regime
    assert -1.0 <= mkts["composite"] <= 1.0

    conn = tmp_db.get_conn()
    n = conn.execute("SELECT COUNT(*) FROM signal_snapshots").fetchone()[0]
    conn.close()
    assert n >= 2, "every cycle must persist snapshots"


def test_experiments_log_roundtrip(tmp_db):
    monitor.log_experiment("test", {"p": 1}, {"m": 2.0})
    rows = monitor.experiments()
    assert rows and rows[0]["kind"] == "test" and rows[0]["metrics"]["m"] == 2.0
    health = monitor.pipeline_health()
    assert health["overall"] in {"ok", "stale", "failing"}
    assert len(health["components"]) >= 5
