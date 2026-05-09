import Link from 'next/link'
import { Card } from '@/components/ui/card'

export interface Quote {
  symbol: string
  name: string
  price: number | null
  previous_close: number | null
  change: number | null
  change_pct: number | null
  day_high: number | null
  day_low: number | null
  volume: number | null
  currency: string | null
  exchange: string | null
  instrument_type: string | null
  spark: number[]
}

function fmtPrice(p: number | null, ccy: string | null): string {
  if (p == null) return '—'
  const abs = Math.abs(p)
  const decimals = abs >= 1000 ? 2 : abs >= 10 ? 2 : 4
  const s = p.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (!ccy || ccy === 'USD') return s
  return `${s} ${ccy}`
}

function fmtVolume(v: number | null): string {
  if (v == null || v === 0) return ''
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toString()
}

function Spark({ data, up }: { data: number[]; up: boolean }) {
  if (data.length < 2) return <div className="h-8 w-20" />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const w = 80
  const h = 28
  const step = w / (data.length - 1)
  const path = data
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`)
    .join(' ')
  const stroke = up ? 'stroke-emerald-500' : 'stroke-rose-500'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-7" fill="none">
      <path d={path} className={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function QuoteCard({ q }: { q: Quote }) {
  const up = (q.change ?? 0) >= 0
  const changeColor =
    q.change == null ? 'text-muted-foreground' :
    up ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
  const changeBg =
    q.change == null ? 'bg-muted' :
    up ? 'bg-emerald-100 dark:bg-emerald-950/40' : 'bg-rose-100 dark:bg-rose-950/40'
  const borderTint =
    q.change == null ? 'border-l-border' :
    up ? 'border-l-emerald-400' : 'border-l-rose-400'

  return (
    <Link href={`/markets/${encodeURIComponent(q.symbol)}`} className="block h-full group">
    <Card className={`overflow-hidden h-full transition-all hover:shadow-md hover:-translate-y-0.5 border-l-4 ${borderTint}`}>
      <div className="p-3 flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold tabular-nums tracking-tight">{q.symbol}</span>
          {q.volume ? (
            <span className="text-[10px] text-muted-foreground tabular-nums">vol {fmtVolume(q.volume)}</span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground line-clamp-1 leading-tight" title={q.name}>
          {q.name}
        </p>
        <div className="flex items-end justify-between gap-2 mt-1">
          <div>
            <div className="text-xl font-semibold tabular-nums leading-none">{fmtPrice(q.price, q.currency)}</div>
            {q.change != null && q.change_pct != null ? (
              <div className={`mt-1 inline-block text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded ${changeBg} ${changeColor}`}>
                {up ? '+' : ''}{q.change.toFixed(Math.abs(q.change) >= 10 ? 2 : 2)} ({up ? '+' : ''}{q.change_pct.toFixed(2)}%)
              </div>
            ) : (
              <div className="mt-1 text-[11px] text-muted-foreground">—</div>
            )}
          </div>
          <Spark data={q.spark} up={up} />
        </div>
      </div>
    </Card>
    </Link>
  )
}
