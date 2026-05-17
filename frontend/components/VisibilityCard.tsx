'use client'

import { useMemo } from 'react'

interface Props {
  /** Current visibility in METERS (Open-Meteo native unit). */
  currentM: number
  /** Next 24h visibility in meters + ISO times. */
  hourly: { meters: number[]; times: string[] } | null
}

// In the dataset, 10 mi (16093 m) is the typical max; visibility only matters
// when it drops. Bands chosen for human readability rather than aviation/marine
// precision: aviation has stricter cut-offs at 1/4 mi etc., but for a personal
// dashboard "fog vs clear" is enough.
const BANDS = [
  { upToMi: 0.25, label: 'Dense fog', meaning: 'driving dangerous', tone: 'text-rose-700 dark:text-rose-300',     fillCss: 'fill-rose-200/60 dark:fill-rose-900/30' },
  { upToMi: 1,    label: 'Fog',       meaning: 'limited visibility', tone: 'text-orange-700 dark:text-orange-300', fillCss: 'fill-orange-200/50 dark:fill-orange-900/25' },
  { upToMi: 3,    label: 'Mist',      meaning: 'reduced visibility', tone: 'text-amber-700 dark:text-amber-300',   fillCss: 'fill-amber-200/50 dark:fill-amber-900/20' },
  { upToMi: 6,    label: 'Hazy',      meaning: 'slight haze',        tone: 'text-yellow-700 dark:text-yellow-300', fillCss: 'fill-yellow-200/40 dark:fill-yellow-900/15' },
  { upToMi: 999,  label: 'Clear',     meaning: 'wide open',          tone: 'text-emerald-700 dark:text-emerald-300', fillCss: '' },
]

function bandFor(mi: number) {
  for (const b of BANDS) if (mi < b.upToMi) return b
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

function formatMi(mi: number): string {
  if (mi >= 10) return '10+ mi'
  if (mi >= 1)  return `${mi.toFixed(1)} mi`
  return `${(mi * 5280).toFixed(0)} ft`
}

export default function VisibilityCard({ currentM, hourly }: Props) {
  const currentMi = currentM / 1609.34
  const band = bandFor(currentMi)

  // Find any worst window in the next 24h
  const worst = useMemo(() => {
    if (!hourly?.meters?.length) return null
    let worstMi = Infinity, worstIdx = 0
    for (let i = 0; i < hourly.meters.length; i++) {
      const mi = hourly.meters[i] / 1609.34
      if (mi < worstMi) { worstMi = mi; worstIdx = i }
    }
    return { mi: worstMi, time: hourly.times[worstIdx], band: bandFor(worstMi) }
  }, [hourly])

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Visibility
      </h2>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums leading-none">{formatMi(currentMi)}</span>
        <span className={`text-sm font-medium ${band.tone} ml-auto`}>{band.label}</span>
      </div>

      <div className="text-[11px] text-muted-foreground mt-1">{band.meaning}</div>

      {hourly && hourly.meters.length >= 2
        ? <Chart hourly={hourly} />
        : <p className="text-[11px] text-muted-foreground mt-3">Forecast unavailable.</p>
      }

      {worst && worst.mi < 6 && (
        <p className="text-[10px] text-muted-foreground/90 mt-2">
          Lowest in next 24h:{' '}
          <span className={`font-medium ${worst.band.tone}`}>{formatMi(worst.mi)}</span>
          {worst.time && ` near ${new Date(worst.time).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}`}
        </p>
      )}
    </div>
  )
}

function Chart({ hourly }: { hourly: NonNullable<Props['hourly']> }) {
  const W = 320
  const H = 100
  const padL = 26
  const padR = 8
  const padT = 8
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const N = Math.min(24, hourly.meters.length)
  const miles = hourly.meters.slice(0, N).map(m => m / 1609.34)
  const times = hourly.times.slice(0, N)

  // Y range 0..max(11, observed). Most days a flat line near 10; we want low
  // dips to be visually obvious, so anchor 0 at the bottom and cap at 11 mi
  // unless data exceeds that (rare in atmospheric science).
  const yMax = Math.max(11, Math.ceil(Math.max(...miles)))
  const yMin = 0
  const yRange = yMax - yMin

  const x = (i: number) => padL + (i / (miles.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH

  const pts = miles.map((v, i) => ({ x: x(i), y: y(v) }))
  const linePath = smoothPath(pts)
  const areaPath = `${linePath} L${x(miles.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`

  // Horizontal "degraded" band strips beneath the curve so dips into them read at a glance
  const stripDefs = [
    { from: 0,    to: 0.25, css: BANDS[0].fillCss },
    { from: 0.25, to: 1,    css: BANDS[1].fillCss },
    { from: 1,    to: 3,    css: BANDS[2].fillCss },
    { from: 3,    to: 6,    css: BANDS[3].fillCss },
  ]

  const labelIdxs = times.map((_, i) => i).filter(i => i === 0 || i === times.length - 1 || i % 6 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3">
      {/* Degraded strips */}
      {stripDefs.map((s, i) => {
        const yTop = y(Math.min(s.to, yMax))
        const yBot = y(s.from)
        if (yBot <= yTop) return null
        return <rect key={i} x={padL} y={yTop} width={innerW} height={yBot - yTop} className={s.css} />
      })}

      <defs>
        <linearGradient id="visArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#0d9488" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#0d9488" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      <path d={areaPath} fill="url(#visArea)" />
      <path d={linePath} stroke="#0f766e" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(0)} cy={y(miles[0])} r={3.5} fill="#0f766e" stroke="white" strokeWidth={1.5} />

      {/* y labels */}
      <text x={padL - 4} y={y(yMax) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{yMax}mi</text>
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
