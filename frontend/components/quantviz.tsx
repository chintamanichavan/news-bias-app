'use client'

// The platform's chart kit for expanded views — proper axes, gridlines,
// area fills, date ticks, end-point emphasis. Pure SVG, theme-token colors,
// tabular numerals. Every expanded card draws with these instead of naked
// polylines.

import { useWidth } from '@/lib/useWidth'

interface Pt { t: string | number; v: number }
export interface Series {
  label: string
  points: Pt[]
  /** stroke class, e.g. 'stroke-emerald-500' */
  cls: string
  /** optional area fill class, e.g. 'fill-emerald-500/10' */
  fill?: string
  dash?: string
}

function niceTicks(lo: number, hi: number, n = 4): number[] {
  if (hi === lo) return [lo]
  const span = hi - lo
  const step0 = span / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= n + 1) ?? mag * 10
  const start = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let v = start; v <= hi + 1e-9; v += step) out.push(v)
  return out
}

function fmtVal(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`
  if (a >= 100) return v.toFixed(0)
  if (a >= 1) return v.toFixed(2)
  return v.toFixed(3)
}

const LONG_SPAN_MS = 300 * 86_400_000

/** "Oct 17" on a short chart, "Oct 2021" once it spans most of a year or more. */
export function fmtDate(t: string | number, longSpan = false): string {
  const d = new Date(t)
  if (isNaN(d.getTime())) return String(t).slice(5, 10)
  return d.toLocaleDateString([], longSpan ? { month: 'short', year: 'numeric' } : { month: 'short', day: 'numeric' })
}

function spanMs(points: Pt[]): number {
  if (points.length < 2) return 0
  return Math.abs(new Date(points[points.length - 1].t).getTime() - new Date(points[0].t).getTime()) || 0
}

/** Time-series chart with gridlines, y ticks, date ticks, optional zero line
 *  and end-point emphasis on the first series. It draws at its container's
 *  width, one unit per pixel, so text stays the same size in any layout. */
export function TimeSeriesChart(props: {
  series: Series[]; H?: number; zeroLine?: boolean
  yFmt?: (v: number) => string; unit?: string
}) {
  const { ref, width } = useWidth<HTMLDivElement>(760)
  return <div ref={ref}><Chart {...props} W={width} /></div>
}

function Chart({
  series, W, H = 220, zeroLine = false, yFmt, unit = '',
}: {
  series: Series[]; W: number; H?: number; zeroLine?: boolean
  yFmt?: (v: number) => string; unit?: string
}) {
  const PL = 46, PR = 14, PT = 10, PB = 22
  const all = series.flatMap(s => s.points.map(p => p.v))
  if (!all.length) return <p className="text-[12px] text-muted-foreground">no data</p>
  let lo = Math.min(...all), hi = Math.max(...all)
  if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0) }
  if (hi === lo) { hi += 1; lo -= 1 }
  const pad = (hi - lo) * 0.06
  lo -= pad; hi += pad
  const x = (i: number, len: number) => PL + (i / Math.max(1, len - 1)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB)

  const ticks = niceTicks(lo, hi)
  // ticks show only the decimals their spacing needs (40, 60, 80, not
  // 40.00), which also keeps small labels legible; the end label keeps more
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1
  const places = [0, 1, 2, 3, 4].find(d => Math.abs(step * 10 ** d - Math.round(step * 10 ** d)) < 1e-6) ?? 4
  const tickFmt = yFmt ?? ((v: number) => (Math.abs(v) >= 1e4 ? fmtVal(v) : v.toFixed(places)))
  const endFmt = yFmt ?? fmtVal
  const first = series[0]
  const dateIdx = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round((first.points.length - 1) * f))
  const longSpan = spanMs(first.points) > LONG_SPAN_MS

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.label).join(' vs ')}>
      {ticks.map(tv => (
        <g key={tv}>
          <line x1={PL} x2={W - PR} y1={y(tv)} y2={y(tv)} className="stroke-border/70" strokeWidth={0.75} />
          <text x={PL - 5} y={y(tv) + 3} textAnchor="end" fontSize={9.5}
            className="fill-muted-foreground tabular-nums">{tickFmt(tv)}{unit}</text>
        </g>
      ))}
      {zeroLine && lo < 0 && hi > 0 && (
        <line x1={PL} x2={W - PR} y1={y(0)} y2={y(0)} className="stroke-foreground/40" strokeWidth={1} />
      )}
      {Array.from(new Set(dateIdx)).map(i => first.points[i] && (
        <text key={i} x={x(i, first.points.length)} y={H - 6}
          textAnchor={i === 0 ? 'start' : i === first.points.length - 1 ? 'end' : 'middle'}
          fontSize={9.5} className="fill-muted-foreground tabular-nums">
          {fmtDate(first.points[i].t, longSpan)}
        </text>
      ))}
      {series.map((s, si) => {
        if (s.points.length < 2) return null
        const line = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i, s.points.length).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
        const area = s.fill
          ? `${line} L ${x(s.points.length - 1, s.points.length).toFixed(1)} ${y(lo).toFixed(1)} L ${PL} ${y(lo).toFixed(1)} Z`
          : null
        const last = s.points[s.points.length - 1]
        return (
          <g key={si}>
            {area && <path d={area} className={s.fill} stroke="none" />}
            <path d={line} fill="none" strokeWidth={si === 0 ? 1.75 : 1.25} strokeLinecap="round"
              strokeDasharray={s.dash} className={s.cls} />
            {si === 0 && (
              <>
                <circle cx={x(s.points.length - 1, s.points.length)} cy={y(last.v)} r={3}
                  className={s.cls.replace('stroke-', 'fill-')} />
                <text x={Math.min(x(s.points.length - 1, s.points.length) + 5, W - PR)} y={y(last.v) - 5}
                  textAnchor="end" fontSize={10} fontWeight={600}
                  className="fill-foreground tabular-nums">{endFmt(last.v)}{unit}</text>
              </>
            )}
          </g>
        )
      })}
    </svg>
  )
}

export function ChartLegend({ items }: { items: { label: string; cls: string; dash?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[10.5px] text-muted-foreground">
          <svg width="16" height="4"><line x1={0} x2={16} y1={2} y2={2} strokeWidth={2}
            strokeDasharray={i.dash ? '4 3' : undefined} className={i.cls} /></svg>
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Horizontal labeled bars — weights, exposures, importances. */
export function HBarList({
  items, max, unit = '', signed = false,
}: {
  items: { label: string; value: number; sub?: string; href?: string }[]
  max?: number; unit?: string; signed?: boolean
}) {
  if (!items.length) return null
  const m = max ?? Math.max(...items.map(i => Math.abs(i.value)), 1e-9)
  return (
    <div className="space-y-2">
      {items.map(i => {
        const pct = Math.min(100, (Math.abs(i.value) / m) * 100)
        const bar = (
          <>
            <div className="flex items-baseline justify-between text-[12px] tabular-nums">
              <span className="truncate">{i.label}{i.sub && <span className="text-muted-foreground text-[10.5px]"> · {i.sub}</span>}</span>
              <span className={`font-semibold ml-2 shrink-0 ${signed ? (i.value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400') : ''}`}>
                {signed && i.value > 0 ? '+' : ''}{i.value}{unit}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${signed ? (i.value >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70') : 'bg-foreground/50'}`}
                style={{ width: `${pct}%` }} />
            </div>
          </>
        )
        return i.href
          ? <a key={i.label} href={i.href} className="block hover:opacity-75">{bar}</a>
          : <div key={i.label}>{bar}</div>
      })}
    </div>
  )
}

/** A titled section inside an expanded view — the rule, not ad-hoc spacing. */
export function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pt-5 first:pt-0 border-t border-border/60 first:border-0">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">{title}</p>
        {right}
      </div>
      {children}
    </section>
  )
}
