"""The feed loop must survive a bad cycle. It once died on a single
'database is locked' and news stopped for days with the service still up."""

import asyncio
import sqlite3

import pytest

import feed_manager


class _Stop(Exception):
    pass


def test_periodic_refresh_survives_a_failing_cycle(monkeypatch):
    calls = {"fetch": 0, "sleep": 0}

    async def flaky_fetch(model=None):
        calls["fetch"] += 1
        if calls["fetch"] == 1:
            raise sqlite3.OperationalError("database is locked")
        return 0

    async def fake_sleep(_):
        calls["sleep"] += 1
        if calls["sleep"] >= 3:
            raise _Stop()

    monkeypatch.setattr(feed_manager, "fetch_all_feeds", flaky_fetch)
    monkeypatch.setattr(feed_manager.asyncio, "sleep", fake_sleep)
    with pytest.raises(_Stop):
        asyncio.run(feed_manager.periodic_refresh())
    assert calls["fetch"] == 3  # kept cycling after the first one blew up


def test_fetch_all_feeds_isolates_stages(tmp_db, monkeypatch):
    ran = []

    async def boom():
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(feed_manager, "SOURCES", [])
    monkeypatch.setattr(feed_manager, "_enrich_short_bodies", boom)
    monkeypatch.setattr(feed_manager, "_group_stories", lambda conn: ran.append("group"))
    assert asyncio.run(feed_manager.fetch_all_feeds(None)) == 0
    assert ran == ["group"]  # grouping still ran after enrich failed
