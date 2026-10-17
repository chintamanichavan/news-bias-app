"""MOV: index weights from fund files, and each member's share of the move."""

import io

import openpyxl
import pytest

from terminal import indexmove


def _ssga_file() -> bytes:
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in [["Fund Name:", "SPDR Dow Jones Industrial Average ETF Trust"], ["Ticker Symbol:", "DIA"],
                ["Holdings:", "As of 15-Oct-2026"], [],
                ["Name", "Ticker", "Identifier", "SEDOL", "Weight", "Sector", "Shares Held", "Local Currency"],
                ["GOLDMAN SACHS", "GS", "x", "x", 60.0, "-", 1, "USD"],
                ["BERKSHIRE B", "BRK.B", "x", "x", 39.9, "-", 1, "USD"],
                ["US DOLLAR", "CASH_USD", "x", "x", 0.1, "-", 1, "USD"],
                [], ["Past performance is no guarantee of future results."]]:
        ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_parse_ssga_reads_the_table_under_the_titles():
    as_of, w = indexmove.parse_ssga(_ssga_file())
    assert as_of == "15-Oct-2026"
    assert w == pytest.approx({"GS": 0.60, "BRK-B": 0.399})       # cash left out, class dot to dash


def test_parse_invesco_keeps_shares_and_adrs_only():
    as_of, w = indexmove.parse_invesco({"effectiveDate": "2026-10-15", "holdings": [
        {"ticker": "NVDA", "securityTypeName": "Common Stock", "percentageOfTotalNetAssets": 8.0},
        {"ticker": "ASML", "securityTypeName": "American Depository Receipt - NY", "percentageOfTotalNetAssets": 0.7},
        {"ticker": "NQZ6", "securityTypeName": "Index Future", "percentageOfTotalNetAssets": 0.1},
        {"ticker": "USD", "securityTypeName": "Currency", "percentageOfTotalNetAssets": 0.1},
    ]})
    assert as_of == "2026-10-15" and w == pytest.approx({"NVDA": 0.08, "ASML": 0.007})


def test_contributions_add_up_to_the_index_move():
    # two members, 60/40 at yesterday's close of 1000; +1% and -2% → -0.2% → -2 points
    rows = indexmove.contributions({"A": 0.6, "B": 0.4},
                                   {"A": {"price": 1, "change_pct": 1.0}, "B": {"price": 1, "change_pct": -2.0}}, 1000)
    assert [r["symbol"] for r in rows] == ["B", "A"]               # largest effect first
    assert rows[0]["points"] == pytest.approx(-8.0) and rows[1]["points"] == pytest.approx(6.0)
    assert sum(r["contribution_pct"] for r in rows) == pytest.approx(-0.2)
