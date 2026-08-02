'use client'

import { useState } from 'react'

interface Props {
  daily: { bucket: string; count: number }[]
  byHour: { hour: number; count: number }[]
  /** by-hour buckets cover this window, not the whole corpus. */
  trendDays: number
}

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function CadenceChart({ daily, byHour, trendDays }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  if (daily.length < 2) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        Not enough days of history to plot a trend yet.
      </p>
    )
  }

  const W = 800
  const H = 200
  const padL = 34
  const padR = 8
  const padT = 10
  const padB = 24
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const max = Math.max(1, ...daily.map(d => d.count))
  const x = (i: number) => padL + (i / (daily.length - 1)) * innerW
  const y = (v: number) => padT + innerH - (v / max) * innerH

  const line = daily.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(' ')
  const area = `${line} L${x(daily.length - 1).toFixed(1)},${y(0).toFixed(1)} L${padL},${y(0).toFixed(1)} Z`

  const ticks = [0, Math.round(max / 2), max]
  const labelIdxs = [0, Math.floor(daily.length / 2), daily.length - 1]

  const hourMax = Math.max(1, ...byHour.map(h => h.count))
  const peakHour = byHour.reduce((a, b) => (b.count > a.count ? b : a), byHour[0])

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.round(((px - padL) / innerW) * (daily.length - 1))
    setHover(idx >= 0 && idx < daily.length ? idx : null)
  }

  const pt = hover != null ? daily[hover] : null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-6">
      {/* ── Daily volume ── */}
      <div className="relative">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-2">
          Articles per day
        </p>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full h-auto block"
          preserveAspectRatio="none"
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map(v => (
            <g key={v}>
              <line
                x1={padL} x2={W - padR} y1={y(v)} y2={y(v)}
                stroke="var(--viz-grid)" strokeWidth={1} strokeDasharray="3 3"
              />
              <text
                x={padL - 6} y={y(v)} fontSize={10} textAnchor="end" dominantBaseline="middle"
                className="fill-muted-foreground"
              >
                {v}
              </text>
            </g>
          ))}

          <path d={area} fill="var(--viz-magnitude)" opacity={0.12} />
          <path
            d={line}
            fill="none"
            stroke="var(--viz-magnitude)"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />

          {labelIdxs.map(i => (
            <text
              key={i}
              x={x(i)} y={H - 6} fontSize={10}
              textAnchor={i === 0 ? 'start' : i === daily.length - 1 ? 'end' : 'middle'}
              className="fill-muted-foreground"
            >
              {dayLabel(daily[i].bucket)}
            </text>
          ))}

          {pt && (
            <g>
              <line
                x1={x(hover!)} x2={x(hover!)} y1={padT} y2={padT + innerH}
                stroke="currentColor" strokeWidth={1} className="text-foreground/30"
                vectorEffect="non-scaling-stroke"
              />
              <circle
                cx={x(hover!)} cy={y(pt.count)} r={4}
                fill="var(--viz-magnitude)" stroke="hsl(var(--card))" strokeWidth={2}
              />
            </g>
          )}
        </svg>

        {pt && (
          <div className="absolute top-6 right-0 text-[11px] bg-background/95 border border-border rounded-md px-2 py-1 shadow-sm tabular-nums pointer-events-none">
            <span className="font-semibold">{pt.count}</span>
            <span className="text-muted-foreground"> on {dayLabel(pt.bucket)}</span>
          </div>
        )}
      </div>

      {/* ── Hour-of-day profile ── */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-2">
          By hour published (UTC) · last {trendDays}d
        </p>
        <div className="flex items-end gap-[2px] h-[164px]">
          {byHour.map(h => (
            <div
              key={h.hour}
              className="flex-1 rounded-t-[2px] min-w-0"
              style={{
                height: `${Math.max(h.count > 0 ? 2 : 0.5, (h.count / hourMax) * 100)}%`,
                background: h.hour === peakHour.hour ? 'var(--viz-magnitude)' : 'var(--viz-grid)',
              }}
              title={`${String(h.hour).padStart(2, '0')}:00 — ${h.count} articles`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground tabular-nums">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
        </div>
        <p className="mt-2.5 text-[12px] text-muted-foreground leading-relaxed">
          Publishing peaks at{' '}
          <strong className="font-semibold text-foreground tabular-nums">
            {String(peakHour.hour).padStart(2, '0')}:00
          </strong>{' '}
          with {peakHour.count.toLocaleString()} articles over the last {trendDays} days.
        </p>
      </div>
    </div>
  )
}
