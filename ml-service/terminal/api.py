"""HTTP routes for the terminal's market-wide functions, under /terminal."""

from datetime import date

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from . import (alerts, analytics, book, calendars, commodities, company, dcf, econ, facts, filings, funds,
               futures, fx, govts, indexmove, ipos, macro, members, monitors, movers, news, newsfilters,
               options, optools, ownership, peers, quotes, rates, returns, screener, store, trading, usmacro,
               vol, yahoo)

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



# ── the terminal's own data: watchlists, notes, alerts ───────────────────────

SYMBOL = Field(..., min_length=1, max_length=24)


class Member(BaseModel):
    symbol: str = SYMBOL


class Note(BaseModel):
    symbol: str | None = Field(None, max_length=24)
    body: str = Field(..., min_length=1, max_length=4000)


class Alert(BaseModel):
    symbol: str = SYMBOL
    op: str = Field(..., pattern="^(above|below)$")
    level: float = Field(..., gt=0)
    note: str | None = Field(None, max_length=200)


@router.get("/quotes")
async def quote_batch(symbols: str = Query(..., min_length=1, max_length=2000)):
    return await quotes.quotes(symbols.split(","))


@router.get("/watchlists")
def watchlists():
    return {"lists": store.lists()}


@router.get("/watchlists/{name}")
async def watchlist(name: str):
    symbols = store.members(name)
    got = await quotes.quotes(symbols)
    return {"name": name, "rows": [got.get(s, {"symbol": s, "missing": True}) for s in symbols]}


@router.post("/watchlists/{name}")
def watchlist_add(name: str, member: Member):
    store.add_member(name, member.symbol)
    return {"ok": True}


@router.delete("/watchlists/{name}/{symbol}")
def watchlist_remove(name: str, symbol: str):
    store.remove_member(name, symbol)
    return {"ok": True}


@router.get("/notes")
def notes(symbol: str | None = None):
    return {"notes": store.notes(symbol)}


@router.post("/notes")
def note_add(note: Note):
    return {"id": store.add_note(note.symbol, note.body)}


@router.delete("/notes/{note_id}")
def note_delete(note_id: int):
    store.delete_note(note_id)
    return {"ok": True}


@router.get("/alerts")
def alert_list():
    return {"alerts": store.alerts()}


@router.post("/alerts")
def alert_add(alert: Alert):
    return {"id": store.add_alert(alert.symbol, alert.op, alert.level, alert.note)}


@router.delete("/alerts/{alert_id}")
def alert_delete(alert_id: int):
    store.delete_alert(alert_id)
    return {"ok": True}


@router.post("/alerts/check")
async def alert_check():
    return {"fired": await alerts.check()}


@router.get("/bars/{symbol}")
async def daily_bars(symbol: str, span: str = Query("5y", pattern="^(1y|2y|5y|10y|max)$")):
    return {"symbol": symbol.upper(), "bars": await returns.bars(symbol.upper(), span)}



# ── holdings (PRTU), risk (MARS), attribution (ATTR) ─────────────────────────

class Holding(BaseModel):
    symbol: str = SYMBOL
    quantity: float
    cost: float | None = Field(None, ge=0)
    opened: str | None = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class Book(BaseModel):
    holdings: list[Holding] = Field(..., max_length=500)


@router.get("/holdings")
async def holdings():
    return await book.holdings_view()


@router.put("/holdings")
def holdings_replace(new: Book):
    return {"saved": store.replace_holdings([h.model_dump() for h in new.holdings])}


@router.post("/holdings")
def holding_add(h: Holding):
    return {"id": store.add_holding(h.symbol, h.quantity, h.cost, h.opened)}


@router.delete("/holdings/{holding_id}")
def holding_delete(holding_id: int):
    store.delete_holding(holding_id)
    return {"ok": True}


@router.get("/risk")
async def mars():
    return await book.risk()


@router.get("/attribution")
async def attr():
    return await book.attribution()



# ── paper orders (EMSX) and their cost (TCA) ─────────────────────────────────

class Order(BaseModel):
    symbol: str = SYMBOL
    side: str = Field(..., pattern="^(buy|sell)$")
    quantity: float = Field(..., gt=0, le=1_000_000)
    type: str = Field("market", pattern="^(market|limit)$")
    limit_price: float | None = Field(None, gt=0)


@router.post("/orders")
async def order_place(o: Order):
    if o.type == "limit" and o.limit_price is None:
        raise HTTPException(422, "A limit order needs a limit price.")
    try:
        return await trading.place(o.symbol, o.side, o.quantity, o.type, o.limit_price)
    except trading.NoQuote as e:
        raise HTTPException(404, str(e))


@router.get("/orders")
async def order_blotter():
    return await trading.blotter()


@router.delete("/orders/{order_id}")
def order_cancel(order_id: int):
    if not store.cancel_order(order_id):
        raise HTTPException(409, "Only a working order can be cancelled.")
    return {"ok": True}


@router.post("/orders/check")
async def order_check():
    return {"filled": await trading.check()}


@router.get("/tca")
async def trade_costs():
    return await trading.tca()



@router.get("/mov/{index}")
async def index_movers(index: str):
    code = index.upper()
    if code not in indexmove.INDICES:
        raise HTTPException(404, f"MOV covers {', '.join(indexmove.INDICES)}.")
    return await indexmove.movers(code)



@router.get("/wb")
async def world_bonds():
    return await govts.world()



@router.get("/valuation/{symbol}")
async def valuation(symbol: str, growth: float | None = Query(None, ge=-50, le=50),
                    terminal_growth: float | None = Query(None, ge=-5, le=10),
                    dividend_growth: float | None = Query(None, ge=-50, le=50),
                    beta: float | None = Query(None, ge=-3, le=5), erp: float | None = Query(None, ge=0, le=20),
                    rf: float | None = Query(None, ge=-2, le=20), wacc: float | None = Query(None, gt=0, le=30),
                    ke: float | None = Query(None, gt=0, le=40)):
    """Overrides arrive in percent (beta as a number) and are used as fractions."""
    given = {"growth": growth, "terminal_growth": terminal_growth, "dividend_growth": dividend_growth,
             "erp": erp, "rf": rf, "wacc": wacc, "ke": ke}
    overrides = {k: v / 100 for k, v in given.items() if v is not None}
    if beta is not None:
        overrides["beta"] = beta
    try:
        return await dcf.valuation(symbol.upper(), overrides)
    except dcf.NoInputs as e:
        raise HTTPException(404, str(e))



@router.get("/intraday/{symbol}")
async def intraday_bars(symbol: str, span: str = Query("5d", pattern="^(1d|5d|1mo|60d)$")):
    return {"symbol": symbol.upper(), "span": span, "bars": await returns.intraday(symbol.upper(), span)}



@router.get("/insiders/{symbol}")
async def insider_trades(symbol: str):
    try:
        return await ownership.insider_view(symbol.upper())
    except yahoo.NotFound as e:
        raise HTTPException(404, str(e))


@router.get("/13f")
async def thirteen_f(manager: str = Query(..., min_length=2, max_length=80)):
    try:
        return await ownership.manager(manager.strip())
    except ownership.NoFilings as e:
        raise HTTPException(404, str(e))


@router.get("/shorts/{symbol}")
async def short_interest_history(symbol: str):
    return await ownership.short_history(symbol.upper())


@router.get("/uk-shorts")
async def uk_short_positions(issuer: str | None = Query(None, max_length=80)):
    return await ownership.uk_shorts(issuer)


@router.get("/filing-search")
async def filing_search(q: str = Query(..., min_length=2, max_length=200), forms: str | None = Query(None, max_length=80),
                        start: str | None = Query(None, pattern=r"^\d{4}-\d\d-\d\d$"),
                        end: str | None = Query(None, pattern=r"^\d{4}-\d\d-\d\d$"),
                        symbol: str | None = Query(None, max_length=12)):
    cik = await filings.cik_for(symbol.upper()) if symbol else None
    if symbol and cik is None:
        raise HTTPException(404, f"{symbol.upper()} is not an SEC filer.")
    return await ownership.search(q, forms, start, end, cik)



@router.get("/members/{index}")
async def index_members(index: str):
    code = index.upper()
    if code not in indexmove.INDICES:
        raise HTTPException(404, f"Members are available for {', '.join(indexmove.INDICES)}.")
    return await members.members(code)



@router.get("/monitor/{name}")
async def monitor(name: str):
    """WEIF, GMM, IRR, MRV, CRYP, FX24 and HALT."""
    fn = {"weif": monitors.weif, "gmm": monitors.gmm, "irr": monitors.irr, "mrv": monitors.mrv,
          "cryp": monitors.crypto, "fx24": monitors.fx24, "halt": monitors.halts}.get(name.lower())
    if fn is None:
        raise HTTPException(404, f"No monitor called {name}.")
    return await fn()



@router.get("/calendar/{kind}")
async def market_calendar(kind: str, year: int | None = Query(None, ge=1990, le=2100)):
    """ACDR (earnings), SURP (surprises), EA (season), CACT (actions), CDR (holidays)."""
    if kind == "earnings":
        return await calendars.upcoming()
    if kind == "surprises":
        return await calendars.surprises()
    if kind == "season":
        return await calendars.season()
    if kind == "actions":
        return await calendars.actions()
    if kind == "holidays":
        y = year or date.today().year
        return {"year": y, "days": calendars.holidays(y)}
    raise HTTPException(404, f"No calendar called {kind}.")


class MyEstimate(BaseModel):
    symbol: str = SYMBOL
    period: str = Field(..., min_length=1, max_length=40)
    eps: float | None = None
    revenue: float | None = None
    note: str | None = Field(None, max_length=500)


@router.get("/my-estimates")
def my_estimates(symbol: str | None = None):
    return {"estimates": store.my_estimates(symbol)}


@router.post("/my-estimates")
def my_estimate_add(e: MyEstimate):
    if e.eps is None and e.revenue is None:
        raise HTTPException(422, "Give an EPS or a revenue estimate.")
    return {"id": store.add_my_estimate(e.symbol, e.period, e.eps, e.revenue, e.note)}


@router.delete("/my-estimates/{estimate_id}")
def my_estimate_delete(estimate_id: int):
    store.delete_my_estimate(estimate_id)
    return {"ok": True}



@router.get("/facts/{kind}/{symbol}")
async def company_facts(kind: str, symbol: str):
    """ARD, CAST and EV, DLIS, AZS, DRSK, GF, GRET and PEBD from XBRL filings."""
    fn = {"reported": facts.as_reported, "structure": facts.structure, "maturities": facts.maturities,
          "zscore": facts.zscores, "default": facts.default_risk, "fundamentals": facts.fundamentals,
          "pe": facts.pe_history}.get(kind)
    if fn is None:
        raise HTTPException(404, f"No facts view called {kind}.")
    try:
        return await fn(symbol.upper())
    except facts.NoFacts as e:
        raise HTTPException(404, str(e))


@router.get("/default-risk")
async def default_risk_list(symbols: str = Query(..., min_length=1, max_length=400)):
    names = [s.strip().upper() for s in symbols.split(",") if s.strip()][:30]
    return await facts.default_risks(names)



@router.get("/optools/{kind}")
async def option_tools(kind: str, symbol: str | None = Query(None, max_length=12), days: int = Query(30, ge=7, le=365),
                       symbols: str | None = Query(None, max_length=400), min_days: int = Query(0, ge=0), max_days: int = Query(400, ge=0),
                       min_delta: float = Query(0, ge=0, le=1), max_delta: float = Query(1, ge=0, le=1),
                       side: str | None = Query(None, pattern="^(C|P)$"), min_volume: float = Query(0, ge=0)):
    """VM, OVI and MOSO, CWS, OSCH, VSV, VCAL and CDVM."""
    try:
        if kind == "activity":
            return await optools.market_activity()
        if kind == "cdvm":
            return await optools.commodity_vol()
        if kind == "vm":
            watch = [x.strip().upper() for x in (symbols or "SPY,QQQ,IWM,AAPL,MSFT,NVDA,AMZN,META,TSLA").split(",") if x.strip()][:25]
            return await optools.vol_monitor(watch)
        if kind == "vcal":
            names = [x.strip().upper() for x in (symbols or symbol or "").split(",") if x.strip()][:20]
            if not names:
                raise HTTPException(422, "Name at least one security.")
            return await optools.implied_moves(names)
        if not symbol:
            raise HTTPException(422, "This tool needs a security.")
        if kind == "cws":
            return await optools.covered_calls(symbol.upper())
        if kind == "vsv":
            return await optools.variance_swap(symbol.upper(), days)
        if kind == "search":
            return await optools.search(symbol.upper(), min_days, max_days, min_delta, max_delta, side, min_volume)
    except options.NoOptions as e:
        raise HTTPException(404, str(e))
    raise HTTPException(404, f"No option tool called {kind}.")



@router.get("/funds/{kind}")
async def fund_views(kind: str, symbol: str | None = Query(None, max_length=12), symbols: str | None = Query(None, max_length=400)):
    """FREP and MIFA (report), FPC (compare), FSTA (style), WETF and CETF (monitors)."""
    try:
        if kind == "report" and symbol:
            return await funds.fund(symbol.upper())
        if kind == "style" and symbol:
            return await funds.style(symbol.upper())
        if kind == "compare" and symbols:
            return await funds.compare([s.strip().upper() for s in symbols.split(",") if s.strip()][:20])
        if kind in ("bond", "commodity"):
            return await funds.etf_monitor(kind)
    except yahoo.NotFound as e:
        raise HTTPException(404, str(e))
    raise HTTPException(422, f"Fund view {kind} needs a security (or a list for compare).")


# ── portfolio analytics: LRSK, PSD, PSH, HEFF, UNCL, FTST ───────────────────

@router.get("/analytics/liquidity")
async def liquidity_risk(participation: float = Query(0.2, gt=0, le=1)):
    return await analytics.liquidity(participation)


@router.get("/analytics/fundamentals")
async def book_fundamentals():
    return await analytics.book_fundamentals()


class Trade(BaseModel):
    symbol: str = SYMBOL
    quantity: float = Field(..., ne=0)


class WhatIf(BaseModel):
    trades: list[Trade] = Field(..., min_length=1, max_length=20)


@router.post("/analytics/what-if")
async def what_if(w: WhatIf):
    return await analytics.what_if([t.model_dump() for t in w.trades])


@router.get("/analytics/hedge")
async def hedge_effectiveness(symbol: str = Query(..., max_length=12), hedge: str = Query(..., max_length=12),
                              quantity: float = Query(100, gt=0), hedge_quantity: float | None = None):
    return await analytics.hedge(symbol.upper(), hedge.upper(), quantity, hedge_quantity)


class Tag(BaseModel):
    symbol: str = SYMBOL
    tag: str = Field(..., min_length=1, max_length=40)


@router.get("/analytics/tags")
async def tag_groups():
    return await analytics.by_tag()


@router.post("/analytics/tags")
def tag_add(t: Tag):
    store.add_tag(t.symbol, t.tag)
    return {"ok": True}


@router.delete("/analytics/tags/{symbol}/{tag}")
def tag_delete(symbol: str, tag: str):
    store.delete_tag(symbol, tag)
    return {"ok": True}


@router.get("/analytics/factors")
async def factor_record(symbol: str | None = Query(None, max_length=12), years: int = Query(10, ge=3, le=60)):
    return await analytics.factor_view(symbol.upper() if symbol else None, years)


# ── news filters ─────────────────────────────────────────────────────────────

@router.get("/newsfilter/{code}")
async def news_filter(code: str, subject: str | None = Query(None, max_length=60), symbol: str | None = Query(None, max_length=12),
                      name: str | None = Query(None, max_length=60)):
    c = code.upper()
    if c in newsfilters.TOPICS:
        return newsfilters.topic(c, subject)
    if c in newsfilters.SOURCES:
        return newsfilters.source(c)
    if c == "GN":
        if not symbol:
            raise HTTPException(422, "GN needs a security.")
        return await newsfilters.company_coverage(symbol.upper())
    if c == "MMN":
        return await newsfilters.movers_news()
    if c == "NL":
        return await newsfilters.watchlist_news(name)
    if c == "TREN":
        return newsfilters.news_trends()
    if c == "NRC":
        return newsfilters.outlets()
    if c == "RNS":
        return await newsfilters.regulatory()
    if c == "TEL":
        return await newsfilters.telegraph()
    raise HTTPException(404, f"No news filter called {code}.")


# ── world economy: COUN, ECMX, GDP, EMEC, CBRT, LEAD, HOIN, WGO, WIRA, CRP ───

@router.get("/macro/{kind}")
async def world_economy(kind: str, country: str | None = Query(None, max_length=3), indicator: str | None = Query(None, max_length=40),
                        countries: str | None = Query(None, max_length=200)):
    if kind == "country":
        code = (country or "US").upper()
        if code not in macro.BY_ISO2:
            raise HTTPException(404, f"No country {code}. Use one of {', '.join(macro.BY_ISO2)}.")
        return await macro.country(code)
    if kind == "matrix":
        return await macro.matrix()
    if kind == "emerging":
        return await macro.matrix(emerging=True)
    if kind == "policy":
        return {"rows": (await macro.policy_rates())["rows"]}
    if kind == "policy-history":
        areas = "+".join(a.strip().upper() for a in (countries or "US").split(",") if a.strip())[:60]
        return {"series": await macro.policy_history(areas, 3000)}
    if kind == "cli":
        iso3s = [c[1] for c in macro.COUNTRIES if c[0] not in ("XM", "AR", "SA", "PH", "MY", "TH", "CO", "PL")]
        data = await macro.oecd_cli(iso3s)
        names = {c[1]: c[2] for c in macro.COUNTRIES}
        return {"rows": [{"iso3": k, "country": names.get(k, k), **(macro.cli_reading(v) or {}), "path": v} for k, v in data.items()]}
    if kind == "property":
        iso2s = [c[0] for c in macro.COUNTRIES if c[0] not in ("XM",)]
        data = await macro.property_prices(iso2s)
        names = {c[0]: c[2] for c in macro.COUNTRIES}
        return {"rows": [{"iso2": k, "country": names.get(k, k), "latest": v[-1], "path": v} for k, v in data.items() if v]}
    if kind == "reserves":
        return await macro.reserves()
    if kind == "risk":
        return await macro.country_risk()
    if kind == "indicator":
        if not indicator or indicator not in macro.INDICATORS:
            raise HTTPException(422, f"Pick an indicator: {', '.join(macro.INDICATORS)}.")
        iso3s = [macro._wb_iso3(x.strip().upper()) for x in (countries or "US,CN,DE,JP,IN,GB").split(",") if x.strip()][:12]
        return {"indicator": indicator, "name": macro.INDICATORS[indicator], "series": await macro.wb(indicator, iso3s, 30)}
    raise HTTPException(404, f"No macro view called {kind}.")


# ── the US and the Fed: FED, DOTS, FOMC, FCON, BUDG, DEBT, TAYL, IFMO, HSST, OUTL

@router.get("/us/{kind}")
async def us_economy(kind: str):
    fn = {"fed": usmacro.fed, "dots": usmacro.projections, "fomc": usmacro.fomc_documents, "conditions": usmacro.conditions,
          "budget": usmacro.budget, "holders": usmacro.foreign_holders, "taylor": usmacro.taylor_rule,
          "breakevens": usmacro.breakevens, "housing": usmacro.housing, "outlook": usmacro.outlook}.get(kind)
    if fn is None:
        raise HTTPException(404, f"No US view called {kind}.")
    result = await fn()
    return {"rows": result} if isinstance(result, list) else result


# ── commodities and energy: CFTC, CCRV, CRR, GCIN, CPH, CRKS, BOIL, NATG, CRUD

@router.get("/commodities/{kind}")
async def commodity_views(kind: str, code: str | None = Query(None, max_length=10)):
    fn = {"cot": lambda: commodities.cot(code), "curves": commodities.curves, "futures": lambda: commodities.ranked("futures"),
          "indices": lambda: commodities.ranked("indices"), "spot": commodities.spot_prices, "storage": commodities.gas_storage,
          "petroleum": commodities.petroleum, "pink": commodities.pink_sheet}.get(kind)
    if fn is None:
        raise HTTPException(404, f"No commodity view called {kind}.")
    return await fn()
