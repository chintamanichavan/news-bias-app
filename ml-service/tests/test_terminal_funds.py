"""Funds: simplex projection, style weights and monthly returns."""

import pytest

from terminal import funds


def test_projection_onto_the_simplex():
    w = funds.project_simplex([0.5, 0.5, 0.5])
    assert sum(w) == pytest.approx(1) and w == pytest.approx([1 / 3] * 3)
    assert funds.project_simplex([2.0, -1.0]) == pytest.approx([1.0, 0.0])


def test_style_recovers_a_sixty_forty_blend():
    a = [0.02, -0.01, 0.03, 0.00, -0.02, 0.015, 0.01, -0.005, 0.025, -0.015, 0.005, 0.02]
    b = [0.001, 0.004, -0.002, 0.003, 0.002, -0.001, 0.0, 0.002, -0.003, 0.004, 0.001, 0.0]
    c = [0.01, 0.02, -0.01, -0.02, 0.0, 0.01, -0.01, 0.02, 0.0, -0.01, 0.01, 0.0]
    y = [0.6 * x + 0.4 * z for x, z in zip(a, b)]
    w = funds.style_weights(y, [[x, z, v] for x, z, v in zip(a, b, c)])
    assert w == pytest.approx([0.6, 0.4, 0.0], abs=1e-4)


def test_monthly_returns_use_adjusted_closes():
    bars = [{"date": "2026-01-30", "close": 10, "adj_close": 100}, {"date": "2026-02-27", "close": 10, "adj_close": 110}]
    assert funds.monthly_returns(bars) == {"2026-02": pytest.approx(0.1)}


def test_report_reads_yahoo_fund_modules():
    qs = {"fundProfile": {"categoryName": "Large Blend", "family": "Vanguard", "feesExpensesInvestment": {"annualReportExpenseRatio": {"raw": 0.0004}}},
          "fundPerformance": {"trailingReturns": {"oneYear": {"raw": 0.15}}, "trailingReturnsCat": {"oneYear": {"raw": 0.12}}},
          "topHoldings": {"holdings": [{"symbol": "NVDA", "holdingName": "NVIDIA", "holdingPercent": {"raw": 0.08}}],
                          "bondHoldings": {"duration": {"raw": 3.9}}}}
    r = funds.report(qs)
    assert r["category"] == "Large Blend" and r["expense_ratio"] == 0.0004 and "duration" not in r
    assert next(t for t in r["trailing"] if t["period"] == "1 year") == {"period": "1 year", "fund": 0.15, "category": 0.12}
    assert r["holdings"][0]["weight"] == 0.08


def test_empirical_duration_of_a_seven_year_bond():
    # each day the yield moves dy points and the fund moves -7 * dy / 100
    moves = [0.05, -0.03, 0.02, -0.04, 0.01, 0.03, -0.02, -0.01, 0.04, -0.05] * 8
    y, p = [4.0], [100.0]
    for dy in moves:
        y.append(y[-1] + dy)
        p.append(p[-1] * (1 - 7 * dy / 100))
    days = [f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(len(y))]
    d = funds.empirical_duration([{"date": a, "close": b} for a, b in zip(days, p)], [{"date": a, "close": b} for a, b in zip(days, y)])
    assert d == pytest.approx(7.0)
