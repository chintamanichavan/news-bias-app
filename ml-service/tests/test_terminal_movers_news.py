"""Terminal step 4: movers, heat map, news search, and the shared cache."""

import asyncio

import pytest

from terminal import movers, news, web


def _payload(quotes):
    return {"finance": {"result": [{"quotes": quotes}]}}


def test_parse_quotes_keeps_priced_rows():
    rows = movers.parse_quotes(_payload([
        {"symbol": "AAA", "shortName": "Alpha", "regularMarketPrice": 10.0,
         "regularMarketChangePercent": 2.5, "regularMarketVolume": 100, "marketCap": 5e9},
        {"symbol": "BBB", "shortName": "No price"},
        {"shortName": "No symbol", "regularMarketPrice": 1.0},
    ]))
    assert [r["symbol"] for r in rows] == ["AAA"]
    assert rows[0]["change_pct"] == 2.5 and rows[0]["market_cap"] == 5e9
    assert movers.parse_quotes({}) == []


def test_one_per_company_drops_second_share_class():
    rows = [{"name": "Alphabet Inc.", "symbol": "GOOGL"}, {"name": "Alphabet Inc.", "symbol": "GOOG"},
            {"name": "Meta", "symbol": "META"}]
    assert [r["symbol"] for r in movers.one_per_company(rows)] == ["GOOGL", "META"]
    # Berkshire's classes carry different names but one root
    brk = [{"name": "Berkshire Hathaway Inc. New", "symbol": "BRK-B"},
           {"name": "Berkshire Hathaway Inc.", "symbol": "BRK-A"}]
    assert [r["symbol"] for r in movers.one_per_company(brk)] == ["BRK-B"]


def test_weighted_change_is_cap_weighted():
    rows = [{"market_cap": 3e9, "change_pct": 1.0}, {"market_cap": 1e9, "change_pct": -3.0},
            {"market_cap": None, "change_pct": 50.0}]
    assert movers.weighted_change(rows) == pytest.approx(0.0)
    assert movers.weighted_change([]) is None


def test_cache_reuses_then_serves_stale_on_failure():
    web.clear()
    calls = {"n": 0}

    async def ok():
        calls["n"] += 1
        return calls["n"]

    async def boom():
        raise RuntimeError("source down")

    async def scenario():
        assert await web.cached("k", 60, ok) == 1
        assert await web.cached("k", 60, ok) == 1          # still fresh
        assert await web.cached("k", 0, boom) == 1         # stale, source down
        with pytest.raises(RuntimeError):
            await web.cached("never", 60, boom)            # nothing to fall back on

    asyncio.run(scenario())
    web.clear()


def _story(conn, i, title, summary, published="2026-10-15T12:00:00+00:00"):
    conn.execute(
        "INSERT INTO articles (id, source_id, title, url, published, summary) VALUES (?,?,?,?,?,?)",
        (f"id{i}", "src", title, f"https://x/{i}", published, summary),
    )


def test_news_search_matches_every_word_and_escapes(tmp_db, monkeypatch):
    conn = tmp_db.get_conn()
    _story(conn, 1, "Fed holds rates steady", "inflation cools")
    _story(conn, 2, "Oil jumps", "Fed watch continues")
    _story(conn, 3, "100% tariff threat", "trade")
    _story(conn, 4, "Fed rates history", "old", published="2020-01-01T00:00:00+00:00")
    conn.commit()
    conn.close()

    found = {s["id"] for s in news.search("fed rates", days=36500)}
    assert found == {"id1", "id4"}
    assert {s["id"] for s in news.search("fed rates", days=1095)} == {"id1"}  # 2020 story is outside
    # % is a literal, not a wildcard
    assert [s["id"] for s in news.search("100%", days=36500)] == ["id3"]
    assert news.search("a", days=30) == []           # one-letter words are ignored
