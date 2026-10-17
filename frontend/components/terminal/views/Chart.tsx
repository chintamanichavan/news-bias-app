import PriceChart, { type OHLC } from '@/components/PriceChart'
import { Fetched, Fail } from '../kit'
import type { ViewProps } from './types'
import { pct, price, tone } from '@/lib/terminal/numbers'
import { argFor, rangeFor, RANGE_ARGS, type Range } from '@/lib/terminal/ranges'
import { rangeChange } from '@/lib/terminal/series'
import { useResource } from '@/lib/useResource'

export interface PriceSeries {
  symbol: string
  name: string | null
  currency: string | null
  price: number | null
  series: OHLC[]
}

export function usePrices(symbol: string, range: Range) {
  return useResource<PriceSeries>(`/api/markets/${encodeURIComponent(symbol)}?range=${range}`)
}

export default function Chart({ command, run }: ViewProps) {
  const sec = command.security!
  const fallback: Range = command.fn === 'GIP' ? '1d' : '1y'
  const picked = rangeFor(command.args, fallback)
  const range = 'range' in picked ? picked.range : fallback
  const { data, error, loading } = usePrices(sec.symbol, range)
  if ('error' in picked) return <Fail message={picked.error} />

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {RANGE_ARGS.map(a => (
          <button key={a} onClick={() => run(`${sec.label} ${command.fn} ${a}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full tabular-nums ${
              argFor(range) === a ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {a}
          </button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const change = rangeChange(d.series)
          return (
            <>
              <div className="flex items-baseline gap-3 tabular-nums">
                <span className="text-xl font-bold">{price(d.price)}</span>
                <span className="text-[11px] text-muted-foreground">{d.currency}</span>
                <span className={`text-[12px] font-semibold ${tone(change)}`}>{pct(change)} over {argFor(range)}</span>
              </div>
              <PriceChart series={d.series} intraday={range === '1d' || range === '5d'} height={240} />
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
