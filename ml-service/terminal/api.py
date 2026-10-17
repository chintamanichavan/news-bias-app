"""HTTP routes for the terminal's market-wide functions, under /terminal."""

from fastapi import APIRouter, Query

from . import fx, movers, news, rates

router = APIRouter(prefix="/terminal", tags=["terminal"])


@router.get("/movers")
async def most(kind: str = Query("active", pattern="^(gainers|losers|active)$")):
    return await movers.movers(kind)


@router.get("/heatmap")
async def mmap():
    return await movers.heatmap()


@router.get("/news")
def nse(q: str = Query(..., min_length=2, max_length=80), days: int = Query(30, ge=1, le=365)):
    return {"query": q, "days": days, "stories": news.search(q, days)}


@router.get("/curve")
async def gc():
    return await rates.curve()


@router.get("/money")
async def btmm():
    return await rates.money()


@router.get("/wirp")
async def wirp():
    return await rates.wirp()


@router.get("/fx")
async def wcrs():
    return await fx.rates()
