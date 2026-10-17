# Artha Terminal

Goal (his words, 2026-10-16): "current design language is good but I want all
the features of the Bloomberg terminal."

So Artha keeps its Apple News look and gains the Bloomberg way of working: a
command line, function codes, several linked panels, keyboard first. Every
Bloomberg function on the list below is either built or marked
impossible with the reason. Nothing is dropped silently.

The list is compiled from memory of Bloomberg's public documentation, not
from a live terminal. Bloomberg has tens of thousands of functions; this
covers the ones people actually use day to day. Nothing here is taken from
an employer's Bloomberg account, and no Bloomberg data or styling is copied.

## How Bloomberg works, and what that means here

| Bloomberg | Artha |
|---|---|
| Own data: exchange feeds, reporters, quotes sent in by dealers | Free data only: Yahoo (15 minutes late), SEC EDGAR, FRED, GDELT, own news corpus |
| One symbol language (`AAPL US Equity`) | Same grammar, translated to the provider's symbol |
| Private network, thin client, server-side functions | FastAPI on this machine, Next.js client, tailnet |
| Every screen is a function code | Same: one registry, `frontend/lib/terminal/functions.ts` |
| Launchpad: many linked panels | `/terminal`: 1, 2 or 4 panels, linked by colour group |
| Chat network (IB, MSG) | Impossible: the value is the people on it |

## The command grammar

    [SECURITY [EXCHANGE] [YELLOW KEY]] FUNCTION [ARGS] <Enter>

- `AAPL DES`, `AAPL US EQUITY DES`, `VOD LN EQUITY GP 5Y`, `EURUSD CURNCY GP`,
  `SPX INDEX HP`, `CL1 COMDTY GP 1Y`.
- A bare security opens its description: `AAPL` = `AAPL DES`.
- A bare function uses the panel's current security: `GP` after `AAPL DES`.
- `HELP DES` explains a function. `FUNC` lists and searches all of them.
- Without a yellow key, the first word is a function if it is one. So a
  ticker that is also a function code (rare) needs the yellow key:
  `HP US EQUITY DES`.
- Raw provider symbols also work: `^GSPC`, `EURUSD=X`, `BTC-USD`, `7203.T`.

Yellow keys: EQUITY, CORP, GOVT, MTGE, MMKT, MUNI, PFD, COMDTY, INDEX,
CURNCY. Corp, Govt, Mtge, Muni and Pfd parse, but bond prices are not
available free, so their functions answer with that reason.

## Layout and keys

- Command bar on every page: `/` or `Ctrl-K`. Enter opens the result in the
  terminal.
- `/terminal`: 1, 2 or 4 panels. `Alt-1`..`Alt-4` focuses a panel.
  `Alt-[` / `Alt-]` go back and forward in that panel's history. (Ctrl-1 and
  Alt-Left belong to the browser: switch tab, go back.)
- Each panel has a link group (none, A, B). Loading a security in one panel
  of a group reloads the others in that group on the new security, keeping
  each one's function.
- Layout, commands and groups persist in the browser.

## Phases

1. **Core** (this commit series): grammar, registry, command bar, panels,
   linking, history, HELP/FUNC/SECF, and the functions the existing
   endpoints already serve.
2. **Market-wide** (done, 2026-10-16): MOST, MMAP, IMAP, CTM, GC, BTMM,
   WIRP, WCRS, FXC, ECO, ECST, EQS, NSE. See "Phase 2 sources" below.
3. **Company depth** (done, 2026-10-16): EE, ERN, EVTS, ANR, MGMT, SI, HDS,
   OWN, DVD, CACS, TRA, COMP, G, CF, RV, IPO. ESG turned out impossible.
4. **Options** (done, 2026-10-16): OMON, OV, OSA, IVOL, HIVG, SKEW, OVDV.
5. **Tools** (done, 2026-10-16): W, ALRT, NOTE, EXPT and CSV on every
   panel, TEAR, BQL, PRTU, MARS, ATTR, EMSX (paper) and TCA. Every
   function is now live or marked impossible: 63 live, 25 impossible.

EMSX fills are deliberately not flattering: a market order crosses the
spread, a limit order fills only when the far side of the quote reaches
it, and quotes are about 15 minutes late. TCA measures each fill in basis
points against the arrival midpoint and against the day's VWAP from
5-minute bars.

Each phase: small commits, tests with the code, numbers predicted before
they are measured.

## Phase 2 sources

The backend for these lives in `ml-service/terminal/`, one module per kind
of source, served under `/terminal/*`.

| Function | Source |
|---|---|
| MOST, MMAP | Yahoo predefined screeners (movers; sector lists by market cap) |
| CTM, IMAP, WCRS, FXC | Yahoo daily charts (futures by contract month, ETFs, currencies) |
| GC | US Treasury daily par yield curve |
| BTMM | New York Fed reference rates, Treasury curve, fed funds futures |
| WIRP | Fed funds futures by month, FOMC dates from the Fed's calendar page |
| ECO | BEA release schedule, Census indicator calendar, FOMC dates |
| ECST | BLS public data API (25 requests a day without a key; cached on disk) |
| EQS | Artha's point-in-time store; expected return from the Portfolio screen |
| NSE | Artha's own news corpus |
| EE, ERN, EVTS, ANR, MGMT, SI, HDS, OWN | Yahoo quoteSummary (session cookie and token) |
| DVD, CACS, TRA, COMP, G | Yahoo price history with adjusted closes, dividends and splits |
| CF | SEC EDGAR submissions |
| RV | Yahoo's "similar" list, measured on the EQS table |
| IPO | Nasdaq IPO calendar |
| OMON, OV, IVOL, HIVG, SKEW, OVDV | Yahoo option chains; volatility and greeks solved here with Black-Scholes-Merton |
| OSA | The same chains, priced in the browser |

Gaps, as of 2026-10-16:
- FRED timed out on every request from this machine, so nothing in phase 2
  depends on it.
- bls.gov refuses automated requests, so CPI and jobs-report *dates* are
  missing from ECO (the numbers themselves come from the BLS API).
- GDP and consumer spending need a free BEA API key, which needs a sign-up.
- Option volatility is solved from bid/ask midpoints with European
  Black-Scholes-Merton, the Treasury rate and the trailing dividend yield.
  US stock options are American, so deep in-the-money puts are approximate.
  Yahoo's own volatilities assume roughly zero interest and are not used.
- No free source keeps implied-volatility history; HIVG records one 30-day
  reading per security per day, starting the first time it is asked.
- Yahoo's full-history price reply drops most dividends; DVD reads the
  10-year reply, which has every payment, so dividend history is 10 years.

## Impossible on free data

| Function | Why |
|---|---|
| IB, MSG | A messaging network; the value is everyone else on it |
| ALLQ, bond prices, TSOX, FXGO, RFQ, IOI, FIT, SRCH, YAS | Dealer quotes sent privately to Bloomberg |
| MBO / MBP depth, true real time | Licensed exchange feeds; free quotes are 15 minutes late |
| FIRST, BI, BRC, BNEF | Bloomberg's own reporters and researchers |
| ECFC, FXFC | Surveys of forecasters that Bloomberg runs |
| CRPR, DDIS | Ratings are licensed by the agencies; bond holdings data is private |
| SPLC, MA, BPS, FSRC | Proprietary supply-chain, deal, people and fund databases |
| ESG | Yahoo stopped publishing scores; the rating firms license them |
| READ | Needs readership across many users |
| Bloomberg TV and radio | Licensed broadcast |
| Live order routing (EMSX to a broker) | Needs your broker account; paper only until then |

The full status of every code lives in the registry and in `FUNC` on screen.
