'use client'

// A line chart over a numeric x (days, moneyness), drawn at its real width.

import { useWidth } from '@/lib/terminal/useWidth'

export interface XYSeries { label: string; points: { x: number; y: number }[]; cls: string }

const H = 200
const PAD = { l: 44, r: 12, t: 10, b: 24 }

export default function XYChart({ series, xFmt, yFmt }: {
  series: XYSeries[]; xFmt: (x: number) => string; yFmt: (y: number) => string
}) {
  const { ref, width: W } = useWidth<HTMLDivElement>()
  const all = series.flatMap(s => s.points)
  if (all.length < 2) return <p className="text-[12px] text-muted-foreground">Not enough points to draw.</p>
  const [x0, x1] = [Math.min(...all.map(p => p.x)), Math.max(...all.map(p => p.x))]
  const [y0, y1] = [Math.min(...all.map(p => p.y)), Math.max(...all.map(p => p.y))]
  const pad = (y1 - y0) * 0.08 || 0.01
  const lo = y0 - pad, hi = y1 + pad
  const x = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r)
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (H - PAD.t - PAD.b)
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(f => x0 + f * (x1 - x0))
  const yTicks = [lo + pad, (lo + hi) / 2, hi - pad]
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={series.map(s => s.label).join(', ')}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeDasharray="2 4" />
            <text x={4} y={y(v) + 3} className="fill-muted-foreground text-[10px]">{yFmt(v)}</text>
          </g>
        ))}
        {xTicks.map(v => (
          <text key={v} x={x(v)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{xFmt(v)}</text>
        ))}
        {series.map(s => (
          <polyline key={s.label} fill="none" strokeWidth={1.75} className={s.cls}
            points={[...s.points].sort((a, b) => a.x - b.x).map(p => `${x(p.x)},${y(p.y)}`).join(' ')} />
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 text-[11px] text-muted-foreground">
        {series.map(s => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <svg width="16" height="6"><line x1="0" x2="16" y1="3" y2="3" strokeWidth="2" className={s.cls} /></svg>{s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
