// The company screens (EE, ERN, EVTS, ANR, MGMT, SI, HDS, OWN) all read one
// summary per company; useResource shares the fetch between panels.

import { Fetched, Note } from '../kit'
import { useResource } from '@/lib/useResource'

type N = number | null

export interface Company {
  name: string | null
  currency: string | null
  estimates: {
    period: string; end: string; eps_avg: N; eps_low: N; eps_high: N; eps_year_ago: N
    eps_growth_pct: N; analysts: N; revenue_avg: N; revenue_growth_pct: N
    eps_90_days_ago: N; revisions_up_30d: N; revisions_down_30d: N
  }[] | null
  earnings: {
    quarters: { quarter_end: string; actual: N; estimate: N; surprise_pct: N }[]
    years: { year: number; revenue: N; earnings: N }[]
  } | null
  events: {
    earnings_dates: string[]; earnings_date_is_estimate: boolean | null
    eps_expected: N; revenue_expected: N; ex_dividend: string | null; dividend_paid: string | null
  } | null
  analysts: {
    targets: { low: N; mean: N; median: N; high: N }; price: N; rating_mean: N; rating: string | null
    opinions: N
    trend: { period: string; strongBuy: number; buy: number; hold: number; sell: number; strongSell: number }[]
    changes: { date: string; firm: string; from: string | null; to: string | null; action: string; target: N; prior_target: N }[]
  } | null
  management: {
    officers: { name: string; title: string; age: N; pay: N; pay_year: N }[]
    governance: Record<string, number>; employees: N; website: string | null
  } | null
  short_interest: {
    shares_short: number; prior_month: N; change_pct: N; days_to_cover: N; pct_of_float: N
    pct_of_shares: N; as_of: string | null; prior_as_of: string | null; float: N
  } | null
  holders: { institutions: Owner[]; funds: Owner[] } | null
  ownership: {
    split: { insiders_pct: N; institutions_pct: N; institutions: N }
    insiders: { name: string; role: string; shares: N; last: string | null; date: string | null }[]
    trades: { date: string | null; name: string; role: string; text: string | null; shares: N; value: N }[]
    insider_six_months: { buys: N; sells: N; net_shares: N } | null
  } | null
}

export interface Owner { holder: string; pct: N; shares: N; value: N; change_pct: N; as_of: string | null }

export function useCompany(symbol: string) {
  return useResource<Company>(`/api/terminal/company/${encodeURIComponent(symbol)}`, { freshMs: 15 * 60_000 })
}

/** Fetches the company, then renders one section — or says it is missing. */
export function CompanySection<K extends keyof Company>({ symbol, section, missing, children }: {
  symbol: string
  section: K
  missing: string
  children: (data: NonNullable<Company[K]>, company: Company) => React.ReactNode
}) {
  const { data, error, loading } = useCompany(symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {c => {
        const part = c[section]
        return part == null ? <Note>{missing}</Note> : <>{children(part as NonNullable<Company[K]>, c)}</>
      }}
    </Fetched>
  )
}
