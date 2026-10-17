import type { ComponentType } from 'react'
import Chart from './Chart'
import Description from './Description'
import Finder from './Finder'
import Financials from './Financials'
import Functions from './Functions'
import Help from './Help'
import History from './History'
import News from './News'
import Overview from './Overview'
import Portfolio from './Portfolio'
import Risk from './Risk'
import type { ViewProps } from './types'
import Unavailable, { reasonFor } from './Unavailable'
import Weather from './Weather'

/** The screen for each live function code. */
const VIEWS: Record<string, ComponentType<ViewProps>> = {
  DES: Description, GP: Chart, GIP: Chart, HP: History, FA: Financials, BETA: Risk,
  CN: News, N: News, TOP: News, WEI: Overview, GLCO: Overview, WETR: Weather,
  PORT: Portfolio, HELP: Help, FUNC: Functions, SECF: Finder,
}

export function viewFor(fn: string, yellowKey: string | null): ComponentType<ViewProps> {
  return reasonFor(fn, yellowKey) ? Unavailable : VIEWS[fn] ?? Unavailable
}

export const LIVE_VIEWS = Object.keys(VIEWS)
export type { ViewProps }
