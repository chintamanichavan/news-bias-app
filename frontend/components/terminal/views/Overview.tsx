import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import type { Quote } from '@/components/QuoteRow'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Markets {
  indices: Quote[]; volatility: Quote[]; commodities: Quote[]; futures: Quote[]
  fetched_at: number
}

// WEI: world equity indices and volatility. GLCO: commodities and futures.
const SECTIONS: Record<string, { title: string; key: keyof Omit<Markets, 'fetched_at'> }[]> = {
  WEI: [{ title: 'Indices', key: 'indices' }, { title: 'Volatility', key: 'volatility' }],
  GLCO: [{ title: 'Commodities', key: 'commodities' }, { title: 'Futures', key: 'futures' }],
}

export default function Overview({ command, run }: ViewProps) {
  const { data, error, loading } = useResource<Markets>('/api/markets')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          {SECTIONS[command.fn].map(section => (
            <div key={section.key}>
              <p className="news-section-label mb-1">{section.title}</p>
              <Table
                rows={d[section.key]}
                rowKey={q => q.symbol}
                onRow={q => run(`${q.symbol} GP 1M`)}
                columns={[
                  { head: 'Name', align: 'left', cell: q => <span className="font-medium">{q.name}</span> },
                  { head: 'Last', cell: q => price(q.price) },
                  { head: 'Change', cell: q => pct(q.change_pct), className: q => `font-semibold ${tone(q.change_pct)}` },
                  { head: 'High', cell: q => price(q.day_high) },
                  { head: 'Low', cell: q => price(q.day_low) },
                  { head: 'Volume', cell: q => big(q.volume) },
                ]}
              />
            </div>
          ))}
          <Note>Quotes are about 15 minutes late. Click a row for its one-month chart.</Note>
        </div>
      )}
    </Fetched>
  )
}
