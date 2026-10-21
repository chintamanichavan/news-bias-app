"""The screen reads a company's record as it was known on a day: filings
count from their filing date, later prices are never read, and per-share
figures are carried into today's share units."""

from datetime import date

import pandas as pd
import pytest

import screen


def _fact(tag, year, value, filed, unit="USD", symbol="AAA"):
    instant = tag == "StockholdersEquity"
    return {"symbol": symbol, "tag": tag, "unit": unit,
            "period_start": None if instant else f"{year}-01-01",
            "period_end": f"{year}-12-31", "value": float(value), "filed_at": filed}


def _company(eps_by_year, splits=(), restated=()):
    """AAA: steady 20%-ROE business. Each year's results are filed the
    following 1 March. Price is 20 x that year's EPS in today's units."""
    facts = []
    for year, eps in eps_by_year.items():
        filed = f"{year + 1}-03-01"
        facts += [
            _fact("EarningsPerShareDiluted", year, eps, filed, "USD/shares"),
            _fact("Revenues", year, 1000 * 1.1 ** (year - 2010), filed),
            _fact("NetIncomeLoss", year, 100, filed),
            _fact("StockholdersEquity", year, 500, filed),
            _fact("NetCashProvidedByUsedInOperatingActivities", year, 120, filed),
            _fact("WeightedAverageNumberOfDilutedSharesOutstanding", year, 100, filed, "shares"),
        ]
    for year, eps, filed in restated:
        facts.append(_fact("EarningsPerShareDiluted", year, eps, filed, "USD/shares"))
    return pd.DataFrame(facts), pd.DataFrame(splits, columns=["symbol", "date", "value"])


def _prices(by_year, symbol="AAA"):
    rows = []
    for year, close in by_year.items():
        for month in (3, 6, 9, 12):
            rows.append({"symbol": symbol, "date": f"{year}-{month:02d}-28", "close": float(close)})
    return pd.DataFrame(rows)


NO_ACTIONS = pd.DataFrame({"symbol": [], "date": [], "value": []})
EPS = {y: round(1.0 * 1.1 ** (y - 2010), 4) for y in range(2010, 2021)}
PRICES = {y: 20 * EPS[y] for y in EPS}


def test_a_filing_counts_only_from_the_day_it_was_filed():
    facts, splits = _company(EPS)
    r = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS)
    before = r._by_year("AAA", screen.EPS, screen._day("2016-02-28"), "USD/shares")
    after = r._by_year("AAA", screen.EPS, screen._day("2016-03-01"), "USD/shares")
    assert before[-1][0] == 2014 and after[-1][0] == 2015


def test_a_restatement_replaces_the_figure_only_from_its_own_filing_day():
    facts, splits = _company(EPS, restated=[(2014, 0.5, "2017-03-01")])
    r = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS)
    eps_2014 = lambda day: dict(r._by_year("AAA", screen.EPS, screen._day(day), "USD/shares"))[2014]
    assert eps_2014("2016-06-30") == EPS[2014]
    assert eps_2014("2017-06-30") == 0.5


def test_later_prices_are_never_read():
    facts, splits = _company(EPS)
    crash = {**PRICES, 2019: 1.0, 2020: 1.0}
    calm = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS).assess("AAA", "2018-06-30")
    crashed = screen.Records(facts, _prices(crash), splits, NO_ACTIONS).assess("AAA", "2018-06-30")
    assert calm == crashed


def test_a_split_does_not_change_the_valuation():
    """A 4-for-1 split on 2018-06-01. Filings before it report EPS four times
    larger and a quarter of the shares; filings after it restate nothing here.
    Stored prices are already in today's units. The answer must not move."""
    plain_facts, none = _company(EPS)
    split_facts = plain_facts.copy()
    old_units = pd.to_datetime(split_facts["filed_at"]) < pd.Timestamp("2018-06-01")
    per_share = split_facts["tag"] == "EarningsPerShareDiluted"
    count = split_facts["tag"] == "WeightedAverageNumberOfDilutedSharesOutstanding"
    split_facts.loc[old_units & per_share, "value"] *= 4
    split_facts.loc[old_units & count, "value"] /= 4
    splits = pd.DataFrame([{"symbol": "AAA", "date": "2018-06-01", "value": 4.0}])

    plain = screen.Records(plain_facts, _prices(PRICES), none, NO_ACTIONS).assess("AAA", "2020-06-30")
    split = screen.Records(split_facts, _prices(PRICES), splits, NO_ACTIONS).assess("AAA", "2020-06-30")
    assert split["valuation"]["expected_return_pct"] == pytest.approx(
        plain["valuation"]["expected_return_pct"], abs=0.1)
    assert split["dilution_pct"] == pytest.approx(plain["dilution_pct"], abs=0.1)


def test_the_return_rule_on_a_known_record():
    """EPS and revenue grow 10% a year, P/E has always been 20, price is 20x
    the latest filed EPS. Expected return is the growth: about 10% a year."""
    facts, splits = _company(EPS)
    a = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS).assess("AAA", "2020-03-10")
    v = a["valuation"]
    assert v["growth_pct"] == pytest.approx(10.0, abs=0.1)
    assert v["exit_pe"] == pytest.approx(20.0, abs=0.5)
    # the March price is 20 x 2020 EPS while the latest filed EPS is 2019's,
    # so the price is one year of growth ahead of the earnings it is set against
    assert v["expected_return_pct"] == pytest.approx(7.9, abs=0.5)
    assert a["quality"] is True and v["tier"] is None


def test_no_assessment_before_the_first_filing_or_price():
    facts, splits = _company(EPS)
    r = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS)
    assert r.assess("AAA", "2009-06-30") is None
    assert r.assess("AAA", date(2013, 6, 30))["valuation"] is None   # under five years of EPS


def test_total_return_counts_price_change_and_dividends():
    facts, splits = _company(EPS)
    dividends = pd.DataFrame([{"symbol": "AAA", "date": "2015-01-15", "value": 1.0},
                              {"symbol": "AAA", "date": "2016-01-15", "value": 1.0},
                              {"symbol": "AAA", "date": "2019-01-15", "value": 9.0}])
    r = screen.Records(facts, _prices({y: 20.0 for y in EPS}), splits, dividends)
    day = screen._day("2014-06-30")
    assert r.total_return("AAA", day, 2) == pytest.approx((22 / 20) ** 0.5 - 1)
    assert r.total_return("AAA", day, 1) == pytest.approx(21 / 20 - 1)
    assert r.total_return("AAA", screen._day("2020-06-30"), 5) is None   # the future


def test_durable_needs_a_long_record_of_high_returns():
    """AAA earns 20% on equity every year (100 on 500), with steady margins."""
    facts, splits = _company(EPS)
    r = screen.Records(facts, _prices(PRICES), splits, NO_ACTIONS)
    assert r.assess("AAA", "2016-06-30")["durable"] is None      # six years on record
    assert r.assess("AAA", "2020-06-30")["durable"] is True

    one_loss = facts.copy()
    lost = (one_loss["tag"] == "NetIncomeLoss") & (one_loss["period_end"] == "2015-12-31")
    one_loss.loc[lost, "value"] = -5.0
    assert screen.Records(one_loss, _prices(PRICES), splits, NO_ACTIONS) \
        .assess("AAA", "2020-06-30")["durable"] is False

    thin = facts.copy()
    thin.loc[thin["tag"] == "StockholdersEquity", "value"] = 1000.0   # 10% on equity
    assert screen.Records(thin, _prices(PRICES), splits, NO_ACTIONS) \
        .assess("AAA", "2020-06-30")["durable"] is False
