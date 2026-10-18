"""The scorecard reads a company's filings as they were known on a day, and
its rules give the grades worked out by hand below."""

import json

import numpy as np
import pandas as pd
import pytest

import pit
import scorecard


@pytest.fixture()
def tmp_pit(tmp_path, monkeypatch):
    monkeypatch.setattr(pit, "PIT_ROOT", tmp_path / "pit")
    monkeypatch.setattr(scorecard, "DATA", tmp_path / "scorecard")
    return tmp_path


def _flow(tag, year, value, filed, unit="USD", symbol="AAA"):
    return {"cik": "0000000001", "symbol": symbol, "tag": tag, "unit": unit,
            "period_start": pd.Timestamp(f"{year}-01-01"), "period_end": pd.Timestamp(f"{year}-12-31"),
            "value": float(value), "filed_at": pd.Timestamp(filed)}


def _instant(tag, year, value, filed, symbol="AAA"):
    return {**_flow(tag, year, value, filed, symbol=symbol), "period_start": pd.NaT}


def _write(rows):
    pit.write_snapshot("fundamentals", pd.DataFrame(rows))


def test_parse_facts_keeps_only_scorecard_tags_filed_after_the_period():
    payload = {"cik": 1, "facts": {"us-gaap": {
        "Revenues": {"units": {"USD": [
            {"start": "2020-01-01", "end": "2020-12-31", "val": 100, "filed": "2021-02-01"},
            {"start": "2020-01-01", "end": "2020-12-31", "val": 100, "filed": "2020-06-01"}]}},
        "Goodwill": {"units": {"USD": [{"end": "2020-12-31", "val": 5, "filed": "2021-02-01"}]}},
    }}}
    df = scorecard.parse_facts("AAA", payload)
    assert list(df["tag"]) == ["Revenues"]
    assert df.iloc[0]["cik"] == "0000000001"


def test_moat_grades():
    assert scorecard.moat_grade(pd.Series([0.2] * 8 + [0.05] * 2)) == "wide"
    assert scorecard.moat_grade(pd.Series([0.12] * 6 + [0.05] * 4)) == "narrow"
    assert scorecard.moat_grade(pd.Series([0.2] * 5 + [0.05] * 5)) == "none"
    # a year with no measurable capital is a miss, not a pass
    assert scorecard.moat_grade(pd.Series([0.2] * 7 + [np.nan] * 3)) == "narrow"
    assert scorecard.moat_grade(pd.Series([0.3] * 4)) is None


def test_roic_reads_capital_from_the_operating_side():
    # Buybacks have pushed equity below zero; the operations still tie up
    # 1000 of assets less 100 cash less 300 of suppliers' credit.
    y = pd.DataFrame({"operating_income": [100.0], "assets": [1000.0], "cash": [100.0],
                      "current_liabilities": [350.0], "current_debt": [50.0],
                      "equity": [-200.0], "long_term_debt": [800.0]})
    assert scorecard.roic(y).iloc[0] == pytest.approx(79 / 600)


def test_roic_falls_back_to_equity_plus_debt_less_cash():
    y = pd.DataFrame({"operating_income": [100.0], "assets": [np.nan], "cash": [50.0],
                      "current_liabilities": [np.nan], "current_debt": [np.nan],
                      "equity": [300.0], "long_term_debt": [150.0]})
    assert scorecard.roic(y).iloc[0] == pytest.approx(79 / 400)


def test_altman_z2_by_hand():
    last = pd.Series({"assets": 100.0, "liabilities": 50.0, "current_assets": 40.0,
                      "current_liabilities": 20.0, "retained_earnings": 30.0,
                      "operating_income": 10.0, "equity": 50.0})
    assert scorecard.altman_z2(last) == pytest.approx(6.56 * .2 + 3.26 * .3 + 6.72 * .1 + 1.05 * 1)


def test_a_figure_counts_from_its_first_filing_day(tmp_pit):
    _write([_flow("OperatingIncomeLoss", 2020, 100, "2021-03-01"),
            _flow("OperatingIncomeLoss", 2020, 80, "2022-03-01"),      # a later filing's figure
            # a quarter ending on the year end is not the year
            {**_flow("OperatingIncomeLoss", 2020, 30, "2021-03-01"),
             "period_start": pd.Timestamp("2020-10-01")},
            # an early snapshot without start dates: a flow, never an instant
            {**_flow("OperatingIncomeLoss", 2020, 30, "2021-03-01"), "period_start": pd.NaT},
            _instant("Assets", 2020, 500, "2021-03-01")])
    conn = pit.connect()
    assert scorecard.annual(conn, "2021-02-01", ["AAA"]).empty
    assert scorecard.annual(conn, "2021-06-01", ["AAA"])["operating_income"].tolist() == [100]
    # the first-filed figure stands: the restatement was not known in 2021
    assert scorecard.annual(conn, "2022-06-01", ["AAA"])["operating_income"].tolist() == [100]


def test_missing_liabilities_come_from_assets_less_equity(tmp_pit):
    _write([_flow("Revenues", 2020, 100, "2021-03-01"),
            _instant("Assets", 2020, 500, "2021-03-01"),
            _instant("StockholdersEquity", 2020, 200, "2021-03-01")])
    y = scorecard.annual(pit.connect(), "2021-06-01", ["AAA"])
    assert y["liabilities"].tolist() == [300]


def test_a_stock_split_is_not_share_issuance(tmp_pit):
    tag, u = "WeightedAverageNumberOfDilutedSharesOutstanding", "shares"
    _write([
        # FY2020 report: 100 -> 98 (a 2% buyback)
        _flow(tag, 2019, 100, "2020-03-01", u), _flow(tag, 2020, 98, "2021-03-01", u),
        _flow(tag, 2019, 100, "2021-03-01", u),
        # 3-for-1 split in 2021; the FY2021 report restates 2020 in new units
        _flow(tag, 2020, 294, "2022-03-01", u), _flow(tag, 2021, 288.12, "2022-03-01", u),
    ])
    changes = scorecard.share_changes(pit.connect(), "2022-06-01", ["AAA"])["AAA"]
    assert changes == pytest.approx([-0.02, -0.02])


def test_cards_measure_industry_share_among_members(tmp_pit, monkeypatch):
    monkeypatch.setattr(scorecard, "members", lambda as_of: ["AAA", "BBB", "CCC"])
    (tmp_pit / "scorecard").mkdir()
    (tmp_pit / "scorecard" / "companies.json").write_text(json.dumps({
        "AAA": {"cik": "1", "sic": "5331", "industry": "x", "name": "A"},
        "BBB": {"cik": "2", "sic": "5330", "industry": "x", "name": "B"},
        "CCC": {"cik": "3", "sic": "7372", "industry": "y", "name": "C"}}))
    rows = []
    for sym, rev in (("AAA", 300), ("BBB", 100), ("CCC", 50)):
        for year in range(2015, 2021):
            rows += [_flow("Revenues", year, rev, f"{year + 1}-03-01", symbol=sym),
                     _flow("OperatingIncomeLoss", year, rev / 5, f"{year + 1}-03-01", symbol=sym),
                     _instant("StockholdersEquity", year, rev / 2, f"{year + 1}-03-01", symbol=sym)]
    _write(rows)
    cards = {c["ticker"]: c for c in scorecard.cards("2021-06-01")}
    assert cards["AAA"]["industry_share"] == pytest.approx(0.75)
    assert cards["AAA"]["industry_peers"] == 2
    assert cards["CCC"]["industry_share"] == pytest.approx(1.0)
    # 20% margin x 79% after tax on capital of half of sales: 31.6% every year
    assert cards["AAA"]["moat"] == "wide"
    assert cards["AAA"]["return_median"] == pytest.approx(0.316)


def test_cash_piles_and_missing_operating_lines(tmp_pit):
    _write([_flow("Revenues", 2020, 100, "2021-03-01"),
            # no operating line: pretax 30 plus interest 5
            _flow("IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
                  2020, 30, "2021-03-01"),
            _flow("InterestExpense", 2020, 5, "2021-03-01"),
            _instant("CashAndCashEquivalentsAtCarryingValue", 2020, 10, "2021-03-01"),
            _instant("MarketableSecuritiesCurrent", 2020, 40, "2021-03-01")])
    y = scorecard.annual(pit.connect(), "2021-06-01", ["AAA"])
    assert y["operating_income"].tolist() == [35]
    assert y["cash"].tolist() == [50]


def test_debt_falls_back_from_total_to_parts_to_noncurrent_liabilities():
    y = pd.DataFrame({"total_debt": [90.0, np.nan, np.nan], "long_term_debt": [70.0, 70.0, np.nan],
                      "current_debt": [10.0, 10.0, np.nan], "noncurrent_liabilities": [np.nan, np.nan, 120.0],
                      "liabilities": [200.0, 200.0, 200.0], "current_liabilities": [50.0, 50.0, 50.0]})
    assert scorecard.debt(y).tolist() == [90, 80, 120]
