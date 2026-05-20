'use client'

import { useMemo } from 'react'

interface Props {
  /** Current relative humidity, 0–100. */
  currentRh: number
  /** Current dew point, °F (units match the backend's fahrenheit setting). */
  currentDewF: number
  /** 24h forecast of dew point + RH, starting at "now". Both arrays plus ISO times. */
  hourly: { dewF: number[]; rh: number[]; times: string[] } | null
  /** Detail-page mode. */
  expanded?: boolean
}

// Meteorological comfort bands keyed on dew point (°F). Dew point is the
// physically meaningful measure of "stickiness" — unlike RH it doesn't lie at
// different temperatures. Thresholds match the standard NOAA/Iowa State table.
interface Band {
  upTo: number    // dew point upper edge (°F)
  label: string
  meaning: string
  fill: string    // light tailwind bg utility for the chart background band
  text: string    // tailwind text utility for the label chip
}

const BANDS: Band[] = [
  { upTo: 55,  label: 'Dry',        meaning: 'comfortable',         fill: 'fill-emerald-100 dark:fill-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300' },
  { upTo: 60,  label: 'Pleasant',   meaning: 'pleasant',            fill: 'fill-teal-100 dark:fill-teal-950/40',       text: 'text-teal-700 dark:text-teal-300' },
  { upTo: 65,  label: 'Noticeable', meaning: 'noticeable',          fill: 'fill-yellow-100 dark:fill-yellow-950/40',   text: 'text-yellow-700 dark:text-yellow-300' },
  { upTo: 70,  label: 'Sticky',     meaning: 'sticky',              fill: 'fill-amber-100 dark:fill-amber-950/40',     text: 'text-amber-700 dark:text-amber-300' },
  { upTo: 75,  label: 'Oppressive', meaning: 'oppressive',          fill: 'fill-orange-100 dark:fill-orange-950/40',   text: 'text-orange-700 dark:text-orange-300' },
  { upTo: 999, label: 'Tropical',   meaning: 'tropical, miserable', fill: 'fill-red-100 dark:fill-red-950/40',         text: 'text-red-700 dark:text-red-300' },
]

function bandFor(dewF: number): Band {
  for (const b of BANDS) if (dewF < b.upTo) return b
  return BANDS[BANDS.length - 1]
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

export default function HumidityCard({ currentRh, currentDewF, hourly, expanded = false }: Props) {
  const band = bandFor(currentDewF)
  const peak = useMemo(() => {
    if (!hourly?.dewF?.length) return null
    let max = -Infinity, idx = 0
    hourly.dewF.forEach((v, i) => { if (v != null && v > max) { max = v; idx = i } })
    return { value: max, time: hourly.times[idx], band: bandFor(max) }
  }, [hourly])

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Humidity
      </h2>

      <div className="flex items-baseline gap-2">
        <span className={`${expanded ? 'text-6xl' : 'text-3xl'} font-bold tabular-nums leading-none`}>
          {Math.round(currentRh)}<span className={`${expanded ? 'text-2xl' : 'text-base'} font-normal text-muted-foreground`}>%</span>
        </span>
        <span className={`${expanded ? 'text-sm' : 'text-xs'} text-muted-foreground tabular-nums ml-auto`}>
          dew {Math.round(currentDewF)}°
        </span>
      </div>

      <div className={`${expanded ? 'mt-3' : 'mt-1'} flex items-baseline gap-1.5`}>
        <span className={`${expanded ? 'text-base' : 'text-sm'} font-medium ${band.text}`}>{band.label}</span>
        <span className="text-[11px] text-muted-foreground">· {band.meaning}</span>
      </div>

      {hourly && hourly.dewF.length >= 2
        ? <Chart hourly={hourly} expanded={expanded} />
        : <p className="text-[11px] text-muted-foreground mt-3">Forecast unavailable.</p>
      }

      {peak && peak.value > currentDewF + 2 && (
        <p className="text-[10px] text-muted-foreground/90 mt-2">
          Peak dew point today:{' '}
          <span className={`font-medium ${peak.band.text}`}>{Math.round(peak.value)}° ({peak.band.label.toLowerCase()})</span>
          {peak.time && ` around ${new Date(peak.time).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}`}
        </p>
      )}
    </div>
  )
}

function Chart({ hourly, expanded = false }: { hourly: NonNullable<Props['hourly']>; expanded?: boolean }) {
  const W = 320
  const H = expanded ? 240 : 110
  const padL = 26
  const padR = 8
  const padT = 10
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  // Show next 24h
  const N = Math.min(24, hourly.dewF.length)
  const dewF = hourly.dewF.slice(0, N)
  const times = hourly.times.slice(0, N)

  const valid = dewF.filter(v => Number.isFinite(v))
  if (valid.length < 2) return null
  // Y range covers comfort bands the data actually crosses, padded a few °F
  const minDew = Math.min(...valid) - 4
  const maxDew = Math.max(...valid) + 4
  const yLo = Math.max(20, Math.floor(minDew / 5) * 5)
  const yHi = Math.min(85, Math.ceil(maxDew / 5) * 5)
  const yRange = Math.max(10, yHi - yLo)

  const x = (i: number) => padL + (i / (dewF.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yLo) / yRange) * innerH

  // Horizontal comfort bands clipped to visible y-range
  type Strip = { y: number; height: number; fill: string }
  const strips: Strip[] = []
  let bottomDew = yLo
  for (const b of BANDS) {
    const top = Math.min(b.upTo, yHi)
    if (top <= bottomDew) continue
    const yTop = y(top)
    const yBot = y(bottomDew)
    strips.push({ y: yTop, height: Math.max(0, yBot - yTop), fill: b.fill })
    bottomDew = b.upTo
    if (bottomDew >= yHi) break
  }

  const linePts = dewF.map((v, i) => ({ x: x(i), y: y(v) }))
  const linePath = smoothPath(linePts)

  // Y-axis ticks: yLo and yHi only
  const hourLabels = times.map((t, i) => ({ i, t })).filter((_, idx) => idx === 0 || idx === times.length - 1 || idx % 6 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3">
      {/* Comfort band strips */}
      {strips.map((s, i) => (
        <rect key={i} x={padL} y={s.y} width={innerW} height={s.height} className={s.fill} />
      ))}

      {/* Y-axis labels */}
      <text x={padL - 4} y={y(yLo) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{yLo}°</text>
      <text x={padL - 4} y={y(yHi) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{yHi}°</text>

      {/* Dew point line */}
      <path d={linePath} stroke="hsl(220 70% 35%)" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(0)} cy={y(dewF[0])} r={3.5} fill="hsl(220 70% 35%)" stroke="white" strokeWidth={1.5} />

      {/* Hour labels */}
      {hourLabels.map(({ i, t }) => (
        <text
          key={i}
          x={x(i)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === times.length - 1 ? 'end' : 'middle'}
          fontSize={9}
          className="fill-muted-foreground"
        >
          {i === 0 ? 'now' : new Date(t).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}
        </text>
      ))}
    </svg>
  )
}
