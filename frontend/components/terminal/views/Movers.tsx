import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Row {
  symbol: string; name: string; price: number; change_pct: number | null
  volume: number | null; avg_volume_3m: number | null; market_cap: number | null
}

const KINDS = [['active', 'Most active'], ['gainers', 'Gainers'], ['losers', 'Losers']] as const
type Kind = (typeof KINDS)[number][0]

function kindOf(args: string[]): Kind {
  const a = (args[0] ?? '').toLowerCase()
  return a.startsWith('gain') ? 'gainers' : a.startsWith('los') ? 'losers' : 'active'
}

export default function Movers({ command, run }: ViewProps) {
  const kind = kindOf(command.args)
  const { data, error, loading } = useResource<{ rows: Row[] }>(`/api/terminal/movers?kind=${kind}`)
  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        {KINDS.map(([k, label]) => (
          <button key={k} onClick={() => run(`MOST ${k.toUpperCase()}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full ${
              k === kind ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {label}
          </button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <>
            <Table
              rows={d.rows}
              rowKey={r => r.symbol}
              onRow={r => run(`${r.symbol} GIP`)}
              columns={[
                { head: 'Ticker', align: 'left', cell: r => <span className="font-semibold">{r.symbol}</span> },
                { head: 'Name', align: 'left', cell: r => <span className="block max-w-[12rem] truncate">{r.name}</span> },
                { head: 'Last', cell: r => price(r.price) },
                { head: 'Change', cell: r => pct(r.change_pct), className: r => `font-semibold ${tone(r.change_pct)}` },
                { head: 'Volume', cell: r => big(r.volume) },
                // how unusual today's volume is against its three-month average
                { head: 'Vol / avg', cell: r => (r.volume && r.avg_volume_3m ? `${(r.volume / r.avg_volume_3m).toFixed(1)}×` : '—') },
                { head: 'Mkt cap', cell: r => big(r.market_cap) },
              ]}
            />
            <Note>US listings, about 15 minutes late. Click a row for its intraday chart.</Note>
          </>
        )}
      </Fetched>
    </div>
  )
}
