import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useResource } from '@/lib/useResource'

interface Hit { symbol: string; name: string; asset_class: string; region: string }

export default function Finder({ command, run }: ViewProps) {
  const q = command.args.join(' ')
  const { data, error, loading } = useResource<{ results: Hit[] }>(
    q ? `/api/lab/search?q=${encodeURIComponent(q)}` : null)
  if (!q) return <Note>Type a name or ticker after SECF, for example SECF apple.</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.results.length === 0 ? <Note>Nothing found for {q}.</Note> : (
        <Table
          rows={d.results}
          rowKey={h => h.symbol}
          onRow={h => run(`${h.symbol} DES`)}
          columns={[
            { head: 'Symbol', align: 'left', cell: h => <span className="font-semibold">{h.symbol}</span> },
            { head: 'Name', align: 'left', cell: h => h.name },
            { head: 'Class', align: 'left', cell: h => h.asset_class },
            { head: 'Region', align: 'left', cell: h => h.region },
          ]}
        />
      )}
    </Fetched>
  )
}
