"""US macro: Taylor rule, NFCI and TIC files."""

import pytest

from terminal import usmacro


def test_taylor_1993_by_hand():
    # r* 1, core 3, u 4 vs u* 4.2: gap +0.4 → 1 + 3 + 0.5 + 0.2 = 4.7
    assert usmacro.taylor(3.0, 4.0, 4.2, 1.0) == pytest.approx(4.7)
    assert usmacro.taylor(3.0, 4.0, 4.2, 1.0, gap_weight=1.0) == pytest.approx(4.9)


def test_nfci_csv():
    rows = usmacro.parse_nfci("Friday_of_Week,NFCI,ANFCI,Risk,Credit,Leverage,Nonfinancial_Leverage\n10/09/2026,-0.52,-0.48,-0.3,-0.4,-0.2,0.1\n")
    assert rows == [{"date": "2026-10-09", "NFCI": -0.52, "ANFCI": -0.48, "Risk": -0.3, "Credit": -0.4, "Leverage": -0.2}]


def test_tic_table():
    text = "Table 5\n\nCountry\t2026-08\t2026-07\t\nJapan\t1068.3\t1103.9\t\nGrand Total\t9000.0\t8900.0\t\n"
    t = usmacro.parse_tic(text)
    assert t["months"] == ["2026-08", "2026-07"] and t["rows"][0] == {"country": "Japan", "values": {"2026-08": 1068.3, "2026-07": 1103.9}}


def test_census_block_reads_the_first_table_only():
    import pandas as pd
    sheet = pd.DataFrame([["Table 3a - Seasonally adjusted annual rate", None], ["Period", "United States"], ["2026", None],
                          ["January . . . .", 1300], ["February (r) . . .", 1320], [None, None],
                          ["Table 3b - Not seasonally adjusted", None], ["2026", None], ["January . . .", 90]])
    b = usmacro.census_block(sheet)
    assert b["title"].startswith("Table 3a") and b["points"] == [{"t": "2026-01-01", "v": 1300.0}, {"t": "2026-02-01", "v": 1320.0}]


def test_sep_medians_skip_the_previous_meeting_and_footnotes():
    html = """<table><thead><tr><th>Variable</th><th colspan=2>Median1</th></tr><tr><th>Variable</th><th>2026</th><th>Longer run</th></tr></thead>
    <tbody><tr><td>Change in real GDP</td><td>2.3</td><td>2.0</td></tr><tr><td>June projection</td><td>1.4</td><td>1.8</td></tr>
    <tr><td>Core PCE inflation4</td><td>3.4</td><td></td></tr></tbody></table>
    <table><thead><tr><th>Midpoint of target range or target level (Percent)</th><th>2026</th></tr></thead><tbody><tr><td>4.125</td><td>12</td></tr></tbody></table>"""
    sep = usmacro.parse_sep(html)
    assert list(sep["medians"]) == ["Change in real GDP", "Core PCE inflation"]
    assert sep["dots"] == [{"year": "2026", "rate": 4.125, "count": 12}]
