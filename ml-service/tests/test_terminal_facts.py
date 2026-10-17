"""XBRL facts: quarters, trailing sums, point-in-time lookups, Altman and Merton."""

import math

import pytest

from terminal import facts


def e(start, end, val, filed, **kw):
    return {"start": start, "end": end, "val": val, "filed": filed, "form": "10-Q", **kw}


def test_fourth_quarter_is_the_year_less_three_quarters():
    g = {"Revenues": {"units": {"USD": [
        e("2025-01-01", "2025-03-31", 10, "2025-04-30"), e("2025-04-01", "2025-06-30", 20, "2025-07-30"),
        e("2025-07-01", "2025-09-30", 30, "2025-10-30"), e("2025-01-01", "2025-12-31", 100, "2026-02-15", form="10-K"),
    ]}}}
    q = facts.quarterly(g, ["Revenues"])
    assert [x["val"] for x in q] == [10, 20, 30, 40]
    assert q[-1]["derived"] and q[-1]["filed"] == "2026-02-15"
    assert facts.annual(g, ["Revenues"])[0]["val"] == 100


def test_restatements_win_and_ttm_skips_gaps():
    g = {"EPS": {"units": {"USD/shares": [
        e("2025-01-01", "2025-03-31", 1.0, "2025-04-30"), e("2025-01-01", "2025-03-31", 0.9, "2026-04-30"),
        e("2025-04-01", "2025-06-30", 1.0, "2025-07-30"), e("2025-07-01", "2025-09-30", 1.0, "2025-10-30"),
        e("2025-10-01", "2025-12-31", 1.0, "2026-02-15"), e("2026-04-01", "2026-06-30", 1.0, "2026-07-30"),
    ]}}}
    q = facts.quarterly(g, ["EPS"], "USD/shares")
    assert q[0]["val"] == 0.9                                  # the later filing's figure
    t = facts.ttm(q)
    assert [x["end"] for x in t] == ["2025-12-31"]             # 2026-Q1 is missing, so no later window
    assert t[0]["val"] == pytest.approx(3.9)


def test_as_of_never_uses_a_later_filing():
    s = [{"end": "2025-12-31", "val": 4, "filed": "2026-02-15"}, {"end": "2025-09-30", "val": 3, "filed": "2025-10-30"}]
    assert facts.as_of(s, "2026-01-15")["val"] == 3
    assert facts.as_of(s, "2026-02-15")["val"] == 4
    assert facts.as_of(s, "2025-01-01") is None


def test_altman_by_hand():
    # TA 1000, CA 400, CL 200, RE 300, EBIT 100, sales 1200, TL 500, MVE 1500
    z = facts.altman(1000, 400, 200, 300, 100, 1200, 500, 1500)
    assert z["z"] == pytest.approx(1.2 * 0.2 + 1.4 * 0.3 + 3.3 * 0.1 + 0.6 * 3 + 1.0 * 1.2)
    assert z["zone"] == "safe"
    assert facts.altman(1000, 100, 300, -200, -50, 300, 900, 100)["zone"] == "distress"


def test_merton_recovers_the_firm_it_was_built_from():
    v, sv, d, r = 150.0, 0.25, 100.0, 0.04
    d1 = (math.log(v / d) + (r + sv * sv / 2)) / sv
    d2 = d1 - sv
    equity = v * facts._cdf(d1) - d * math.exp(-r) * facts._cdf(d2)
    sigma_e = facts._cdf(d1) * sv * v / equity
    m = facts.merton(equity, sigma_e, d, r)
    assert m["assets"] == pytest.approx(v, rel=1e-6)
    assert m["asset_vol"] == pytest.approx(sv, rel=1e-6)
    assert m["distance_to_default"] == pytest.approx((math.log(v / d) + (r - sv * sv / 2)) / sv, rel=1e-6)


def test_tags_merge_period_by_period_preferring_the_first():
    g = {"Revenues": {"units": {"USD": [e("2017-01-01", "2017-12-31", 100, "2018-02-01", form="10-K"),
                                        e("2018-01-01", "2018-12-31", 999, "2019-02-01", form="10-K")]}},
         "RevenueFromContract": {"units": {"USD": [e("2018-01-01", "2018-12-31", 110, "2019-02-01", form="10-K"),
                                                   e("2019-01-01", "2019-12-31", 120, "2020-02-01", form="10-K")]}}}
    assert [x["val"] for x in facts.annual(g, ["Revenues", "RevenueFromContract"])] == [100, 999, 120]


def test_split_factor():
    splits = [{"date": "2020-08-31", "ratio": "4:1"}, {"date": "2014-06-09", "ratio": "7:1"}]
    assert facts.split_factor(splits, "2019-10-30") == 4
    assert facts.split_factor(splits, "2014-01-28") == 28
    assert facts.split_factor(splits, "2021-01-28") == 1


def test_original_keeps_the_first_filing():
    rows = [{"end": "2025-03-31", "val": 1.0, "filed": "2025-04-30"}, {"end": "2025-03-31", "val": 0.9, "filed": "2026-04-30"}]
    assert facts.latest_by_end(rows)["2025-03-31"]["val"] == 0.9
    assert facts.latest_by_end(rows, original=True)["2025-03-31"]["val"] == 1.0
