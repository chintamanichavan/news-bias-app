'use client'

// Lumy's solar compass + Moonlitt's moon compass in one dial. Fisheye sky
// plot: center = zenith, rim = horizon. Sun path solid, moon path dashed,
// live markers for both. All on-device (lib/astro).

import { useMemo } from 'react'
import { sunPosition, moonPosition, sunEvents, moonTimes } from '@/lib/astro'
import { compass } from '@/lib/weather'

interface Props {
  lat: number
  lon: number
  now: string
}

const R = 100  // dial radius in viewBox units

function toXY(azimuth: number, altitude: number): { x: number; y: number } {
  const r = R * (1 - Math.max(0, altitude) / 90)
  const a = (azimuth - 90) * Math.PI / 180  // 0° azimuth (N) points up
  return { x: 130 + r * Math.cos(a), y: 130 + r * Math.sin(a) }
}

function pathFor(day: Date, lat: number, lon: number, pos: typeof sunPosition): string {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate())
  let d = ''
  for (let m = 0; m <= 1440; m += 10) {
    const p = pos(new Date(start.getTime() + m * 60_000), lat, lon)
    if (p.altitude <= 0) { continue }
    const { x, y } = toXY(p.azimuth, p.altitude)
    d += d === '' ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`
  }
  return d
}

export default function SolarCompassCard({ lat, lon, now }: Props) {
  const nowDate = useMemo(() => new Date(now), [now])
  const sun = sunPosition(nowDate, lat, lon)
  const moon = moonPosition(nowDate, lat, lon)
  const ev = useMemo(() => sunEvents(nowDate, lat, lon), [nowDate, lat, lon])
  const mt = useMemo(() => moonTimes(nowDate, lat, lon), [nowDate, lat, lon])

  const sunPath = useMemo(() => pathFor(nowDate, lat, lon, sunPosition), [nowDate, lat, lon])
  const moonPath = useMemo(
    () => pathFor(nowDate, lat, lon, (d, la, lo) => moonPosition(d, la, lo)),
    [nowDate, lat, lon],
  )

  const riseAz = ev.sunrise ? sunPosition(ev.sunrise, lat, lon).azimuth : null
  const setAz = ev.sunset ? sunPosition(ev.sunset, lat, lon).azimuth : null

  const sunXY = sun.altitude > 0 ? toXY(sun.azimuth, sun.altitude) : null
  const moonXY = moon.altitude > 0 ? toXY(moon.azimuth, moon.altitude) : null

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Sky Compass
      </h2>

      <div className="flex flex-col sm:flex-row items-center gap-6">
        <svg viewBox="0 0 260 260" className="w-56 h-56 shrink-0">
          {/* horizon + altitude rings (30° / 60°) */}
          <circle cx={130} cy={130} r={R} fill="none" className="stroke-border" strokeWidth={1.25} />
          <circle cx={130} cy={130} r={R * 2 / 3} fill="none" className="stroke-border/60" strokeWidth={0.75} strokeDasharray="2 3" />
          <circle cx={130} cy={130} r={R / 3} fill="none" className="stroke-border/60" strokeWidth={0.75} strokeDasharray="2 3" />
          {/* cardinal labels */}
          {([[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']] as const).map(([az, label]) => {
            const a = (az - 90) * Math.PI / 180
            return (
              <text key={label} x={130 + (R + 14) * Math.cos(a)} y={130 + (R + 14) * Math.sin(a)}
                textAnchor="middle" dominantBaseline="central" fontSize={12}
                className={label === 'N' ? 'fill-foreground font-semibold' : 'fill-muted-foreground'}>
                {label}
              </text>
            )
          })}
          {/* rise/set azimuth ticks */}
          {[riseAz, setAz].map((az, i) => az != null && (
            <line key={i}
              x1={130 + (R - 5) * Math.cos((az - 90) * Math.PI / 180)}
              y1={130 + (R - 5) * Math.sin((az - 90) * Math.PI / 180)}
              x2={130 + (R + 5) * Math.cos((az - 90) * Math.PI / 180)}
              y2={130 + (R + 5) * Math.sin((az - 90) * Math.PI / 180)}
              stroke="#f59e0b" strokeWidth={2} />
          ))}
          {/* paths */}
          <path d={sunPath} fill="none" stroke="#f59e0b" strokeWidth={1.75} strokeLinecap="round" opacity={0.85} />
          <path d={moonPath} fill="none" className="stroke-slate-400" strokeWidth={1.5} strokeDasharray="4 3" strokeLinecap="round" opacity={0.8} />
          {/* live markers */}
          {sunXY && (
            <>
              <circle cx={sunXY.x} cy={sunXY.y} r={10} fill="#fbbf24" opacity={0.25} />
              <circle cx={sunXY.x} cy={sunXY.y} r={6} fill="#fbbf24" stroke="white" strokeWidth={1.75} />
            </>
          )}
          {moonXY && (
            <circle cx={moonXY.x} cy={moonXY.y} r={5} className="fill-slate-300 stroke-slate-500" strokeWidth={1.25} />
          )}
          {!sunXY && !moonXY && (
            <text x={130} y={130} textAnchor="middle" fontSize={10} className="fill-muted-foreground">
              both below horizon
            </text>
          )}
        </svg>

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm w-full">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">☀️ Sun now</div>
            <div className="font-semibold tabular-nums">
              {sun.altitude >= 0 ? `${sun.altitude.toFixed(0)}° high` : `${Math.abs(sun.altitude).toFixed(0)}° below`}
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{compass(sun.azimuth)} · {sun.azimuth.toFixed(0)}°</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">🌙 Moon now</div>
            <div className="font-semibold tabular-nums">
              {moon.altitude >= 0 ? `${moon.altitude.toFixed(0)}° high` : `${Math.abs(moon.altitude).toFixed(0)}° below`}
            </div>
            <div className="text-[11px] text-muted-foreground tabular-nums">{compass(moon.azimuth)} · {moon.azimuth.toFixed(0)}°</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sunrise → sunset azimuth</div>
            <div className="font-semibold tabular-nums">
              {riseAz != null ? `${compass(riseAz)} ${riseAz.toFixed(0)}°` : '—'} → {setAz != null ? `${compass(setAz)} ${setAz.toFixed(0)}°` : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Moon up</div>
            <div className="font-semibold tabular-nums">
              {mt.rise ? mt.rise.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
              {' – '}
              {mt.set ? mt.set.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
