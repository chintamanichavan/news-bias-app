import { Fetched, Note, Table } from '../kit'
import { useResource } from '@/lib/useResource'

interface Stat { series: string; name: string; unit: string; period: string; latest: number | null; prior: number | null }

const fmt = (v: number | null) => (v == null ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: 2 }))

/** "2026-09" -> "Sep 2026"; a full date is shown as given */
function period(p: string): string {
  if (!/^\d{4}-\d{2}$/.test(p)) return p
  const [y, m] = p.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export default function Economy() {
  const { data, error, loading } = useResource<{ rows: Stat[] }>('/api/terminal/econ')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          <Table
            rows={d.rows}
            rowKey={r => r.series}
            columns={[
              { head: 'Indicator', align: 'left', cell: r => r.name },
              { head: 'Latest', cell: r => <b>{fmt(r.latest)}</b> },
              { head: 'Before', cell: r => fmt(r.prior) },
              { head: 'Unit', align: 'left', cell: r => <span className="text-muted-foreground">{r.unit}</span> },
              { head: 'For', cell: r => period(r.period) },
            ]}
          />
          <Note>
            US Bureau of Labor Statistics through its public data API; Treasury yields from the daily curve. GDP and
            spending need a BEA key, so they are not here yet.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
