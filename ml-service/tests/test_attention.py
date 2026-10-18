"""Attention measures on view counts whose answer is known by hand."""

import math

import pandas as pd

import attention


def test_spike_and_growth_use_only_complete_months_before_the_day():
    months = pd.period_range("2016-01", "2018-06", freq="M").strftime("%Y%m")
    views = pd.DataFrame({"symbol": "CIK0000000001", "month": months,
                          "views": [100] * 27 + [400, 400, 9999]})   # Apr-May 2018 jump; June not yet complete
    f = attention.features("2018-06-30", views).iloc[0]
    # last 3 complete months Mar-May: 100, 400, 400 -> 300 against 100 before
    assert math.isclose(f["attention_spike"], math.log(301 / 101))
    # last 12 (Jun 2017-May 2018): 10*100 + 2*400 = 1800 against 1200
    assert math.isclose(f["attention_growth"], math.log(1801 / 1201))
