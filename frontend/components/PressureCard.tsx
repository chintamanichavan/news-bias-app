'use client'

import { useMemo } from 'react'

interface Props {
  /** Current pressure in hPa (MSL). */
  current: number
  /** Pre-computed 3-hour tendency (hPa change over last 3 hours). null if unknown. */
  trend3h: number | null
  /** 24-48h MSL pressure forecast starting at "now" plus matching ISO times. */
  series: { values: number[]; times: string[] } | null
  /** Detail-page mode — taller chart, bigger headline number. */
  expanded?: boolean
}

// Meteorological norms (hPa):
//   ~1013 hPa = standard sea-level pressure (ICAO ISA).
//   ±2 hPa over 3 hours is the conventional threshold separating "rising/
//   falling fast" from "steady". We classify using the slope across the last
//   3 hours of the series (the most recent observations available).
const REFERENCE_HPA = 1013.25

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

interface Trend {
  rate: number          // hPa per 3 hours
  label: string         // "Rising fast", "Steady", ...
  emoji: string
  color: string         // tailwind text utility
  meaning: string       // short interpretation
}

function classifyTrend(rate: number | null): Trend | null {
  if (rate == null || !Number.isFinite(rate)) return null
  if (rate >= 2)    return { rate, label: 'Rising fast',  emoji: '⤴︎', color: 'text-[var(--ink-emerald)] dark:text-emerald-400', meaning: 'clearing soon' }
  if (rate >= 0.5)  return { rate, label: 'Rising',       emoji: '↗︎', color: 'text-[var(--ink-emerald)] dark:text-emerald-400', meaning: 'improving' }
  if (rate <= -2)   return { rate, label: 'Falling fast', emoji: '⤵︎', color: 'text-[var(--ink-rose)] dark:text-rose-400',       meaning: 'storm possible' }
  if (rate <= -0.5) return { rate, label: 'Falling',      emoji: '↘︎', color: 'text-[var(--ink-rose)] dark:text-rose-400',       meaning: 'weather may worsen' }
  return                { rate, label: 'Steady',          emoji: '→',  color: 'text-muted-foreground',                  meaning: 'stable conditions' }
}

export default function PressureCard({ current, trend3h, series, expanded = false }: Props) {
  const trend = useMemo(() => classifyTrend(trend3h), [trend3h])

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Pressure
      </h2>

      <div className="flex items-baseline gap-2">
        <span className={`${expanded ? 'text-6xl' : 'text-3xl'} font-bold tabular-nums leading-none`}>{Math.round(current)}</span>
        <span className={`${expanded ? 'text-base' : 'text-xs'} text-muted-foreground uppercase tracking-wider`}>hPa</span>
        <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
          vs ISA {((current - REFERENCE_HPA) > 0 ? '+' : '')}{(current - REFERENCE_HPA).toFixed(1)}
        </span>
      </div>

      {trend && (
        <div className={`${expanded ? 'mt-3' : 'mt-1'} flex items-baseline gap-1.5`}>
          <span className={`${expanded ? 'text-base' : 'text-sm'} font-medium ${trend.color}`}>
            {trend.emoji} {trend.label}
          </span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {trend.rate > 0 ? '+' : ''}{trend.rate.toFixed(1)} hPa / 3h · {trend.meaning}
          </span>
        </div>
      )}

      {series && series.values.length >= 2
        ? <Chart series={series} expanded={expanded} />
        : <p className="text-[11px] text-muted-foreground mt-3">Trend forecast unavailable.</p>
      }
    </div>
  )
}

function Chart({ series, expanded = false }: { series: NonNullable<Props['series']>; expanded?: boolean }) {
  const W = 320
  const H = expanded ? 240 : 110
  const padL = 30
  const padR = 8
  const padT = 14
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const window = useMemo(() => {
    const N = Math.min(36, series.values.length)
    return {
      values: series.values.slice(0, N),
      times:  series.times.slice(0, N),
    }
  }, [series])

  const valid = window.values.filter(v => Number.isFinite(v))
  if (valid.length < 2) return null
  const minV = Math.min(...valid)
  const maxV = Math.max(...valid)
  // Pad y-range so a flat-ish trend still occupies most of the height
  const padY = Math.max(1, (maxV - minV) * 0.25)
  const yMin = Math.min(minV - padY, REFERENCE_HPA - 1)
  const yMax = Math.max(maxV + padY, REFERENCE_HPA + 1)
  const yRange = yMax - yMin

  const x = (i: number) => padL + (i / (window.values.length - 1)) * innerW
  const y = (v: number) => padT + innerH - ((v - yMin) / yRange) * innerH

  const linePts = window.values.map((v, i) => ({ x: x(i), y: y(v) }))
  const linePath = smoothPath(linePts)
  const areaPath = `${linePath} L${x(window.values.length - 1).toFixed(1)},${(padT + innerH).toFixed(1)} L${padL},${(padT + innerH).toFixed(1)} Z`

  const refY = y(REFERENCE_HPA)
  // Hour labels: every 12h plus endpoints
  const labelIdxs = window.times.map((_, i) => i).filter(i => i === 0 || i === window.times.length - 1 || i % 12 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3">
      <defs>
        <linearGradient id="pressureArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#8b5cf6" stopOpacity="0.30" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.04" />
        </linearGradient>
      </defs>

      {/* ISA reference line (dashed) */}
      {refY > padT && refY < padT + innerH && (
        <>
          <line
            x1={padL} x2={W - padR}
            y1={refY} y2={refY}
            className="stroke-muted-foreground/40"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={W - padR}
            y={refY - 3}
            textAnchor="end"
            fontSize={9}
            className="fill-muted-foreground"
          >
            1013 (ISA)
          </text>
        </>
      )}

      {/* Y-axis: min and max only */}
      <text x={padL - 4} y={y(maxV) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{Math.round(maxV)}</text>
      <text x={padL - 4} y={y(minV) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{Math.round(minV)}</text>

      {/* Area + line */}
      <path d={areaPath} fill="url(#pressureArea)" />
      <path d={linePath} stroke="#7c3aed" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />

      {/* "Now" marker at index 0 */}
      <circle cx={x(0)} cy={y(window.values[0])} r={3.5} fill="#7c3aed" stroke="white" strokeWidth={1.5} />

      {/* Hour labels */}
      {labelIdxs.map(i => (
        <text
          key={i}
          x={x(i)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === window.times.length - 1 ? 'end' : 'middle'}
          fontSize={9}
          className="fill-muted-foreground"
        >
          {i === 0 ? 'now' : new Date(window.times[i]).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}
        </text>
      ))}
    </svg>
  )
}
