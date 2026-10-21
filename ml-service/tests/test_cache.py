"""ResultCache: who waits, who gets the old value, and how often work runs."""

import asyncio

import pytest

from cache import ResultCache


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class Counter:
    """A compute that returns 1, 2, 3… and can be held open or made to fail."""

    def __init__(self):
        self.calls = 0
        self.gate = asyncio.Event()
        self.gate.set()
        self.fail = False

    async def __call__(self):
        self.calls += 1
        n = self.calls
        await self.gate.wait()
        if self.fail:
            raise RuntimeError("upstream down")
        return n


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


def run(coro):
    return asyncio.run(coro)


def test_fresh_value_is_not_recomputed():
    async def body():
        clock, work = Clock(), Counter()
        cache = ResultCache(clock)
        assert await cache.get("k", 60, 600, work) == 1
        clock.now += 59
        assert await cache.get("k", 60, 600, work) == 1
        assert work.calls == 1
    run(body())


def test_stale_value_returns_at_once_and_refreshes_behind():
    async def body():
        clock, work = Clock(), Counter()
        cache = ResultCache(clock)
        await cache.get("k", 60, 600, work)
        clock.now += 61
        work.gate.clear()                      # the refresh will hang…
        assert await cache.get("k", 60, 600, work) == 1   # …and nobody waits
        assert await cache.get("k", 60, 600, work) == 1
        await settle()
        assert work.calls == 2                 # one refresh, not two
        work.gate.set()
        await settle()
        assert await cache.get("k", 60, 600, work) == 2
    run(body())


def test_value_older_than_stale_ok_is_not_served():
    async def body():
        clock, work = Clock(), Counter()
        cache = ResultCache(clock)
        await cache.get("k", 60, 600, work)
        clock.now += 661
        assert await cache.get("k", 60, 600, work) == 2
    run(body())


def test_concurrent_misses_share_one_computation():
    async def body():
        work = Counter()
        cache = ResultCache(Clock())
        got = await asyncio.gather(*(cache.get("k", 60, 600, work) for _ in range(5)))
        assert got == [1] * 5
        assert work.calls == 1
    run(body())


def test_failed_refresh_keeps_the_old_value(capsys):
    async def body():
        clock, work = Clock(), Counter()
        cache = ResultCache(clock)
        await cache.get("k", 60, 600, work)
        clock.now += 61
        work.fail = True
        assert await cache.get("k", 60, 600, work) == 1
        await settle()
        assert await cache.get("k", 60, 600, work) == 1
    run(body())
    assert "refresh of k failed" in capsys.readouterr().out


def test_failure_with_nothing_to_serve_reaches_the_caller():
    async def body():
        work = Counter()
        work.fail = True
        with pytest.raises(RuntimeError):
            await ResultCache(Clock()).get("k", 60, 600, work)
    run(body())


def test_warm_keys_refresh_before_they_expire():
    async def body():
        clock, work = Clock(), Counter()
        cache = ResultCache(clock)
        cache.keep_warm("k", 1800, work)
        await cache.warm_once()                # missing: computed
        clock.now += 1000
        await cache.warm_once()                # plenty of life left: untouched
        assert work.calls == 1
        clock.now += 700                       # 100 s from expiry
        await cache.warm_once()
        assert work.calls == 2
        assert await cache.get("k", 1800, 0, work) == 2   # caller never waits
        assert work.calls == 2
    run(body())
