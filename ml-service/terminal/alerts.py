"""ALRT: price alerts. The rule is pure; checking runs whenever a browser
with Artha open asks (about once a minute), since the service has no
background loop of the terminal's own."""

from . import quotes, store


def crossed(op: str, level: float, price: float) -> bool:
    return price >= level if op == "above" else price <= level


def due(waiting: list[dict], prices: dict[str, float]) -> list[tuple[dict, float]]:
    """Alerts whose condition holds at the current prices."""
    return [(a, prices[a["symbol"]]) for a in waiting
            if a["symbol"] in prices and crossed(a["op"], a["level"], prices[a["symbol"]])]


async def check() -> list[dict]:
    """Fire every waiting alert whose level has been reached; return them."""
    waiting = [a for a in store.alerts() if a["triggered_at"] is None]
    if not waiting:
        return []
    got = await quotes.quotes([a["symbol"] for a in waiting])
    fired = []
    for alert, price in due(waiting, {s: q["price"] for s, q in got.items()}):
        store.mark_triggered(alert["id"], price)
        fired.append({**alert, "triggered_price": price})
    return fired
