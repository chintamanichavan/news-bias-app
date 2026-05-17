'use client'

import { useMemo } from 'react'

interface Props {
  /** Current cloud cover %, 0..100. */
  current: number
  /** Next 24h: cloud cover %, is_day flag, ISO times. */
  hourly: { cover: number[]; isDay: (0 | 1)[]; times: string[] } | null
}

function classify(cover: number): { label: string; tone: string } {
  if (cover < 12) return { label: 'Clear',         tone: 'text-amber-700 dark:text-amber-400' }
  if (cover < 38) return { label: 'Mostly clear',  tone: 'text-amber-700 dark:text-amber-400' }
  if (cover < 62) return { label: 'Partly cloudy', tone: 'text-sky-700 dark:text-sky-400' }
  if (cover < 88) return { label: 'Mostly cloudy', tone: 'text-slate-700 dark:text-slate-300' }
  return            { label: 'Overcast',           tone: 'text-slate-700 dark:text-slate-300' }
}

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

export default function CloudCard({ current, hourly }: Props) {
  const cls = classify(current)
  const sunHours = useMemo(() => {
    if (!hourly) return null
    // "Sunny" = daytime hour with <= 25% cloud cover
    let n = 0
    for (let i = 0; i < hourly.cover.length; i++) {
      if (hourly.isDay[i] === 1 && hourly.cover[i] <= 25) n++
    }
    return n
  }, [hourly])

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Cloud cover
      </h2>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums leading-none">{Math.round(current)}<span className="text-base font-normal text-muted-foreground">%</span></span>
        <span className={`text-sm font-medium ${cls.tone} ml-auto`}>{cls.label}</span>
      </div>

      {sunHours != null && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          ☀️ {sunHours} sunny hour{sunHours === 1 ? '' : 's'} expected in the next 24h
        </div>
      )}

      {hourly && hourly.cover.length >= 2
        ? <Chart hourly={hourly} />
        : <p className="text-[11px] text-muted-foreground mt-3">Forecast unavailable.</p>
      }
    </div>
  )
}

function Chart({ hourly }: { hourly: NonNullable<Props['hourly']> }) {
  const W = 320
  const H = 100
  const padL = 24
  const padR = 8
  const padT = 8
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const N = Math.min(24, hourly.cover.length)
  const cover = hourly.cover.slice(0, N)
  const isDay = hourly.isDay.slice(0, N)
  const times = hourly.times.slice(0, N)

  const x = (i: number) => padL + (i / (cover.length - 1)) * innerW
  const y = (v: number) => padT + innerH - (v / 100) * innerH

  // Day-band runs (light wash, mirroring HourlyTempCurve idiom)
  const dayBands: { start: number; end: number }[] = []
  let runStart: number | null = null
  isDay.forEach((d, i) => {
    if (d === 1 && runStart === null) runStart = i
    if ((d === 0 || i === isDay.length - 1) && runStart !== null) {
      dayBands.push({ start: runStart, end: d === 1 ? i : i - 1 })
      runStart = null
    }
  })

  const pts = cover.map((v, i) => ({ x: x(i), y: y(v) }))
  const linePath = smoothPath(pts)
  const areaPath = `${linePath} L${x(cover.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`

  const labelIdxs = times.map((_, i) => i).filter(i => i === 0 || i === times.length - 1 || i % 6 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3">
      {/* Daylight wash */}
      {dayBands.map((b, i) => (
        <rect
          key={i}
          x={x(b.start)}
          width={Math.max(0, x(b.end) - x(b.start))}
          y={padT}
          height={innerH}
          fill="#facc15"
          opacity={0.06}
        />
      ))}

      <defs>
        <linearGradient id="cloudArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#475569" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      <path d={areaPath} fill="url(#cloudArea)" />
      <path d={linePath} stroke="#475569" strokeWidth={1.5} fill="none" />
      <circle cx={x(0)} cy={y(cover[0])} r={3.5} fill="#475569" stroke="white" strokeWidth={1.5} />

      {/* y-axis 0/100 */}
      <text x={padL - 4} y={y(100) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">100</text>
      <text x={padL - 4} y={y(0) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">0</text>

      {labelIdxs.map(i => (
        <text
          key={i}
          x={x(i)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle'}
          fontSize={9}
          className="fill-muted-foreground"
        >
          {i === 0 ? 'now' : new Date(times[i]).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}
        </text>
      ))}
    </svg>
  )
}
