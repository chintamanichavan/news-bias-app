"""
Polymarket prediction-market poller.
Fetches top-volume binary markets every 30 min, categorizes them,
and upserts into the prediction_markets table.

No auth required. Skips sports + entertainment markets.
"""

import asyncio
import json

import httpx

import db

POLY_BASE = "https://gamma-api.polymarket.com/markets"
USER_AGENT = "ClearLens/1.0 (+https://github.com/news-bias-app)"
REFRESH_INTERVAL = 1800  # 30 minutes
FETCH_LIMIT = 200        # pull a wide net then filter

CATEGORY_KEYWORDS: dict[str, list[str]] = {
    # Order matters — first match wins
    "macro": [
        "fed ", "fomc", "rate cut", "rate hike", "interest rate", "cpi",
        "inflation", "recession", "gdp ", "unemployment", "jobs report",
        "treasury", "yield curve", "powell",
    ],
    "geopolitics": [
        "russia", "ukraine", "putin", "zelensky", "ceasefire",
        "iran", "israel", "gaza", "hamas", "hezbollah",
        "china", "xi jinping", "taiwan", "north korea",
        "nato", "war", "invasion", "missile", "nuclear",
        "saudi", "venezuela", "syria", "yemen", "houthi",
    ],
    "politics": [
        "trump", "biden", "harris", "vance", "election",
        "supreme court", "scotus", "congress", "house ", "senate",
        "governor", "primary", "impeach", "pardon",
    ],
    "crypto": [
        "bitcoin", "btc", "ethereum", "eth ", "crypto", "solana",
        "coinbase", "stablecoin", "tether",
    ],
}

SKIP_KEYWORDS = [
    # Sports
    "nfl", "nba", "mlb", "nhl", "ncaa", "super bowl", "world cup",
    "champions league", "uefa", "epl", "premier league", "la liga",
    "wrestlemania", "boxing", "ufc", "mma", "tennis ", "atp ", "wta ",
    "pga ", "masters tournament", "tour de france", "f1 ", "formula 1",
    "esports", "valorant", "league of legends", "dota",
    # Entertainment / awards
    "oscar", "grammy", "emmy", "academy award", "golden globe",
    "drake", "kanye", "taylor swift", "kardashian", "rihanna",
    # Celebrity micro-markets (these dominate noise)
    "tweets from", "tweet count", "tweets between", "post tweets",
    "mrbeast", "mr beast", "video get", "video views", "video have",
    "youtube views", "subscribers by",
    # Misc engagement
    "instagram followers", "tiktok views", "follower count",
]


def _is_binary_market(market: dict) -> bool:
    """A market is binary if outcomes are exactly Yes/No."""
    try:
        outcomes = json.loads(market.get("outcomes", "[]"))
    except (TypeError, json.JSONDecodeError):
        return False
    return [o.lower() for o in outcomes] == ["yes", "no"]


def _is_sports(market: dict) -> bool:
    fee_type = (market.get("feeType") or "").lower()
    if fee_type.startswith("sports"):
        return True
    if market.get("sportsMarketType"):
        return True
    return False


def _categorize(question: str) -> str | None:
    """
    Returns the category key, or None if the market should be dropped.
    """
    q = question.lower()
    for kw in SKIP_KEYWORDS:
        if kw in q:
            return None
    for cat, kws in CATEGORY_KEYWORDS.items():
        for kw in kws:
            if kw in q:
                return cat
    # Fallback: anything else gets "finance" — better to over-include than drop
    return "finance"


def _yes_price(market: dict) -> float | None:
    try:
        prices = json.loads(market.get("outcomePrices", "[]"))
        outcomes = json.loads(market.get("outcomes", "[]"))
    except (TypeError, json.JSONDecodeError):
        return None
    if len(prices) != 2 or len(outcomes) != 2:
        return None
    # Find the Yes outcome's price (usually index 0)
    for outcome, price in zip(outcomes, prices):
        if outcome.lower() == "yes":
            try:
                return float(price)
            except (TypeError, ValueError):
                return None
    return None


def _normalize(market: dict) -> dict | None:
    if not _is_binary_market(market) or _is_sports(market):
        return None

    question = (market.get("question") or "").strip()
    if not question:
        return None

    category = _categorize(question)
    if category is None:
        return None

    yes = _yes_price(market)
    if yes is None:
        return None

    market_id = market.get("conditionId") or market.get("id")
    if not market_id:
        return None
    market_id = str(market_id)

    slug = market.get("slug")
    url = f"https://polymarket.com/event/{slug}" if slug else None

    return {
        "id": market_id,
        "source": "polymarket",
        "question": question,
        "description": (market.get("description") or "")[:500],
        "category": category,
        "yes_price": round(yes, 4),
        "yes_change_24h": float(market.get("oneDayPriceChange") or 0.0),
        "volume_24h": float(market.get("volume24hr") or 0.0),
        "volume_total": float(market.get("volumeNum") or 0.0),
        "end_date": market.get("endDate"),
        "url": url,
        "image_url": market.get("image") or market.get("icon"),
    }


async def poll_polymarket() -> int:
    """Returns count of markets upserted."""
    async with httpx.AsyncClient(
        timeout=30,
        headers={"User-Agent": USER_AGENT},
    ) as client:
        r = await client.get(POLY_BASE, params={
            "active": "true",
            "closed": "false",
            "limit": FETCH_LIMIT,
            "order": "volume24hr",
            "ascending": "false",
        })
        r.raise_for_status()
        markets = r.json()

    count = 0
    conn = db.get_conn()
    for raw in markets:
        norm = _normalize(raw)
        if not norm:
            continue
        try:
            db.upsert_signal(conn, norm)
            count += 1
        except Exception as e:
            print(f"[signals] upsert failed for {norm['id']}: {e}")
    db.prune_stale_signals(conn, days=2)
    conn.commit()
    conn.close()
    return count


async def periodic_refresh():
    while True:
        try:
            count = await poll_polymarket()
            print(f"[signals] refreshed {count} Polymarket markets")
        except Exception as e:
            print(f"[signals] poll failed: {e}")
        await asyncio.sleep(REFRESH_INTERVAL)
