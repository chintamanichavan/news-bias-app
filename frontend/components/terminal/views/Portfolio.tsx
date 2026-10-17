import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Name {
  ticker: string
  name: string
  moat_strength: string | null
  price: number | null
  buy_below: number | null
  to_buy_zone_pct?: number
  in_buy_zone?: boolean
  last_reviewed: string | null
}

export default function Portfolio({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ available: boolean; watchlist: Name[] }>('/api/portfolio')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        if (!d.available) return <Note>The portfolio workspace was not found on this machine.</Note>
        return (
          <div className="space-y-2">
            <Table
              rows={d.watchlist}
              rowKey={n => n.ticker}
              onRow={n => run(`${n.ticker} DES`)}
              columns={[
                { head: 'Ticker', align: 'left', cell: n => <span className="font-semibold">{n.ticker}</span> },
                { head: 'Name', align: 'left', cell: n => <span className="truncate block max-w-[14rem]">{n.name}</span> },
                { head: 'Moat', align: 'left', cell: n => n.moat_strength ?? '—' },
                { head: 'Price', cell: n => price(n.price) },
                { head: 'Buy below', cell: n => price(n.buy_below) },
                {
                  head: 'To zone', cell: n => (n.in_buy_zone ? 'IN ZONE' : pct(n.to_buy_zone_pct ?? null)),
                  className: n => (n.in_buy_zone ? 'font-semibold text-emerald-600 dark:text-emerald-400' : tone(-(n.to_buy_zone_pct ?? 0))),
                },
              ]}
            />
            <Note>Your research watchlist, not holdings. The Portfolio page has the return rule and the queue.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
