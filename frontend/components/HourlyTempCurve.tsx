'use client'

import { useMemo, useState } from 'react'
import { describeWeather } from '@/lib/weather'

interface HourPoint {
  time: string
  temperature_2m: number
  precipitation_probability: number
  weather_code: number
  is_day: 0 | 1
}

interface Props {
  points: HourPoint[]   // exactly the next 24 hours from "now"
}

function fmtHour(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')
}

// Smooth path via Catmull-Rom → cubic Beziers, simplified.
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return ''
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

export default function HourlyTempCurve({ points }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 800
  const H = 200
  const padL = 32
  const padR = 16
  const padT = 28
  const padB = 56  // room for precip bars + hour labels
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const data = useMemo(() => points.slice(0, 24), [points])
  if (data.length < 2) return <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No hourly data</div>

  const temps = data.map(p => p.temperature_2m)
  const tMin = Math.min(...temps)
  const tMax = Math.max(...temps)
  const range = (tMax - tMin) || 1
  const padded = range * 0.15
  const yMin = tMin - padded
  const yMax = tMax + padded
  const yRange = yMax - yMin

  const x = (i: number) => padL + (i / (data.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH

  const tempPts = data.map((p, i) => ({ x: x(i), y: y(p.temperature_2m) }))
  const linePath = smoothPath(tempPts)
  const areaPath = `${linePath} L${x(data.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`

  // High/low markers
  const hiIdx = temps.indexOf(tMax)
  const loIdx = temps.indexOf(tMin)

  // Hour labels: every 3 hours
  const labelIdxs = data.map((_, i) => i).filter(i => i === 0 || i === data.length - 1 || i % 3 === 0)

  // Day/night band — find runs of is_day=1
  const dayBands: { start: number; end: number }[] = []
  let runStart: number | null = null
  data.forEach((p, i) => {
    if (p.is_day === 1 && runStart === null) runStart = i
    if ((p.is_day === 0 || i === data.length - 1) && runStart !== null) {
      dayBands.push({ start: runStart, end: p.is_day === 1 ? i : i - 1 })
      runStart = null
    }
  })

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
      >
        <defs>
          <linearGradient id="tempArea" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="hsl(var(--primary))" stopOpacity="0.3" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Day-band background */}
        {dayBands.map((b, i) => (
          <rect
            key={i}
            x={x(b.start)}
            width={x(b.end) - x(b.start)}
            y={padT}
            height={innerH + 22}
            fill="hsl(var(--primary))"
            opacity={0.04}
          />
        ))}

        {/* Temp area + line */}
        <path d={areaPath} fill="url(#tempArea)" />
        <path d={linePath} stroke="hsl(var(--primary))" strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />

        {/* High/low markers */}
        <circle cx={x(hiIdx)} cy={y(tMax)} r={3.5} fill="hsl(var(--primary))" />
        <text x={x(hiIdx)} y={y(tMax) - 7} textAnchor="middle" fontSize={11} className="fill-foreground font-semibold tabular-nums">
          {Math.round(tMax)}°
        </text>
        <circle cx={x(loIdx)} cy={y(tMin)} r={3.5} fill="hsl(var(--primary))" opacity="0.5" />
        <text x={x(loIdx)} y={y(tMin) + 14} textAnchor="middle" fontSize={11} className="fill-muted-foreground tabular-nums">
          {Math.round(tMin)}°
        </text>

        {/* Precipitation probability bars */}
        {data.map((p, i) => {
          const pop = p.precipitation_probability
          if (pop <= 0) return null
          const barH = (pop / 100) * 22
          return (
            <rect
              key={i}
              x={x(i) - innerW / data.length / 2 + 1}
              y={padT + innerH + 4 + (22 - barH)}
              width={innerW / data.length - 2}
              height={barH}
              fill="#0ea5e9"
              opacity={0.35 + (pop / 200)}
              rx={1}
            />
          )
        })}

        {/* Hour labels */}
        {labelIdxs.map(i => (
          <text
            key={i}
            x={x(i)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            className="fill-muted-foreground"
          >
            {fmtHour(data[i].time)}
          </text>
        ))}

        {/* Hover crosshair */}
        {hoverPt && (
          <g>
            <line x1={x(hover!)} x2={x(hover!)} y1={padT} y2={padT + innerH + 26} className="stroke-foreground/30" strokeWidth={1} />
            <circle cx={x(hover!)} cy={y(hoverPt.temperature_2m)} r={4} fill="hsl(var(--primary))" stroke="white" strokeWidth={1.5} />
          </g>
        )}
      </svg>

      {/* Hover tooltip */}
      {hoverPt && (
        <div className="absolute top-1 right-1 text-xs bg-background/95 border border-border rounded px-2 py-1 shadow-sm">
          <div className="font-medium tabular-nums">{Math.round(hoverPt.temperature_2m)}° · {describeWeather(hoverPt.weather_code).label}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">
            {fmtHour(hoverPt.time)} · {hoverPt.precipitation_probability}% precip
          </div>
        </div>
      )}
    </div>
  )
}
