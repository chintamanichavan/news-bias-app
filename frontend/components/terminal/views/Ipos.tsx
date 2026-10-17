import { Fetched, Note, Table } from '../kit'
import { big } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Deal { symbol: string | null; company: string; exchange: string | null; price: string | null; shares: string | null; date: string | null; amount: number | null }
interface Ipo { months: string[]; priced: Deal[]; upcoming: Deal[]; filed: Deal[]; withdrawn: Deal[] }

const SECTIONS: [keyof Omit<Ipo, 'months'>, string][] = [
  ['upcoming', 'Coming'], ['priced', 'Priced'], ['filed', 'Filed'], ['withdrawn', 'Withdrawn'],
]

export default function Ipos() {
  const { data, error, loading } = useResource<Ipo>('/api/terminal/ipos')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          {SECTIONS.map(([key, title]) => (
            <div key={key}>
              <p className="news-section-label mb-1">{title} · {d[key].length}</p>
              {d[key].length === 0 ? <Note>None.</Note> : (
                <Table rows={d[key]} rowKey={(r, i) => `${r.company}-${i}`}
                  columns={[
                    { head: 'Date', align: 'left', cell: r => r.date ?? '—' },
                    { head: 'Company', align: 'left', cell: r => <span><b>{r.symbol ?? '—'}</b> {r.company}</span> },
                    { head: 'Exchange', align: 'left', cell: r => r.exchange ?? '—' },
                    { head: 'Price', cell: r => r.price ?? '—' },
                    { head: 'Shares', cell: r => r.shares ?? '—' },
                    { head: 'Raising', cell: r => (r.amount ? `$${big(r.amount)}` : '—') },
                  ]} />
              )}
            </div>
          ))}
          <Note>Nasdaq&rsquo;s IPO calendar for {d.months.join(' and ')}, all US exchanges.</Note>
        </div>
      )}
    </Fetched>
  )
}
