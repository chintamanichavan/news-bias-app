import { Fetched, Kv, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { day } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

export interface DividendData {
  symbol: string; currency: string | null; years_covered: number
  payments: { date: string; amount: number }[]
  summary: {
    trailing_12m: number; yield_pct: number | null; growth_5y_pct: number | null; years_of_increases: number
    by_year: { year: number; total: number; rate: number }[]
  }
  changes: { date: string; from: number; to: number; change_pct: number }[]
  splits: { date: string; ratio: string }[]
}

export function useDividends(symbol: string) {
  return useResource<DividendData>(`/api/terminal/dividends/${encodeURIComponent(symbol)}`, { freshMs: 60 * 60_000 })
}

const amount = (v: number) => v.toFixed(4).replace(/0{1,2}$/, '')

export default function Dividends({ command }: ViewProps) {
  const { data, error, loading } = useDividends(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.payments.length === 0 ? <Note>{d.symbol} has paid no dividends in the last {d.years_covered} years.</Note> : (
        <div className="space-y-4">
          <Kv data={{
            trailing_12m: d.summary.trailing_12m, yield_pct: d.summary.yield_pct,
            growth_5y_pct: d.summary.growth_5y_pct,
            [`years_raised_of_last_${d.summary.by_year.length - 1}`]: d.summary.years_of_increases,
          }} />
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="news-section-label mb-1">Payments</p>
              <Table rows={d.payments} rowKey={p => p.date}
                columns={[
                  { head: 'Paid', align: 'left', cell: p => day(p.date) },
                  { head: `Amount (${d.currency ?? ''})`, cell: p => amount(p.amount) },
                ]} />
            </div>
            <div>
              <p className="news-section-label mb-1">By year</p>
              <Table rows={[...d.summary.by_year].reverse()} rowKey={y => String(y.year)}
                columns={[
                  { head: 'Year', align: 'left', cell: y => y.year },
                  { head: 'Total paid', cell: y => amount(y.total) },
                  { head: 'Rate at year end', cell: y => amount(y.rate) },
                ]} />
            </div>
          </div>
          <Note>
            Last {d.years_covered} years, by ex-dividend date. Growth and the run of raises use each year&rsquo;s closing
            rate, so a payment that slips across New Year does not look like a cut. CACS lists raises, cuts and splits.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
