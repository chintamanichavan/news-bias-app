"""Slow results, served from memory.

A value is fresh for `ttl` seconds. For `stale_ok` seconds after that the old
value is still returned at once, and one refresh runs behind it. Only a caller
who finds nothing usable waits, and callers waiting on the same key share one
computation.

Keys registered with keep_warm() are refreshed shortly before they expire, so
nobody waits for those at all.
"""

import asyncio
import time
from typing import Any, Awaitable, Callable

Compute = Callable[[], Awaitable[Any]]


class ResultCache:
    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._values: dict[str, tuple[float, Any]] = {}
        self._refreshing: dict[str, asyncio.Task] = {}
        self._warm: dict[str, tuple[float, Compute]] = {}

    async def get(self, key: str, ttl: float, stale_ok: float, compute: Compute) -> Any:
        """The value for `key`. `compute` must not block the event loop: wrap
        blocking work in asyncio.to_thread."""
        age = self._age(key)
        if age < ttl:
            return self._values[key][1]
        refresh = self._refresh(key, compute)
        if age < ttl + stale_ok:
            return self._values[key][1]
        # shield: a caller who disconnects must not cancel the shared work.
        return await asyncio.shield(refresh)

    def keep_warm(self, key: str, ttl: float, compute: Compute) -> None:
        self._warm[key] = (ttl, compute)

    async def warm_once(self, lead: float = 120.0) -> None:
        """Refresh every warm key that is missing or within `lead` seconds of
        expiry. One at a time: these are the heavy ones."""
        for key, (ttl, compute) in list(self._warm.items()):
            if self._age(key) >= ttl - lead:
                try:
                    await self._refresh(key, compute)
                except Exception:
                    pass  # reported by _finished; the old value stays

    async def warm_forever(self, every: float = 60.0) -> None:
        while True:
            await self.warm_once()
            await asyncio.sleep(every)

    def _age(self, key: str) -> float:
        hit = self._values.get(key)
        return self._clock() - hit[0] if hit else float("inf")

    def _refresh(self, key: str, compute: Compute) -> asyncio.Task:
        task = self._refreshing.get(key)
        if task is None:
            task = self._refreshing[key] = asyncio.create_task(self._store(key, compute))
            task.add_done_callback(lambda t: self._finished(key, t))
        return task

    async def _store(self, key: str, compute: Compute) -> Any:
        value = await compute()
        self._values[key] = (self._clock(), value)
        return value

    def _finished(self, key: str, task: asyncio.Task) -> None:
        del self._refreshing[key]
        if not task.cancelled() and task.exception() is not None:
            print(f"[cache] refresh of {key} failed: {task.exception()!r}")
