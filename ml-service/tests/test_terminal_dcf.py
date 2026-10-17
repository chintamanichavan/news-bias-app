"""WACC, DCF and DDM against hand-worked textbook numbers."""

import pytest

from terminal import dcf


def test_wacc_textbook():
    # E 600, D 400, Ke 10%, Kd 5%, tax 25%: 0.6*10% + 0.4*3.75% = 7.5%
    assert dcf.wacc(600, 400, 0.10, 0.05, 0.25) == pytest.approx(0.075)
    assert dcf.cost_of_equity(0.04, 1.2, 0.05) == pytest.approx(0.10)


def test_gordon_growth():
    # D0 2, g 5%, r 10%: D1 2.10 / 5% = 42
    assert dcf.gordon(2.10, 0.10, 0.05) == pytest.approx(42)
    assert dcf.gordon(1, 0.05, 0.05) is None


def test_two_stage_collapses_to_gordon_when_growth_is_constant():
    m = dcf.two_stage(2.0, 0.10, 0.05, 5, 0.05)
    assert m["total"] == pytest.approx(42)
    # by hand for one year of 20% then 0%: 120/1.1 + (120/0.1)/1.1
    m = dcf.two_stage(100, 0.10, 0.20, 1, 0.0)
    assert m["explicit"] == pytest.approx(120 / 1.1) and m["terminal"] == pytest.approx(1200 / 1.1)


def test_parse_erp_with_split_number():
    html = "<b>Implied ERP on October 1, 2026 = 4.</b> 20% (Trailing 12 month)"
    assert dcf.parse_erp(html) == (pytest.approx(0.042), "October 1, 2026")


def test_beta_of_a_stock_that_moves_twice_the_market():
    from datetime import date, timedelta
    start = date(2024, 1, 5)          # a Friday
    market, stock, m, s = [], [], 100.0, 100.0
    for k in range(60):
        r = 0.01 if k % 2 else -0.008
        m *= 1 + r
        s *= 1 + 2 * r
        d = (start + timedelta(weeks=k)).isoformat()
        market.append({"date": d, "close": m})
        stock.append({"date": d, "close": s})
    b = dcf.weekly_beta(stock, market)
    assert b["raw"] == pytest.approx(2.0) and b["adjusted"] == pytest.approx(5 / 3)


def test_apply_runs_every_model_and_respects_overrides():
    i = {"price": 50.0, "shares": 100.0, "market_cap": 5000.0, "debt": 1000.0, "cash": 200.0, "interest": 50.0,
         "tax": 0.25, "fcf": 300.0, "revenue_growth_3y": 0.30, "rf": 0.04, "erp": 0.05,
         "beta": {"adjusted": 1.0}, "dividend_ttm": 2.0, "dividend_growth_5y": 0.05}
    m = dcf.apply(i, {})
    assert m["ke"] == pytest.approx(0.09) and m["kd"] == pytest.approx(0.05)
    assert m["growth"] == dcf.MAX_GROWTH                        # 30% is capped
    assert m["dcf"]["equity_value"] == pytest.approx(m["dcf"]["enterprise_value"] - 800)
    assert m["ddm"]["growth"] == 0.05
    assert dcf.apply(i, {"wacc": 0.12})["wacc"] == 0.12
    grid = m["dcf"]["sensitivity"]
    assert grid["per_share"][2][2] == pytest.approx(m["dcf"]["per_share"])       # the middle is the model itself
    assert grid["per_share"][0][2] > grid["per_share"][4][2]                       # a higher rate is worth less
    assert dcf.apply({**i, "rf": None}, {})["missing"] == ["risk-free rate"]
    bank = dcf.apply({**i, "financial": True}, {})
    assert bank["wacc"] is None and "dcf" not in bank and "ddm" in bank
