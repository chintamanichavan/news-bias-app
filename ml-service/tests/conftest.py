"""Shared fixtures: every test runs against a throwaway SQLite file and a
network-free universe seeded from the static layer only."""

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import db  # noqa: E402
import universe  # noqa: E402


@pytest.fixture()
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "test.db")
    db.init_db()
    return db


@pytest.fixture()
def offline_universe(tmp_db, monkeypatch):
    """Registry seeded from the static global layer only — no SEC fetch."""
    import httpx

    def _no_network(*a, **k):
        raise httpx.ConnectError("offline test")

    monkeypatch.setattr(httpx, "get", _no_network)
    universe.seed(force=True)
    universe.load()
    return universe
