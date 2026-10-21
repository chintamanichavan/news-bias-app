"""The replay's arithmetic, on outcomes written by hand."""

import replay


def _row(year, expected, got, quality=True, suspect=False, durable=None):
    return {"year": year, "ticker": "X", "expected": expected, "suspect": suspect,
            "quality": quality, "durable": durable,
            "got_1y": got, "got_3y": got, "got_5y": got}


def _pick(summary, key="picks"):
    return next(x for x in summary["selections"] if x["key"] == key)


def test_groups_and_lead_over_the_same_year():
    rows = ([_row(2015, 18.0, 20.0), _row(2015, 25.0, 10.0, quality=False), _row(2015, 5.0, 6.0),
             _row(2015, -3.0, -2.0), _row(2015, 9.0, 8.0)]
            + [_row(2016, 16.0, 4.0), _row(2016, 2.0, 12.0), _row(2016, 3.0, 14.0)])
    s = replay.summarize(rows, 5)

    by_label = {g["expected"]: g for g in s["groups"]}
    assert by_label["15% to 20%"]["n"] == 2 and by_label["20% and up"]["n"] == 1
    assert by_label["below 0%"]["lost_money_pct"] == 100.0
    assert [y["median"] for y in s["all"]["by_year"]] == [8.0, 12.0]

    picks = _pick(s)
    assert picks["n"] == 3 and picks["median"] == 10.0 and picks["reached_floor_pct"] == 33.3
    y2015, y2016 = picks["by_year"]
    assert y2015["median"] == 15.0 and y2015["lead"] == 7.0
    assert y2016["lead"] == -8.0            # the one pick earned 4, the year's median 12
    assert picks["years_tested"] == 2 and picks["years_ahead"] == 1
    # each pick against its own year's median: +12, +2, -8
    assert picks["median_lead"] == 2.0 and picks["beat_their_year_pct"] == 66.7

    both = _pick(s, "quality_picks")
    assert both["n"] == 2 and both["by_year"][0]["n"] == 1


def test_unknown_outcomes_and_suspect_estimates_are_left_out():
    rows = [_row(2015, 18.0, 20.0), _row(2015, 900.0, 50.0, suspect=True),
            {**_row(2024, 18.0, None), "got_1y": 7.0}]
    five, one = replay.summarize(rows, 5), replay.summarize(rows, 1)
    assert _pick(five)["n"] == 1 and five["suspect_dropped"] == 1
    assert _pick(one)["n"] == 2


def test_verdict_needs_most_years_and_a_clear_margin():
    def five(ahead, lead):
        return {"all": {"median": 9.0}, "selections": [{
            "key": "picks", "median": 12.0, "reached_floor_pct": 40.0,
            "years_tested": 10, "years_ahead": ahead, "mean_yearly_lead": lead}]}
    weak, strong = replay.verdict(five(7, 0.0)), replay.verdict(five(9, 3.1))
    assert weak["reliable_edge"] is False and strong["reliable_edge"] is True
    assert "7 of 10" in weak["detail"]
