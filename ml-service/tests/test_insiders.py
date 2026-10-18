"""Routine and opportunistic insiders, on trades whose answer is known by hand."""

import pandas as pd

import insiders


def trades(rows):
    df = pd.DataFrame(rows, columns=["cik", "owner", "code", "trade_date", "filed", "value"])
    df["trade_date"] = pd.to_datetime(df["trade_date"])
    df["filed"] = pd.to_datetime(df["filed"])
    return df


def test_same_month_three_years_running_is_routine():
    t = trades([(1, 10, "S", f"{y}-03-15", f"{y}-03-17", 1.0) for y in (2012, 2013, 2014)] +
               [(1, 20, "P", d, d, 1.0) for d in ("2012-02-01", "2013-05-01", "2014-09-01")] +
               [(1, 30, "P", "2014-03-01", "2014-03-01", 1.0)])
    r = insiders.routine(t, 2015).set_index("owner")["routine"]
    assert r[10] == True and r[20] == False      # noqa: E712
    assert 30 not in r.index                     # not trading in all three years: unclassified


def test_features_count_only_what_was_filed_by_the_day():
    t = trades([(1, 20, "P", d, d, 5.0) for d in ("2012-02-01", "2013-05-01", "2014-04-01")] +
               [(1, 20, "P", "2015-05-01", "2015-05-02", 7.0),
                (1, 20, "P", "2015-06-25", "2015-07-03", 9.0),     # filed after the day
                (1, 40, "S", "2015-04-01", "2015-04-02", 1.0)])
    f = insiders.features("2015-06-30", t).set_index("symbol").loc["CIK0000000001"]
    assert f["opportunistic_buys"] == 1 and f["opportunistic_buy_value"] == 7.0
    assert f["net_purchase_ratio"] == 0.0        # one buy, one sale in six months
