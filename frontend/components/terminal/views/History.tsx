import { Fetched, Fail, Table } from '../kit'
import { usePrices } from './Chart'
import type { ViewProps } from './types'
import { big, day, pct, price, tone } from '@/lib/terminal/numbers'
import { rangeFor } from '@/lib/terminal/ranges'
import { withChanges } from '@/lib/terminal/series'

export default function History({ command }: ViewProps) {
  const sec = command.security!
  const picked = rangeFor(command.args, '1mo')
  const range = 'range' in picked ? picked.range : '1mo'
  const { data, error, loading } = usePrices(sec.symbol, range)
  if ('error' in picked) return <Fail message={picked.error} />
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <Table
          rows={withChanges(d.series)}
          rowKey={r => String(r.t)}
          columns={[
            { head: 'Date', align: 'left', cell: r => day(r.t) },
            { head: 'Open', cell: r => price(r.o) },
            { head: 'High', cell: r => price(r.h) },
            { head: 'Low', cell: r => price(r.l) },
            { head: 'Close', cell: r => price(r.c) },
            { head: 'Change', cell: r => pct(r.change), className: r => tone(r.change) },
            // currencies and some indices report no volume at all
            { head: 'Volume', cell: r => (r.v ? big(r.v) : '—') },
          ]}
        />
      )}
    </Fetched>
  )
}
