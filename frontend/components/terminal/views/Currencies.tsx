import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { rateText, useFx, type CurrencyRow } from './fx'
import { day, pct, tone } from '@/lib/terminal/numbers'

const CHANGES: [keyof CurrencyRow, string][] = [
  ['ch_1d', '1 day'], ['ch_1w', '1 week'], ['ch_1m', '1 month'], ['ch_ytd', 'This year'], ['ch_1y', '1 year'],
]

export default function Currencies({ run }: ViewProps) {
  const { data, error, loading } = useFx()
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          <Table
            rows={d.currencies}
            rowKey={r => r.code}
            onRow={r => run(`${r.pair} CURNCY GP 1Y`)}
            columns={[
              { head: 'Currency', align: 'left', cell: r => <span><b>{r.code}</b> <span className="text-muted-foreground">{r.name}</span></span> },
              { head: 'Pair', align: 'left', cell: r => r.pair },
              { head: 'Rate', cell: r => rateText(r.rate) },
              ...CHANGES.map(([key, head]) => ({
                head, cell: (r: CurrencyRow) => pct(r[key] as number | null),
                className: (r: CurrencyRow) => tone(r[key] as number | null),
              })),
            ]}
          />
          <Note>
            Change is the currency against the US dollar: green means it gained. Rates for {day(d.currencies[0]?.as_of)},
            about 15 minutes late.{d.missing.length ? ` No data for ${d.missing.join(', ')}.` : ''} Click a row for its chart.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
