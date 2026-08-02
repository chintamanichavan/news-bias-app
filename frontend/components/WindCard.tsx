'use client'

import { useMemo } from 'react'
import { compass } from '@/lib/weather'

interface Props {
  /** Current sustained wind, mph */
  current: number
  /** Current gust, mph */
  gust: number
  /** Direction degrees true */
  direction: number
  /** Day's peak gust forecast, mph */
  dayPeakGust?: number | null
  /** Aligned 24h-from-now slice. If null, the band chart is skipped. */
  hourly?: { sustained: number[]; gusts: number[]; times: string[] } | null
  /** Detail-page mode — bigger compass + taller chart. */
  expanded?: boolean
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

function CompassRose({ direction, sustained, gust, expanded = false }: { direction: number; sustained: number; gust: number; expanded?: boolean }) {
  // Arrow lengths scale with speed, capped at the rose radius. The "scale" of
  // 30 mph = full is a reasonable upper-bound for daily-life conditions; a 50+
  // mph day will still render arrows that fill the rose but won't overflow.
  const R = 56
  const cx = 70
  const cy = 70
  const fullSpeed = 30
  const lenSus = Math.min(R - 8, (Math.max(sustained, 0) / fullSpeed) * (R - 8))
  const lenGust = Math.min(R - 4, (Math.max(gust, 0) / fullSpeed) * (R - 4))

  return (
    <svg viewBox="0 0 140 140" className={expanded ? 'w-52 h-52' : 'w-32 h-32'}>
      {/* Outer ring */}
      <circle cx={cx} cy={cy} r={R} className="stroke-border" strokeWidth={1} fill="none" />
      <circle cx={cx} cy={cy} r={R * 0.66} className="stroke-border/50" strokeWidth={1} fill="none" />
      <circle cx={cx} cy={cy} r={R * 0.33} className="stroke-border/30" strokeWidth={1} fill="none" />

      {/* Cardinals */}
      {(['N', 'E', 'S', 'W'] as const).map((c, i) => {
        const angle = (i * Math.PI) / 2 - Math.PI / 2
        const x = cx + Math.cos(angle) * (R + 6)
        const y = cy + Math.sin(angle) * (R + 6)
        return (
          <text key={c} x={x} y={y + 3.5} textAnchor="middle" fontSize={10} className="fill-muted-foreground font-medium">
            {c}
          </text>
        )
      })}

      {/* Gust arrow — translucent halo behind */}
      <g style={{ transform: `rotate(${direction}deg)`, transformOrigin: `${cx}px ${cy}px` }}>
        <path
          d={`M${cx} ${cy} L${cx - 6} ${cy + 4} L${cx} ${cy - lenGust} L${cx + 6} ${cy + 4} Z`}
          className="fill-sky-400/45"
        />
        <path
          d={`M${cx} ${cy} L${cx - 4} ${cy + 3} L${cx} ${cy - lenSus} L${cx + 4} ${cy + 3} Z`}
          className="fill-foreground/85"
        />
        <circle cx={cx} cy={cy} r={2.5} className="fill-foreground" />
      </g>
    </svg>
  )
}

function BandChart({ data, expanded = false }: { data: NonNullable<Props['hourly']>; expanded?: boolean }) {
  const W = 320
  const H = expanded ? 200 : 80
  const padL = 28
  const padR = 8
  const padT = 6
  const padB = 16
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const all = useMemo(() => [...data.sustained, ...data.gusts].filter(v => Number.isFinite(v)), [data])
  if (all.length < 2) return null
  const yMax = Math.max(20, Math.ceil(Math.max(...all) / 5) * 5)
  const x = (i: number) => padL + (i / (data.sustained.length - 1)) * innerW
  const y = (v: number) => padT + innerH - (v / yMax) * innerH

  const sustainedPts = data.sustained.map((v, i) => ({ x: x(i), y: y(v) }))
  const gustPts = data.gusts.map((v, i) => ({ x: x(i), y: y(v) }))

  // Band area = top edge along gusts, bottom edge back along sustained
  const bandPath = `${smoothPath(gustPts)}` +
    ` L${x(data.gusts.length - 1).toFixed(1)},${y(data.sustained[data.sustained.length - 1]).toFixed(1)}` +
    ` ${smoothPath([...sustainedPts].reverse()).slice(1)} Z`

  const sustainedPath = smoothPath(sustainedPts)
  const gustPath = smoothPath(gustPts)

  // Y-axis ticks at 0, mid, top
  const yTicks = [0, Math.round(yMax / 2), yMax]

  // Hour labels: every 6h
  const hourLabels = data.times.map((t, i) => ({ i, t })).filter((_, idx) => idx === 0 || idx === data.times.length - 1 || idx % 6 === 0)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="windBand" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%"  stopColor="#0ea5e9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Y-axis grid + labels */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} className="stroke-border/40" strokeWidth={0.5} />
          <text x={padL - 4} y={y(v) + 3} textAnchor="end" fontSize={9} className="fill-muted-foreground tabular-nums">{v}</text>
        </g>
      ))}

      {/* Band */}
      <path d={bandPath} fill="url(#windBand)" />
      <path d={gustPath} stroke="#0ea5e9" strokeWidth={1.25} fill="none" strokeDasharray="3 2" opacity={0.75} />
      <path d={sustainedPath} stroke="#0369a1" strokeWidth={1.75} fill="none" />

      {/* Hour labels */}
      {hourLabels.map(({ i, t }) => (
        <text
          key={i}
          x={x(i)}
          y={H - 4}
          textAnchor={i === 0 ? 'start' : i === data.times.length - 1 ? 'end' : 'middle'}
          fontSize={9}
          className="fill-muted-foreground"
        >
          {new Date(t).toLocaleTimeString([], { hour: 'numeric', hour12: true }).replace(' ', '')}
        </text>
      ))}
    </svg>
  )
}

export default function WindCard({ current, gust, direction, dayPeakGust, hourly, expanded = false }: Props) {
  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Wind
      </h2>
      <div className={`flex items-start gap-${expanded ? '6' : '4'}`}>
        <CompassRose direction={direction} sustained={current} gust={gust} expanded={expanded} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className={`${expanded ? 'text-6xl' : 'text-3xl'} font-bold tabular-nums leading-none`}>{Math.round(current)}</span>
            <span className={`${expanded ? 'text-sm' : 'text-xs'} text-muted-foreground uppercase tracking-wider`}>mph · {compass(direction)}</span>
          </div>
          <div className={`${expanded ? 'text-sm mt-2' : 'text-xs mt-0.5'} text-muted-foreground tabular-nums`}>
            gusting {Math.round(gust)} mph
            {dayPeakGust != null && ` · peak today ${Math.round(dayPeakGust)}`}
          </div>
          <div className={`${expanded ? 'mt-4' : 'mt-3'} flex items-center gap-3 text-[10px] text-muted-foreground`}>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-[#0369a1]" /> sustained
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-0.5 bg-sky-500 opacity-75" style={{ borderTop: '1px dashed #0ea5e9' }} /> gusts
            </span>
          </div>
        </div>
      </div>

      {hourly && hourly.sustained.length >= 2 && (
        <div className={`${expanded ? 'mt-6' : 'mt-3'} -mx-1`}>
          <BandChart data={hourly} expanded={expanded} />
        </div>
      )}
    </div>
  )
}
