# Artha Terminal

Goal (his words, 2026-10-16): "current design language is good but I want all
the features of the Bloomberg terminal."

So Artha keeps its Apple News look and gains the Bloomberg way of working: a
command line, function codes, several linked panels, keyboard first. Every
Bloomberg function on the list below is either built, planned, or marked
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
2. **Market-wide**: MOST, MMAP, IMAP, yield curve, BTMM, WCRS, FXC, ECO,
   ECST, WIRP, CTM, EQS.
3. **Company depth**: EE, ERN, EVTS, DVD, CACS, HDS, OWN, MGMT, ANR, RV, SI,
   CF, TRA, COMP, multi-security charts, IPO.
4. **Options**: OMON, OV, OSA, IVOL, HIVG, SKEW, OVDV.
5. **Tools**: watchlist monitors, ALRT, NOTE, CSV export and upload,
   tear sheets, the query language, scenario and attribution on PORT,
   paper order ticket and TCA.

Each phase: small commits, tests with the code, numbers predicted before
they are measured.

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
| READ | Needs readership across many users |
| Bloomberg TV and radio | Licensed broadcast |
| Live order routing (EMSX to a broker) | Needs your broker account; paper only until then |

The full status of every code lives in the registry and in `FUNC` on screen.
