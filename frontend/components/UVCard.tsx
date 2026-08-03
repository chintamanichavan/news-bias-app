'use client'

import { useMemo } from 'react'

interface Props {
  /** Current UV index. */
  current: number
  /** Next 24h UV index + ISO times. */
  hourly: { uv: number[]; times: string[] } | null
  /** Detail-page mode. */
  expanded?: boolean
}

// WHO / EPA UV-index risk bands.
interface Band {
  upTo: number
  label: string
  tone: string         // text utility
  fill: string         // SVG fill class for background strip
  meaning: string
}

const BANDS: Band[] = [
  { upTo: 3,   label: 'Low',       tone: 'text-[var(--ink-emerald)] dark:text-emerald-300', fill: 'fill-emerald-200/40 dark:fill-[var(--ink-emerald)]/25', meaning: 'no protection needed' },
  { upTo: 6,   label: 'Moderate',  tone: 'text-[var(--ink-yellow)] dark:text-yellow-300',   fill: 'fill-yellow-200/40 dark:fill-[var(--ink-yellow)]/25',   meaning: 'SPF 30, hat' },
  { upTo: 8,   label: 'High',      tone: 'text-[var(--ink-orange)] dark:text-orange-300',   fill: 'fill-orange-200/45 dark:fill-[var(--ink-orange)]/30',   meaning: 'avoid midday sun' },
  { upTo: 11,  label: 'Very high', tone: 'text-[var(--ink-rose)] dark:text-rose-300',       fill: 'fill-rose-200/45 dark:fill-[var(--ink-rose)]/30',       meaning: 'minimize exposure' },
  { upTo: 999, label: 'Extreme',   tone: 'text-[var(--ink-purple)] dark:text-purple-300',   fill: 'fill-purple-200/45 dark:fill-[var(--ink-purple)]/30',   meaning: 'stay indoors' },
]

function bandFor(uv: number): Band {
  for (const b of BANDS) if (uv < b.upTo) return b
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

export default function UVCard({ current, hourly, expanded = false }: Props) {
  const band = bandFor(current)

  const peak = useMemo(() => {
    if (!hourly?.uv?.length) return null
    let max = -Infinity, idx = 0
    hourly.uv.forEach((v, i) => { if (v != null && v > max) { max = v; idx = i } })
    if (max <= 0) return null
    return { value: max, time: hourly.times[idx], band: bandFor(max) }
  }, [hourly])

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        UV index
      </h2>

      <div className="flex items-baseline gap-2">
        <span className={`${expanded ? 'text-6xl' : 'text-3xl'} font-bold tabular-nums leading-none`}>{current.toFixed(1)}</span>
        <span className={`${expanded ? 'text-base' : 'text-sm'} font-medium ${band.tone} ml-auto`}>{band.label}</span>
      </div>

      <div className={`${expanded ? 'text-sm mt-2' : 'text-[11px] mt-1'} text-muted-foreground`}>{band.meaning}</div>

      {hourly && hourly.uv.length >= 2
        ? <Chart hourly={hourly} expanded={expanded} />
        : <p className="text-[11px] text-muted-foreground mt-3">Forecast unavailable.</p>
      }

      {peak && peak.value > current + 1 && (
        <p className="text-[10px] text-muted-foreground/90 mt-2">
          Peak today:{' '}
          <span className={`font-medium ${peak.band.tone}`}>{peak.value.toFixed(1)} ({peak.band.label.toLowerCase()})</span>
          {peak.time && ` near ${new Date(peak.time).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}`}
        </p>
      )}
    </div>
  )
}

function Chart({ hourly, expanded = false }: { hourly: NonNullable<Props['hourly']>; expanded?: boolean }) {
  const W = 320
  const H = expanded ? 220 : 100
  const padL = 24
  const padR = 8
  const padT = 8
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const N = Math.min(24, hourly.uv.length)
  const uv = hourly.uv.slice(0, N)
  const times = hourly.times.slice(0, N)

  // Y range 0..max(11, observed peak rounded up); UV index above 11 = "Extreme"
  // but in mid-latitudes you rarely see > 11. Anchor at 11 so the chart shape
  // is comparable day-to-day.
  const yMax = Math.max(11, Math.ceil(Math.max(...uv)))
  const yRange = yMax

  const x = (i: number) => padL + (i / (uv.length - 1)) * innerW
  const y = (v: number) => padT + innerH - (v / yRange) * innerH

  // Risk-band horizontal strips
  const strips: { yTop: number; yBot: number; cls: string }[] = []
  let bottomUv = 0
  for (const b of BANDS) {
    const top = Math.min(b.upTo, yMax)
    if (top <= bottomUv) continue
    strips.push({ yTop: y(top), yBot: y(bottomUv), cls: b.fill })
    bottomUv = b.upTo
    if (bottomUv >= yMax) break
  }

  const pts = uv.map((v, i) => ({ x: x(i), y: y(v) }))
  const linePath = smoothPath(pts)

  const labelIdxs = times.map((_, i) => i).filter(i => i === 0 || i === times.length - 1 || i % 6 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-3">
      {strips.map((s, i) => (
        <rect key={i} x={padL} y={s.yTop} width={innerW} height={Math.max(0, s.yBot - s.yTop)} className={s.cls} />
      ))}

      <path d={linePath} stroke="#b45309" strokeWidth={1.75} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(0)} cy={y(uv[0])} r={3.5} fill="#b45309" stroke="white" strokeWidth={1.5} />

      <text x={padL - 4} y={y(yMax) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{yMax}</text>
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
