import { Fetched, Note, Table } from '../kit'
import { heat } from './Heatmap'
import type { ViewProps } from './types'
import { pct } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

type Key = '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y'
type Row = { symbol: string; name: string; price: number } & Record<Key, number | null>

// a longer window needs a bigger move to count as strong
const COLUMNS: [Key, string, number][] = [
  ['1d', '1 day', 3], ['1w', '1 week', 6], ['1m', '1 month', 10],
  ['3m', '3 months', 15], ['ytd', 'This year', 25], ['1y', '1 year', 30],
]

function Board({ title, rows, run }: { title: string; rows: Row[]; run: ViewProps['run'] }) {
  const sorted = [...rows].sort((a, b) => (b['1d'] ?? -99) - (a['1d'] ?? -99))
  return (
    <div>
      <p className="news-section-label mb-1">{title}</p>
      <Table
        rows={sorted}
        rowKey={r => r.symbol}
        onRow={r => run(`${r.symbol} GP 1Y`)}
        columns={[
          { head: 'ETF', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
          ...COLUMNS.map(([key, head, full]) => ({
            head,
            cell: (r: Row) => <span className="block rounded-sm px-1" style={{ background: heat(r[key], full) }}>{pct(r[key])}</span>,
          })),
        ]}
      />
    </div>
  )
}

export default function Industries({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ sectors: Row[]; industries: Row[] }>('/api/terminal/industries')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          <Board title="Sectors" rows={d.sectors} run={run} />
          <Board title="Industries" rows={d.industries} run={run} />
          <Note>Each line is an exchange-traded fund that holds the sector or industry. Sorted by today&rsquo;s move.</Note>
        </div>
      )}
    </Fetched>
  )
}
