import { Fetched, Note, Table } from '../kit'
import { useDividends } from './Dividends'
import type { ViewProps } from './types'
import { day, pct, tone } from '@/lib/terminal/numbers'

export default function CorporateActions({ command }: ViewProps) {
  const { data, error, loading } = useDividends(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = [
          ...d.splits.map(s => ({ date: s.date, what: `Stock split ${s.ratio}`, change: null as number | null })),
          ...d.changes.map(c => ({
            date: c.date, change: c.change_pct,
            what: `Dividend ${c.change_pct > 0 ? 'raised' : 'cut'} from ${c.from.toFixed(4)} to ${c.to.toFixed(4)}`,
          })),
        ].sort((a, b) => b.date.localeCompare(a.date))
        return rows.length === 0 ? <Note>No splits or dividend changes on record.</Note> : (
          <div className="space-y-2">
            <Table rows={rows} rowKey={(r, i) => `${r.date}-${i}`}
              columns={[
                { head: 'Date', align: 'left', cell: r => day(r.date) },
                { head: 'Action', align: 'left', cell: r => r.what },
                { head: 'Change', cell: r => pct(r.change), className: r => tone(r.change) },
              ]} />
            <Note>
              Splits since listing; dividend changes over the last {d.years_covered} years. Spin-offs, mergers and name
              changes are not in the free data; CF lists the company&rsquo;s filings, where they are announced.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
