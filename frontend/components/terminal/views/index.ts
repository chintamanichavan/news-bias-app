import type { ComponentType } from 'react'
import Bql from './Bql'
import Calendar from './Calendar'
import Alerts from './Alerts'
import Analysts from './Analysts'
import Attribution from './Attribution'
import Chart from './Chart'
import Compare from './Compare'
import CorporateActions from './CorporateActions'
import Crosses from './Crosses'
import Currencies from './Currencies'
import Curve from './Curve'
import Description from './Description'
import Dividends from './Dividends'
import Earnings from './Earnings'
import Economy from './Economy'
import Emsx from './Emsx'
import Estimates from './Estimates'
import Export from './Export'
import Events from './Events'
import Finder from './Finder'
import Filings from './Filings'
import Financials from './Financials'
import Functions from './Functions'
import Futures from './Futures'
import Heatmap from './Heatmap'
import Hivg from './Hivg'
import Holders from './Holders'
import Holdings from './Holdings'
import Help from './Help'
import History from './History'
import Management from './Management'
import Mars from './Mars'
import Industries from './Industries'
import Ipos from './Ipos'
import Ivol from './Ivol'
import Money from './Money'
import Movers from './Movers'
import News from './News'
import Notes from './Notes'
import Omon from './Omon'
import Ov from './Ov'
import Ovdv from './Ovdv'
import Osa from './Osa'
import Overview from './Overview'
import Peers from './Peers'
import Ownership from './Ownership'
import Portfolio from './Portfolio'
import Risk from './Risk'
import Tear from './Tear'
import TotalReturn from './TotalReturn'
import Screener from './Screener'
import ShortInterest from './ShortInterest'
import Skew from './Skew'
import type { ViewProps } from './types'
import Unavailable, { reasonFor } from './Unavailable'
import Watchlist from './Watchlist'
import Weather from './Weather'
import Wirp from './Wirp'
import Technical, { TECHNICAL_CODES } from './Technical'
import Pairs from './Pairs'
import { Corr, Hra } from './Relations'
import Mov from './Mov'
import WorldBonds from './WorldBonds'
import Valuation from './Valuation'
import Tca from './Tca'

/** The screen for each live function code. */
const VIEWS: Record<string, ComponentType<ViewProps>> = {
  DES: Description, GP: Chart, GIP: Chart, HP: History, FA: Financials, BETA: Risk,
  CN: News, N: News, TOP: News, WEI: Overview, GLCO: Overview, WETR: Weather,
  PORT: Portfolio, HELP: Help, FUNC: Functions, SECF: Finder,
  MOST: Movers, MMAP: Heatmap, NSE: News,
  GC: Curve, BTMM: Money, WIRP: Wirp,
  WCRS: Currencies, FXC: Crosses,
  CTM: Futures, IMAP: Industries,
  ECO: Calendar, ECST: Economy,
  EQS: Screener,
  EE: Estimates, ERN: Earnings, EVTS: Events, ANR: Analysts,
  MGMT: Management, SI: ShortInterest, HDS: Holders, OWN: Ownership,
  DVD: Dividends, CACS: CorporateActions, TRA: TotalReturn, COMP: Compare, G: Compare,
  CF: Filings, RV: Peers, IPO: Ipos,
  OMON: Omon, OV: Ov, IVOL: Ivol, HIVG: Hivg, SKEW: Skew, OVDV: Ovdv, OSA: Osa,
  W: Watchlist, NOTE: Notes, ALRT: Alerts, EXPT: Export, TEAR: Tear, BQL: Bql,
  PRTU: Holdings, MARS: Mars, ATTR: Attribution,
  EMSX: Emsx, TCA: Tca,
  ...Object.fromEntries(TECHNICAL_CODES.map(c => [c, Technical])),
  HS: Pairs, HSP: Pairs, HSE: Pairs, HSN: Pairs, SGP: Pairs, GR: Pairs, SGIP: Pairs, ISGP: Pairs, GV: Pairs,
  GIPS: Chart, GIPW: Chart, MGR: Compare,
  HRA: Hra, CORR: Corr, MOV: Mov, WB: WorldBonds,
  WACC: Valuation, DCF: Valuation, DDM: Valuation,
}

export function viewFor(fn: string, yellowKey: string | null): ComponentType<ViewProps> {
  return reasonFor(fn, yellowKey) ? Unavailable : VIEWS[fn] ?? Unavailable
}

export const LIVE_VIEWS = Object.keys(VIEWS)
export type { ViewProps }
