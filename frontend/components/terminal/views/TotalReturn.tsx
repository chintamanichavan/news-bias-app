import { Fetched, Note, Table } from '../kit'
import { PERIODS, useReturns } from './returns'
import type { ViewProps } from './types'
import { pct, tone } from '@/lib/terminal/numbers'

export default function TotalReturn({ command }: ViewProps) {
  const sym = command.security!.symbol
  const { data, error, loading } = useReturns([sym], '5Y')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const s = d.series[0]
        if (!s || s.missing || !s.periods) return <Note>No price history for {sym}.</Note>
        const rows = PERIODS.filter(([k]) => s.periods![k])
        return (
          <div className="space-y-2">
            <Table rows={rows} rowKey={([k]) => k}
              columns={[
                { head: 'Period', align: 'left', cell: ([, label]) => label },
                { head: 'Price', cell: ([k]) => pct(s.periods![k]!.price_pct), className: ([k]) => tone(s.periods![k]!.price_pct) },
                { head: 'Dividends', cell: ([k]) => pct(s.periods![k]!.income_pct) },
                { head: 'Total', cell: ([k]) => <b>{pct(s.periods![k]!.total_pct)}</b>, className: ([k]) => tone(s.periods![k]!.total_pct) },
                { head: 'Total a year', cell: ([k]) => pct(s.periods![k]!.per_year_pct) },
              ]} />
            <Note>Total return reinvests every dividend on its ex-date. COMP sets it against the market.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
