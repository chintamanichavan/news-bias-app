'use client'

import { useMemo, useState } from 'react'

export interface OHLC { t: number; o: number | null; h: number | null; l: number | null; c: number; v: number | null }

interface Props {
  series: OHLC[]
  baseline?: number | null
  intraday?: boolean
  height?: number
}

function fmtDateLabel(t: number, intraday: boolean): string {
  const d = new Date(t * 1000)
  if (intraday) return d.toLocaleTimeString([], { hour: 'numeric', hour12: true })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function PriceChart({ series, baseline, intraday = false, height = 280 }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 800
  const H = height
  const padL = 48
  const padR = 12
  const padT = 12
  const padB = 28

  const data = useMemo(() => series.filter(p => p.c != null), [series])

  if (data.length < 2) {
    return <div className="h-72 flex items-center justify-center text-sm text-muted-foreground">No chart data</div>
  }

  const closes = data.map(p => p.c)
  const min = Math.min(...closes, baseline ?? Infinity)
  const max = Math.max(...closes, baseline ?? -Infinity)
  const range = max - min || 1
  const padded = range * 0.06
  const yMin = min - padded
  const yMax = max + padded
  const yRange = yMax - yMin

  const innerW = W - padL - padR
  const innerH = H - padT - padB
  const x = (i: number) => padL + (i / (data.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH

  const last = data[data.length - 1].c
  const first = data[0].c
  const up = baseline != null ? last >= baseline : last >= first
  const stroke = up ? 'stroke-emerald-500' : 'stroke-rose-500'
  const fill   = up ? 'fill-emerald-500/10' : 'fill-rose-500/10'

  const linePath = data.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${y(yMin).toFixed(1)} L${padL},${y(yMin).toFixed(1)} Z`

  // Y-axis ticks at min, mid, max of actual data
  const ticks = [yMin + padded, (yMin + yMax) / 2, yMax - padded]

  // X-axis labels at 4 evenly spaced positions
  const xLabelIdxs = [0, Math.floor(data.length / 3), Math.floor((2 * data.length) / 3), data.length - 1]

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const fx = (px - padL) / innerW
    const idx = Math.round(fx * (data.length - 1))
    if (idx >= 0 && idx < data.length) setHover(idx)
  }

  const hoverPt = hover != null ? data[hover] : null

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        preserveAspectRatio="none"
      >
        {/* Gridlines + y-axis labels */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL} x2={W - padR}
              y1={y(v)} y2={y(v)}
              className="stroke-border/50" strokeWidth={1} strokeDasharray="3 3"
            />
            <text
              x={padL - 6} y={y(v)}
              className="fill-muted-foreground"
              fontSize={10} textAnchor="end" dominantBaseline="middle"
            >
              {v.toFixed(v >= 100 ? 0 : 2)}
            </text>
          </g>
        ))}

        {/* Baseline (previous close) */}
        {baseline != null && baseline > yMin && baseline < yMax && (
          <line
            x1={padL} x2={W - padR}
            y1={y(baseline)} y2={y(baseline)}
            className="stroke-muted-foreground/40" strokeWidth={1} strokeDasharray="2 4"
          />
        )}

        {/* Area + line */}
        <path d={areaPath} className={fill} />
        <path d={linePath} className={stroke} strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* X-axis labels */}
        {xLabelIdxs.map(i => (
          <text
            key={i}
            x={x(i)} y={H - 8}
            className="fill-muted-foreground"
            fontSize={10} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
          >
            {fmtDateLabel(data[i].t, intraday)}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverPt && (
          <g>
            <line
              x1={x(hover!)} x2={x(hover!)}
              y1={padT} y2={H - padB}
              className="stroke-foreground/30" strokeWidth={1}
            />
            <circle cx={x(hover!)} cy={y(hoverPt.c)} r={3.5} className={up ? 'fill-emerald-500' : 'fill-rose-500'} />
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoverPt && (
        <div className="absolute top-2 right-2 text-xs bg-background/95 border border-border rounded px-2 py-1 shadow-sm tabular-nums">
          <div className="font-medium">{hoverPt.c.toFixed(2)}</div>
          <div className="text-muted-foreground text-[10px]">{fmtDateLabel(hoverPt.t, intraday)}</div>
        </div>
      )}
    </div>
  )
}
