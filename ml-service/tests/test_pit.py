"""Phase 1 acceptance: contracts reject bad batches; snapshots are immutable;
as-of reads replay identically even after corrections arrive later."""

import pandas as pd
import pytest

import contracts
import pit
import pit_ingest


@pytest.fixture()
def tmp_pit(tmp_path, monkeypatch):
    monkeypatch.setattr(pit, "PIT_ROOT", tmp_path / "pit")
    return pit


def _prices(rows):
    return pd.DataFrame(rows)


GOOD = [
    {"symbol": "AAA", "date": "2026-01-02", "open": 10.0, "high": 11.0,
     "low": 9.5, "close": 10.5, "volume": 1000, "source": "test"},
    {"symbol": "AAA", "date": "2026-01-03", "open": 10.5, "high": 12.0,
     "low": 10.0, "close": 11.5, "volume": 1200, "source": "test"},
]


def test_contract_rejects_corruption():
    bad_price = _prices([{**GOOD[0], "close": -5.0}])
    with pytest.raises(Exception):
        contracts.validate("prices_eod", bad_price)
    inverted = _prices([{**GOOD[0], "high": 1.0, "low": 9.0}])
    with pytest.raises(Exception):
        contracts.validate("prices_eod", inverted)
    dupes = _prices([GOOD[0], GOOD[0]])
    with pytest.raises(Exception):
        contracts.validate("prices_eod", dupes)
    with pytest.raises(ValueError):
        contracts.validate("prices_eod", pd.DataFrame())


def test_snapshots_are_immutable(tmp_pit):
    tmp_pit.write_snapshot("prices_eod", _prices(GOOD), snapshot_id="20260101T000000Z")
    with pytest.raises(FileExistsError):
        tmp_pit.write_snapshot("prices_eod", _prices(GOOD), snapshot_id="20260101T000000Z")


def test_asof_replay_survives_corrections(tmp_pit):
    # Day 1: original ingest
    tmp_pit.write_snapshot("prices_eod", _prices(GOOD), snapshot_id="20260104T000000Z")
    conn = tmp_pit.connect()
    asof_jan5 = tmp_pit.prices_asof(conn, "2026-01-05")
    assert float(asof_jan5[asof_jan5.date == "2026-01-03"].close.iloc[0]) == 11.5

    # Day 10: a correction restates Jan-3's close
    corrected = [{**GOOD[1], "close": 99.0}]
    tmp_pit.write_snapshot("prices_eod", _prices(corrected), snapshot_id="20260110T000000Z")

    conn = tmp_pit.connect()
    # The Jan-5 view must replay EXACTLY as it did before the correction…
    replay = tmp_pit.prices_asof(conn, "2026-01-05")
    pd.testing.assert_frame_equal(replay, asof_jan5)
    # …while the post-correction view sees the restated value.
    now_view = tmp_pit.prices_asof(conn, "2026-01-11")
    assert float(now_view[now_view.date == "2026-01-03"].close.iloc[0]) == 99.0


def test_fundamentals_asof_uses_filing_date(tmp_pit):
    facts = pd.DataFrame([
        {"cik": "1", "symbol": "AAA", "tag": "Revenues", "unit": "USD",
         "period_end": "2025-12-31", "value": 100.0, "filed_at": "2026-02-15"},
        {"cik": "1", "symbol": "AAA", "tag": "Revenues", "unit": "USD",
         "period_end": "2025-12-31", "value": 105.0, "filed_at": "2026-05-01"},  # restatement
    ])
    tmp_pit.write_snapshot("fundamentals", facts, snapshot_id="20260601T000000Z")
    conn = tmp_pit.connect()
    # As of March: only the original filing was knowable — but it wasn't in
    # the store until June, so an honest March read is empty…
    march = tmp_pit.fundamentals_asof(conn, "2026-03-01")
    assert march.empty
    # …and a July read resolves the restatement to the latest filing.
    july = tmp_pit.fundamentals_asof(conn, "2026-07-01")
    assert float(july.value.iloc[0]) == 105.0


def test_ingest_parsers_offline():
    stooq = pit_ingest.parse_stooq_csv(
        "AAA", "Date,Open,High,Low,Close,Volume\n2026-01-02,10,11,9.5,10.5,1000\n")
    assert len(stooq) == 1 and stooq.close.iloc[0] == 10.5

    facts = pit_ingest.parse_companyfacts("AAA", {
        "cik": 99, "facts": {"us-gaap": {"NetIncomeLoss": {"units": {"USD": [
            {"end": "2025-12-31", "val": 5.0, "filed": "2026-02-01"},
            {"end": "2025-12-31", "val": 6.0, "filed": "2025-01-01"},  # filed < end: dropped
        ]}}}}})
    assert len(facts) == 1 and facts.value.iloc[0] == 5.0

    fred = pit_ingest.parse_fred_csv("DGS10", "DATE,DGS10\n2026-01-02,4.25\n2026-01-03,.\n")
    assert len(fred) == 2 and fred.value.isna().sum() == 1

    gkg_line = "\t".join(["id", "20260102030000", "", "", "", "", "",
                          "ECON_INFLATION;TAX_THING", "", "", "", "", "", "", "",
                          "-3.5,1,2,3,4,5,6"] + [""] * 10)
    tone = pit_ingest.parse_gkg(gkg_line)
    assert len(tone) == 1 and tone.tone.iloc[0] == -3.5 and tone.articles.iloc[0] == 1
