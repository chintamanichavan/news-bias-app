"""WB: each official source's file format, and the country summary."""

import pytest

from terminal import govts


def test_bundesbank_german_decimals_and_header_lines():
    text = "Renditen;\nDezimalstellen;2;\nStand vom;16.10.2026;\n2026-10-15;3,42;\n2026-10-16;3,45;\n2026-10-17;.;\n"
    assert govts.parse_buba(text) == [("2026-10-15", 3.42), ("2026-10-16", 3.45)]


def test_ecb_csv():
    text = "KEY,TIME_PERIOD,OBS_VALUE\nYC.SR_10Y,2026-10-14,3.510796188\nYC.SR_10Y,2026-10-15,3.39\n"
    assert govts.parse_ecb(text) == [("2026-10-14", pytest.approx(3.510796188)), ("2026-10-15", 3.39)]


def test_boe_par_yields_with_twenty_years_as_long():
    text = "DATE,IUDSNPY,IUDMNPY,IUDLNPY\n14 Oct 2026,4.9692,5.383,5.7225\n"
    assert govts.parse_boe(text) == {"2026-10-14": {"5Y": 4.9692, "10Y": 5.383, "30Y": 5.7225}}


def test_mof_picks_the_tenors_from_its_header():
    text = ("Interest Rate (October 2026),,,(Unit : %)\nDate,1Y,2Y,5Y,10Y,30Y,40Y\n"
            "2026/10/15,1.652,1.913,2.331,2.948,4.024,4.031\n,,,,,,\n")
    assert govts.parse_mof(text) == {"2026-10-15": {"2Y": 1.913, "5Y": 2.331, "10Y": 2.948, "30Y": 4.024}}


def test_boc_skips_its_preamble():
    text = ('"TERMS AND CONDITIONS"\n"https://..."\n\n"SERIES"\n"id","label"\n\n"OBSERVATIONS"\n'
            '"date","BD.CDN.10YR.DQ.YLD","BD.CDN.2YR.DQ.YLD"\n"2026-10-15","3.83","3.20"\n')
    assert govts.parse_boc(text) == {"2026-10-15": {"10Y": 3.83, "2Y": 3.2}}


def test_summary_takes_the_latest_ten_year_and_its_daily_change():
    s = govts.summary("X", "src", {"2026-10-14": {"10Y": 3.51}, "2026-10-15": {"2Y": 3.0, "10Y": 3.39}})
    assert s["date"] == "2026-10-15" and s["change_10y_bp"] == pytest.approx(-12.0)
    assert s["yields"] == {"2Y": 3.0, "5Y": None, "10Y": 3.39, "30Y": None}
