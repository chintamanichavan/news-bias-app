import Link from 'next/link'

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

function fmtPrice(p: number | null): string {
  if (p == null) return '—'
  const abs = Math.abs(p)
  const decimals = abs >= 1000 ? 2 : abs >= 10 ? 2 : 4
  return p.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function Spark({ data, up, neutral }: { data: number[]; up: boolean; neutral: boolean }) {
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
  const stroke = neutral ? 'stroke-stone-400' : up ? 'stroke-emerald-500' : 'stroke-rose-500'
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-20 h-7 shrink-0" fill="none">
      <path d={path} className={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export default function QuoteRow({ q }: { q: Quote }) {
  const up = (q.change ?? 0) >= 0
  const hasChange = q.change != null && q.change_pct != null
  const neutral = !hasChange

  // Apple Stocks shows the change as a filled pill: green-fill for up, red-fill
  // for down. The pill is the only color in the entire row — everything else
  // is monochrome.
  const pillClass = neutral
    ? 'bg-stone-100 text-stone-500'
    : up
      ? 'bg-emerald-500 text-white'
      : 'bg-rose-500 text-white'

  return (
    <Link
      href={`/markets/${encodeURIComponent(q.symbol)}`}
      className="group flex items-center gap-3 py-3.5 px-1 first:pt-1.5 last:pb-1.5 border-b border-border/50 last:border-b-0 hover:bg-muted/40 -mx-1 px-2 rounded-md transition-colors"
    >
      {/* Symbol + name */}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold tracking-tight tabular-nums leading-tight">
          {q.symbol}
        </div>
        <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5" title={q.name}>
          {q.name}
        </div>
      </div>

      {/* Sparkline */}
      <Spark data={q.spark} up={up} neutral={neutral} />

      {/* Price + change */}
      <div className="text-right shrink-0 min-w-[88px]">
        <div className="text-[15px] font-semibold tabular-nums leading-tight">
          {fmtPrice(q.price)}
        </div>
        <div
          className={`inline-block mt-0.5 text-[11px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md leading-tight ${pillClass}`}
        >
          {hasChange
            ? `${up ? '+' : ''}${q.change_pct!.toFixed(2)}%`
            : '—'}
        </div>
      </div>
    </Link>
  )
}
