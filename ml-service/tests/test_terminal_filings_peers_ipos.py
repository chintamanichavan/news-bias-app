"""Terminal step 12: SEC filings, peer comparison, IPO calendar."""

import json
from pathlib import Path

from terminal import filings, ipos, peers

FIX = Path(__file__).parent / "fixtures"


def test_filings_link_to_documents_and_name_forms():
    out = filings.parse_submissions(json.loads((FIX / "sec_submissions_aapl.json").read_text()))
    assert out["name"] == "Apple Inc." and out["fiscal_year_end"] == "0926"
    first = out["filings"][0]
    assert first["form"] == "144" and first["what"] == "Planned insider sale" and first["filed"] == "2026-10-16"
    assert first["url"].startswith("https://www.sec.gov/Archives/edgar/data/320193/")
    assert "-" not in first["url"].split("/")[-2]           # accession number without dashes
    assert len(out["filings"]) == 30


def test_similar_symbols_and_comparison():
    assert peers.parse_similar({"finance": {"result": [{"recommendedSymbols": [{"symbol": "MSFT"}, {"symbol": "GOOG"}]}]}}) == ["MSFT", "GOOG"]
    assert peers.parse_similar({}) == []
    table = {
        "AAPL": {"pe": 30.0, "roe": 100.0},
        "MSFT": {"pe": 25.0, "roe": 30.0},
        "GOOG": {"pe": 20.0, "roe": None},
    }
    c = peers.compare("AAPL", ["MSFT", "GOOG", "TSM"], table)
    assert [r["symbol"] for r in c["rows"]] == ["AAPL", "MSFT", "GOOG", "TSM"]
    assert c["rows"][0]["self"] and not c["rows"][3]["covered"]
    assert c["peer_median"]["pe"] == 22.5 and c["peer_median"]["roe"] == 30.0
    assert c["rank"]["pe"] == 1 and c["rank"]["roe"] == 1 and c["rank"]["yield"] is None
    assert c["of"] == 4


def test_ipo_calendar():
    cal = ipos.parse_calendar(json.loads((FIX / "nasdaq_ipo.json").read_text()))
    assert set(cal) == {"priced", "upcoming", "filed", "withdrawn"}
    p = cal["priced"][0]
    assert p["symbol"] == "IAM" and p["amount"] == 150_000_000 and p["date"] == "10/15/2026"
    assert cal["filed"][0]["symbol"] is None                # filed deals often have no ticker yet
    assert ipos._money("$1,234.50") == 1234.5 and ipos._money("") is None
    assert ipos._months(__import__("datetime").date(2026, 12, 5)) == ["2026-12", "2027-01"]
