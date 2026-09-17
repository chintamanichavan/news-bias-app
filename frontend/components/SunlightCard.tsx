'use client'

// Lumy-style daylight planner: a 24h band of twilight/golden/blue-hour light
// phases, a time-travel slider with live sun altitude + compass azimuth, and
// season info. All astronomy is computed on-device (lib/astro).

import { useMemo, useState } from 'react'
import { sunEvents, sunPosition, seasonInfo } from '@/lib/astro'
import { compass } from '@/lib/weather'

interface Props {
  lat: number
  lon: number
  now: string  // local-naive ISO from Open-Meteo
}

function fmtClock(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function minsOf(d: Date): number { return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 }

/** Fraction of the 24h band (0 at midnight) for a Date, clamped to today. */
function frac(d: Date | null, fallback: number): number {
  if (!d) return fallback
  return Math.max(0, Math.min(1, minsOf(d) / 1440))
}

const BAND = {
  night:    '#101736',
  astro:    '#1c2a52',
  nautical: '#2c4374',
  blue:     '#3d5fa3',
  golden:   '#f0a63c',
  day:      '#79c4f2',
}

export default function SunlightCard({ lat, lon, now }: Props) {
  const nowDate = useMemo(() => new Date(now), [now])
  const ev = useMemo(() => sunEvents(nowDate, lat, lon), [nowDate, lat, lon])
  const season = useMemo(() => seasonInfo(nowDate, lat), [nowDate, lat])

  // Time-travel slider, in minutes since midnight. Defaults to now.
  const [travelMin, setTravelMin] = useState<number | null>(null)
  const cursorMin = travelMin ?? minsOf(nowDate)
  const cursorDate = useMemo(() => {
    const d = new Date(nowDate)
    d.setHours(0, Math.round(cursorMin), 0, 0)
    return d
  }, [nowDate, cursorMin])
  const pos = sunPosition(cursorDate, lat, lon)

  // Band segments, morning → evening. Each phase runs to the next boundary.
  const segments: { from: number; to: number; color: string; title: string }[] = []
  {
    const b = [
      { at: 0, color: BAND.night, title: 'Night' },
      { at: frac(ev.astroDawn, 0), color: BAND.astro, title: 'Astronomical twilight' },
      { at: frac(ev.nauticalDawn, 0), color: BAND.nautical, title: 'Nautical twilight' },
      { at: frac(ev.civilDawn, 0), color: BAND.blue, title: 'Blue hour' },
      { at: frac(ev.blueAmEnd, 0), color: BAND.golden, title: 'Golden hour' },
      { at: frac(ev.goldenAmEnd, 0.25), color: BAND.day, title: 'Daylight' },
      { at: frac(ev.goldenPmStart, 0.75), color: BAND.golden, title: 'Golden hour' },
      { at: frac(ev.bluePmStart, 0.8), color: BAND.blue, title: 'Blue hour' },
      { at: frac(ev.bluePmEnd, 0.85), color: BAND.nautical, title: 'Nautical twilight' },
      { at: frac(ev.nauticalDusk, 0.9), color: BAND.astro, title: 'Astronomical twilight' },
      { at: frac(ev.astroDusk, 0.95), color: BAND.night, title: 'Night' },
    ]
    for (let i = 0; i < b.length; i++) {
      const to = i + 1 < b.length ? b[i + 1].at : 1
      if (to > b[i].at) segments.push({ from: b[i].at, to, color: b[i].color, title: b[i].title })
    }
  }

  const cursorFrac = cursorMin / 1440

  const rows: { label: string; time: Date | null; note?: string }[] = [
    { label: 'Blue hour', time: ev.civilDawn, note: `until ${fmtClock(ev.blueAmEnd)}` },
    { label: 'Sunrise', time: ev.sunrise },
    { label: 'Golden hour ends', time: ev.goldenAmEnd },
    { label: 'Solar noon', time: ev.solarNoon, note: `${ev.maxAltitude.toFixed(0)}° max` },
    { label: 'Golden hour', time: ev.goldenPmStart, note: `until ${fmtClock(ev.sunset)}` },
    { label: 'Sunset', time: ev.sunset },
    { label: 'Blue hour', time: ev.bluePmStart, note: `until ${fmtClock(ev.bluePmEnd)}` },
    { label: 'Dark', time: ev.astroDusk },
  ]

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Light Today
      </h2>

      {/* 24h light band */}
      <div className="relative h-8 rounded-md overflow-hidden flex" role="img" aria-label="Light phases across the day">
        {segments.map((s, i) => (
          <div key={i} title={s.title} style={{ width: `${(s.to - s.from) * 100}%`, background: s.color }} />
        ))}
        {/* cursor */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_4px_rgba(0,0,0,0.6)]" style={{ left: `${cursorFrac * 100}%` }} />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1">
        <span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>12 AM</span>
      </div>

      {/* Time travel */}
      <div className="mt-4">
        <input
          type="range"
          min={0}
          max={1439}
          value={Math.round(cursorMin)}
          onChange={e => setTravelMin(Number(e.target.value))}
          className="w-full accent-amber-500"
          aria-label="Time travel"
        />
        <div className="flex items-baseline justify-between mt-1">
          <div className="text-sm font-semibold tabular-nums">
            {cursorDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            {travelMin !== null && (
              <button
                onClick={() => setTravelMin(null)}
                className="ml-2 text-[11px] font-normal text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                now
              </button>
            )}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums">
            {pos.altitude >= 0
              ? <>☀️ {pos.altitude.toFixed(0)}° high · {compass(pos.azimuth)} {pos.azimuth.toFixed(0)}°</>
              : <>{Math.abs(pos.altitude).toFixed(0)}° below horizon · {compass(pos.azimuth)}</>}
          </div>
        </div>
      </div>

      {/* Event table */}
      <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        {rows.map((r, i) => (
          <div key={i}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{r.label}</div>
            <div className="text-sm font-semibold tabular-nums">{fmtClock(r.time)}</div>
            {r.note && <div className="text-[10px] text-muted-foreground tabular-nums">{r.note}</div>}
          </div>
        ))}
      </div>

      {/* Season */}
      <div className="mt-5 pt-4 border-t border-border/60 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <div className="text-sm">
          <span className="font-semibold">{season.season}</span>
          <span className="text-muted-foreground"> (astronomical)</span>
          {season.meteorological !== season.season && (
            <span className="text-muted-foreground"> · {season.meteorological.toLowerCase()} meteorological</span>
          )}
        </div>
        <div className="text-[12px] text-muted-foreground tabular-nums">
          {season.nextEvent} in {season.daysUntil} {season.daysUntil === 1 ? 'day' : 'days'} —{' '}
          {season.nextEventDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </div>
      </div>
    </div>
  )
}
