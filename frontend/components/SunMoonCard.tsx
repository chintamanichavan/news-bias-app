'use client'

import { useMemo } from 'react'
import { moonPhase } from '@/lib/weather'

interface Props {
  /** Today's sunrise + sunset, plus tomorrow's for the day-length delta. */
  sunriseToday: string
  sunsetToday: string
  sunriseTomorrow?: string | null
  sunsetTomorrow?: string | null
  /** Current ISO time (used for sun position on the arc + daylight-left math). */
  now: string
  /** Detail-page mode. */
  expanded?: boolean
}

function parseLocal(iso: string): Date {
  // Open-Meteo returns local-timezone-naive ISO ("2026-05-17T05:32"). new Date()
  // treats those as local — correct for the user's TZ since timezone=auto.
  return new Date(iso)
}

function fmtClock(iso: string): string {
  const d = parseLocal(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDuration(ms: number): string {
  if (ms <= 0) return '0m'
  const totalMin = Math.round(ms / 60_000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

function fmtSignedMin(ms: number): string {
  const m = Math.round(ms / 60_000)
  if (m === 0) return 'same as tomorrow'
  const sign = m > 0 ? '+' : '−'
  return `${sign}${Math.abs(m)} min vs tomorrow`
}

interface SunGeom {
  cx: number; cy: number; r: number
  start: { x: number; y: number }
  end: { x: number; y: number }
  arcPath: string
  pos: { x: number; y: number } | null  // sun position on arc; null = below horizon
  fraction: number  // 0 at sunrise, 1 at sunset; clamped
  isDay: boolean
}

function arcGeometry(now: Date, sr: Date, ss: Date): SunGeom {
  const W = 280
  const H = 110
  const cx = W / 2
  const cy = H - 14
  const r = (W - 30) / 2
  const start = { x: cx - r, y: cy }
  const end = { x: cx + r, y: cy }
  const arcPath = `M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${end.x} ${end.y}`

  const dayMs = ss.getTime() - sr.getTime()
  let fraction = (now.getTime() - sr.getTime()) / Math.max(1, dayMs)
  const isDay = fraction >= 0 && fraction <= 1
  fraction = Math.max(0, Math.min(1, fraction))

  // 0 → π along the upper semicircle
  const theta = Math.PI - fraction * Math.PI
  const pos = isDay
    ? { x: cx + r * Math.cos(theta), y: cy - r * Math.sin(theta) }
    : null

  return { cx, cy, r, start, end, arcPath, pos, fraction, isDay }
}

function MoonGlyph({ phase, illumination }: { phase: number; illumination: number }) {
  // Simple SVG moon: light disk with a darker overlay placed so a fraction of
  // the disc is lit. phase: 0=new, 0.25=first quarter, 0.5=full, 0.75=last quarter.
  const size = 36
  const r = 16
  const cx = size / 2
  const cy = size / 2
  // Terminator x-offset, scaled by phase
  // At phase 0 (new): terminator covers entire disc — fully dark
  // At phase 0.5 (full): no terminator — fully lit
  // We render the lit disc, then a dark ellipse for the terminator shape
  const lit = illumination / 100  // 0..1
  const waxing = phase < 0.5
  // Ellipse rx controls "curvature" of the terminator
  const rx = r * Math.abs(Math.cos(phase * 2 * Math.PI))
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-9 h-9 shrink-0">
      <defs>
        <clipPath id="moonClip"><circle cx={cx} cy={cy} r={r} /></clipPath>
      </defs>
      {/* Dark base disc (the unlit moon body) */}
      <circle cx={cx} cy={cy} r={r} className="fill-stone-300" />
      {/* Lit portion */}
      <g clipPath="url(#moonClip)">
        {lit > 0.99 ? (
          <circle cx={cx} cy={cy} r={r} className="fill-yellow-100" />
        ) : lit < 0.01 ? null : waxing ? (
          // Waxing: right half lit, left ellipse carves into it
          <>
            <rect x={cx} y={cy - r} width={r + 1} height={2 * r} className="fill-yellow-100" />
            <ellipse cx={cx} cy={cy} rx={rx} ry={r} className={phase < 0.25 ? 'fill-stone-300' : 'fill-yellow-100'} />
          </>
        ) : (
          // Waning: left half lit
          <>
            <rect x={cx - r - 1} y={cy - r} width={r + 1} height={2 * r} className="fill-yellow-100" />
            <ellipse cx={cx} cy={cy} rx={rx} ry={r} className={phase < 0.75 ? 'fill-yellow-100' : 'fill-stone-300'} />
          </>
        )}
      </g>
      {/* Outline */}
      <circle cx={cx} cy={cy} r={r} fill="none" className="stroke-stone-400/60" strokeWidth={0.75} />
    </svg>
  )
}

export default function SunMoonCard({
  sunriseToday, sunsetToday, sunriseTomorrow, sunsetTomorrow, now, expanded = false,
}: Props) {
  const sr = parseLocal(sunriseToday)
  const ss = parseLocal(sunsetToday)
  const today = parseLocal(now)
  const geom = useMemo(() => arcGeometry(today, sr, ss), [today.getTime(), sr.getTime(), ss.getTime()])

  const dayLengthMs = ss.getTime() - sr.getTime()
  const dayLengthLabel = fmtDuration(dayLengthMs)

  let trendLabel: string | null = null
  if (sunriseTomorrow && sunsetTomorrow) {
    const tomorrowMs = parseLocal(sunsetTomorrow).getTime() - parseLocal(sunriseTomorrow).getTime()
    trendLabel = fmtSignedMin(dayLengthMs - tomorrowMs)
  }

  let timeRemainingLabel: string | null = null
  if (today.getTime() < sr.getTime()) {
    timeRemainingLabel = `Sunrise in ${fmtDuration(sr.getTime() - today.getTime())}`
  } else if (today.getTime() < ss.getTime()) {
    timeRemainingLabel = `${fmtDuration(ss.getTime() - today.getTime())} of daylight left`
  } else {
    // After sunset — show next sunrise if available
    if (sunriseTomorrow) {
      timeRemainingLabel = `Sunrise in ${fmtDuration(parseLocal(sunriseTomorrow).getTime() - today.getTime())}`
    }
  }

  const moon = moonPhase(today)

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Sun &amp; Moon
      </h2>

      {/* Sun arc */}
      <div className="relative">
        <svg viewBox="0 0 280 120" preserveAspectRatio="xMidYMid meet" className={`w-full ${expanded ? 'aspect-[2/1] max-h-[280px]' : 'h-auto'}`}>
          <defs>
            <linearGradient id="sunArcGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"  stopColor="#fbbf24" stopOpacity="0.55" />
              <stop offset="80%" stopColor="#fbbf24" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="sunArcStroke" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%"  stopColor="#f59e0b" />
              <stop offset="50%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f97316" />
            </linearGradient>
          </defs>

          {/* Horizon line */}
          <line x1={geom.start.x - 8} x2={geom.end.x + 8} y1={geom.cy} y2={geom.cy} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />

          {/* Filled area beneath the arc (day "dome") */}
          <path d={`${geom.arcPath} L ${geom.end.x} ${geom.cy} L ${geom.start.x} ${geom.cy} Z`} fill="url(#sunArcGradient)" />

          {/* Arc */}
          <path d={geom.arcPath} fill="none" stroke="url(#sunArcStroke)" strokeWidth={2} strokeLinecap="round" />

          {/* Sun position */}
          {geom.pos && (
            <>
              <circle cx={geom.pos.x} cy={geom.pos.y} r={6.5} fill="#fbbf24" stroke="white" strokeWidth={2} />
              <circle cx={geom.pos.x} cy={geom.pos.y} r={11} fill="#fbbf24" opacity={0.25} />
            </>
          )}

          {/* Sunrise + sunset times */}
          <text x={geom.start.x} y={geom.cy + 14} textAnchor="start" fontSize={10} className="fill-muted-foreground tabular-nums">
            {fmtClock(sunriseToday)}
          </text>
          <text x={geom.end.x} y={geom.cy + 14} textAnchor="end" fontSize={10} className="fill-muted-foreground tabular-nums">
            {fmtClock(sunsetToday)}
          </text>
        </svg>
      </div>

      {/* Daylight stats */}
      <div className={`${expanded ? 'mt-4' : 'mt-2'} grid grid-cols-2 gap-2 ${expanded ? 'text-sm' : 'text-[11px]'}`}>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Day length</div>
          <div className={`${expanded ? 'text-2xl' : 'text-sm'} font-semibold tabular-nums`}>{dayLengthLabel}</div>
        </div>
        <div className="text-right">
          {timeRemainingLabel && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{geom.isDay ? 'Remaining' : 'Next'}</div>
              <div className={`${expanded ? 'text-2xl' : 'text-sm'} font-semibold tabular-nums`}>{timeRemainingLabel.replace(/^Sunrise in /, '').replace(/ of daylight left$/, '')}</div>
            </>
          )}
        </div>
      </div>
      {trendLabel && (
        <div className={`${expanded ? 'mt-2 text-xs' : 'mt-1 text-[10px]'} text-muted-foreground/90`}>{trendLabel}</div>
      )}

      {/* Moon */}
      <div className={`${expanded ? 'mt-6 pt-4' : 'mt-4 pt-3'} border-t border-border/60 flex items-center ${expanded ? 'gap-5' : 'gap-3'}`}>
        <div className={expanded ? 'scale-[2] origin-left ml-3' : ''}>
          <MoonGlyph phase={moon.phase} illumination={moon.illumination} />
        </div>
        <div className={`min-w-0 ${expanded ? 'ml-12' : ''}`}>
          <div className={`${expanded ? 'text-xl' : 'text-sm'} font-semibold leading-tight`}>{moon.name}</div>
          <div className={`${expanded ? 'text-sm mt-1' : 'text-[11px]'} text-muted-foreground tabular-nums`}>{moon.illumination}% illuminated</div>
        </div>
      </div>
    </div>
  )
}
