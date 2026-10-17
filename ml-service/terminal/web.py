"""HTTP client settings and a small time-based cache for terminal sources."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx

BROWSER = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/121.0 Safari/537.36",
}

T = TypeVar("T")

_values: dict[str, tuple[float, object]] = {}
_locks: dict[str, asyncio.Lock] = {}


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=20, headers=BROWSER, follow_redirects=True)


async def cached(key: str, ttl: float, make: Callable[[], Awaitable[T]]) -> T:
    """The value for `key`, rebuilt by `make` once it is older than `ttl`
    seconds. One rebuild at a time per key. When a rebuild fails, the old
    value is served if there is one; a source being down for a minute should
    not blank a screen that worked a minute ago."""
    hit = _values.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]  # type: ignore[return-value]
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        hit = _values.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]  # type: ignore[return-value]
        try:
            value = await make()
        except Exception:
            if hit:
                return hit[1]  # type: ignore[return-value]
            raise
        _values[key] = (time.time(), value)
        return value


def clear() -> None:
    """For tests."""
    _values.clear()
    _locks.clear()
