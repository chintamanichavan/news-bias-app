'use client'

// Moonlitt's "moon path where you are" (a sky-track chart standing in for the
// iOS AR view), plus distance / perigee / apogee / supermoon and a cloud-based
// visibility read for tonight.

import { useMemo } from 'react'
import {
  moonPosition, sunPosition, sunEvents,
  moonDistanceExtremes, upcomingPhases, isSupermoon,
} from '@/lib/astro'

interface Props {
  lat: number
  lon: number
  now: string
  /** Hourly cloud cover for the visibility read (optional). */
  hourly?: { times: string[]; cover: number[] } | null
}

const W = 320, H = 120

function altPath(day: Date, lat: number, lon: number, kind: 'moon' | 'sun'): string {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  let d = ''
  for (let m = 0; m <= 1440; m += 15) {
    const t = new Date(start.getTime() + m * 60_000)
    const alt = kind === 'moon' ? moonPosition(t, lat, lon).altitude : sunPosition(t, lat, lon).altitude
    const x = (m / 1440) * W
    const y = H / 2 - (alt / 90) * (H / 2 - 6)
    d += (d === '' ? 'M' : ' L') + ` ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function MoonPathCard({ lat, lon, now, hourly }: Props) {
  const nowDate = useMemo(() => new Date(now), [now])
  const moonD = useMemo(() => altPath(nowDate, lat, lon, 'moon'), [nowDate, lat, lon])
  const sunD = useMemo(() => altPath(nowDate, lat, lon, 'sun'), [nowDate, lat, lon])
  const pos = moonPosition(nowDate, lat, lon)
  const ext = useMemo(() => moonDistanceExtremes(nowDate), [nowDate])
  const nextFull = useMemo(() => upcomingPhases(nowDate), [nowDate])
  const superFull = isSupermoon(nextFull.nextFull)

  const nowX = ((nowDate.getHours() * 60 + nowDate.getMinutes()) / 1440) * W
  const nowY = H / 2 - (pos.altitude / 90) * (H / 2 - 6)

  // Tonight's viewing: mean cloud cover from sunset to 2 AM, if we have data.
  const visibility = useMemo(() => {
    if (!hourly?.times.length) return null
    const ev = sunEvents(nowDate, lat, lon)
    if (!ev.sunset) return null
    const from = ev.sunset.getTime()
    const to = from + 7 * 3_600_000
    const covers = hourly.times
      .map((t, i) => ({ t: new Date(t).getTime(), c: hourly.cover[i] }))
      .filter(x => x.t >= from && x.t <= to && x.c != null)
    if (!covers.length) return null
    const mean = covers.reduce((s, x) => s + x.c, 0) / covers.length
    const label = mean < 25 ? 'Great' : mean < 60 ? 'Fair' : 'Poor'
    return { mean: Math.round(mean), label }
  }, [hourly, nowDate, lat, lon])

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Moon Path &amp; Distance
      </h2>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* horizon */}
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
        <text x={2} y={H / 2 - 4} fontSize={8} className="fill-muted-foreground">horizon</text>
        <path d={sunD} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={0.4} />
        <path d={moonD} fill="none" className="stroke-slate-400" strokeWidth={1.75} />
        <circle cx={nowX} cy={nowY} r={4.5} className="fill-slate-300 stroke-slate-600" strokeWidth={1.25} />
        {/* hour labels */}
        {[0, 6, 12, 18, 24].map(h => (
          <text key={h} x={(h / 24) * W} y={H - 2} fontSize={8}
            textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}
            className="fill-muted-foreground tabular-nums">
            {h === 0 || h === 24 ? '12A' : h === 12 ? '12P' : h < 12 ? `${h}A` : `${h - 12}P`}
          </text>
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Distance now</div>
          <div className="text-sm font-semibold tabular-nums">{Math.round(pos.distance).toLocaleString()} km</div>
          <div className="text-[10px] text-muted-foreground">{(pos.distance / 384400 * 100).toFixed(0)}% of average</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Perigee (closest)</div>
          <div className="text-sm font-semibold tabular-nums">{fmtDate(ext.perigee.date)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{ext.perigee.distance.toLocaleString()} km</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Apogee (farthest)</div>
          <div className="text-sm font-semibold tabular-nums">{fmtDate(ext.apogee.date)}</div>
          <div className="text-[10px] text-muted-foreground tabular-nums">{ext.apogee.distance.toLocaleString()} km</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Viewing tonight</div>
          <div className="text-sm font-semibold">{visibility ? visibility.label : '—'}</div>
          {visibility && <div className="text-[10px] text-muted-foreground tabular-nums">{visibility.mean}% avg cloud</div>}
        </div>
      </div>

      {superFull && (
        <div className="mt-3 text-[12px] text-muted-foreground">
          ✨ The {fmtDate(nextFull.nextFull)} full moon is a <span className="font-medium text-foreground">supermoon</span> — within 360,000 km of Earth.
        </div>
      )}
    </div>
  )
}
