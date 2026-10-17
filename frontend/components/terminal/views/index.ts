import type { ComponentType } from 'react'
import Calendar from './Calendar'
import Analysts from './Analysts'
import Chart from './Chart'
import Crosses from './Crosses'
import Currencies from './Currencies'
import Curve from './Curve'
import Description from './Description'
import Earnings from './Earnings'
import Economy from './Economy'
import Estimates from './Estimates'
import Events from './Events'
import Finder from './Finder'
import Financials from './Financials'
import Functions from './Functions'
import Futures from './Futures'
import Heatmap from './Heatmap'
import Holders from './Holders'
import Help from './Help'
import History from './History'
import Management from './Management'
import Industries from './Industries'
import Money from './Money'
import Movers from './Movers'
import News from './News'
import Overview from './Overview'
import Ownership from './Ownership'
import Portfolio from './Portfolio'
import Risk from './Risk'
import Screener from './Screener'
import ShortInterest from './ShortInterest'
import type { ViewProps } from './types'
import Unavailable, { reasonFor } from './Unavailable'
import Weather from './Weather'
import Wirp from './Wirp'

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
}

export function viewFor(fn: string, yellowKey: string | null): ComponentType<ViewProps> {
  return reasonFor(fn, yellowKey) ? Unavailable : VIEWS[fn] ?? Unavailable
}

export const LIVE_VIEWS = Object.keys(VIEWS)
export type { ViewProps }
