"""HTTP routes for the terminal's market-wide functions, under /terminal."""

from fastapi import APIRouter, HTTPException, Query

from . import (company, econ, filings, futures, fx, ipos, movers, news, options, peers, rates, returns,
               screener, vol, yahoo)

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


@router.get("/futures")
async def ctm():
    return await futures.tables()


@router.get("/industries")
async def imap():
    return await futures.industries()


@router.get("/calendar")
async def eco(days: int = Query(45, ge=1, le=120)):
    return await econ.calendar(days)


@router.get("/econ")
async def ecst():
    return await econ.statistics()


@router.get("/screen")
async def eqs():
    return await screener.table()


@router.get("/company/{symbol}")
async def company_sections(symbol: str):
    """EE, ERN, EVTS, ANR, MGMT, SI, HDS and OWN read sections of this."""
    try:
        return await company.company(symbol.upper())
    except yahoo.NotFound as e:
        raise HTTPException(404, str(e))


@router.get("/dividends/{symbol}")
async def dvd(symbol: str):
    return await returns.dividends(symbol.upper())


@router.get("/returns")
async def tra(symbols: str = Query(..., min_length=1, max_length=120),
              span: str = Query("5y", pattern="^(1y|3y|5y|10y)$")):
    wanted = [s.strip().upper() for s in symbols.split(",") if s.strip()][:8]
    return await returns.compare(wanted, span)


@router.get("/filings/{symbol}")
async def cf(symbol: str):
    try:
        return await filings.filings(symbol.upper())
    except filings.NotFiler as e:
        raise HTTPException(404, str(e))


@router.get("/peers/{symbol}")
async def rv(symbol: str):
    return await peers.relative(symbol.upper())


@router.get("/ipos")
async def ipo():
    return await ipos.calendar()


@router.get("/options/{symbol}")
async def omon(symbol: str, expiry: int | None = Query(None, ge=0)):
    try:
        return await options.chain(symbol.upper(), expiry)
    except options.NoOptions as e:
        raise HTTPException(404, str(e))


@router.get("/vol/{symbol}")
async def ivol(symbol: str):
    """IVOL, HIVG, SKEW and OVDV read sections of this."""
    try:
        return await vol.surface(symbol.upper())
    except options.NoOptions as e:
        raise HTTPException(404, str(e))
