'use client'

// Moonlitt-style moon tracker: rise/set/culmination, lunar age, moon sign,
// next full/new moon (with the traditional full-moon name), and a browsable
// lunar calendar — pick any date to see its phase. On-device math (lib/astro).

import { useMemo, useState } from 'react'
import { lunarPhase, moonTimes, upcomingPhases, fullMoonName } from '@/lib/astro'

interface Props {
  lat: number
  lon: number
  now: string
}

function fmtClock(d: Date | null): string {
  if (!d) return '—'
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export default function MoonPanel({ lat, lon, now }: Props) {
  const today = useMemo(() => new Date(now), [now])
  const [selected, setSelected] = useState<Date | null>(null)
  const [monthOffset, setMonthOffset] = useState(0)

  const active = selected ?? today
  // Noon anchor so the phase shown represents the selected calendar day.
  const activeNoon = useMemo(() => {
    const d = new Date(active); d.setHours(12, 0, 0, 0); return d
  }, [active])

  const phase = useMemo(() => lunarPhase(selected ? activeNoon : today), [selected, activeNoon, today])
  const times = useMemo(() => moonTimes(activeNoon, lat, lon), [activeNoon, lat, lon])
  const next = useMemo(() => upcomingPhases(today), [today])

  // Calendar month grid
  const monthStart = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1)
  const gridStart = new Date(monthStart)
  gridStart.setDate(1 - monthStart.getDay())
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
  const monthLabel = monthStart.toLocaleDateString([], { month: 'long', year: 'numeric' })

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Moon
      </h2>

      {/* Selected-day summary */}
      <div className="flex items-center gap-4">
        <div className="text-5xl leading-none select-none">{phase.emoji}</div>
        <div className="min-w-0">
          <div className="text-lg font-semibold leading-tight">
            {phase.name}
            {phase.name === 'Full Moon' && (
              <span className="text-muted-foreground font-normal"> · {fullMoonName(active)}</span>
            )}
          </div>
          <div className="text-[12px] text-muted-foreground tabular-nums mt-0.5">
            {selected ? fmtDate(active) : 'Today'} · {phase.illumination}% illuminated ·{' '}
            {phase.age.toFixed(1)} days old · in {phase.zodiac}
          </div>
        </div>
        {selected && (
          <button
            onClick={() => { setSelected(null); setMonthOffset(0) }}
            className="ml-auto shrink-0 text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            today
          </button>
        )}
      </div>

      {/* Rise / culmination / set */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Moonrise</div>
          <div className="text-sm font-semibold tabular-nums">{fmtClock(times.rise)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Culmination</div>
          <div className="text-sm font-semibold tabular-nums">
            {fmtClock(times.culmination)}
            {times.culmination && <span className="text-[10px] font-normal text-muted-foreground ml-1">{times.culminationAlt.toFixed(0)}°</span>}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Moonset</div>
          <div className="text-sm font-semibold tabular-nums">{fmtClock(times.set)}</div>
        </div>
      </div>

      {/* Upcoming phases */}
      <div className="mt-4 pt-4 border-t border-border/60 grid grid-cols-2 gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next full moon</div>
          <div className="text-sm font-semibold">🌕 {next.nextFullName}</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(next.nextFull)} · {fmtClock(next.nextFull)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Next new moon</div>
          <div className="text-sm font-semibold">🌑 New Moon</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">{fmtDate(next.nextNew)} · {fmtClock(next.nextNew)}</div>
        </div>
      </div>

      {/* Lunar calendar */}
      <div className="mt-5 pt-4 border-t border-border/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Lunar calendar</p>
          <div className="flex items-center gap-1 text-sm">
            <button onClick={() => setMonthOffset(o => o - 1)} aria-label="Previous month"
              className="px-2 py-0.5 rounded hover:bg-muted text-muted-foreground">‹</button>
            <span className="text-[12px] font-medium tabular-nums w-32 text-center">{monthLabel}</span>
            <button onClick={() => setMonthOffset(o => o + 1)} aria-label="Next month"
              className="px-2 py-0.5 rounded hover:bg-muted text-muted-foreground">›</button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-y-1">
          {cells.map((d, i) => {
            const inMonth = d.getMonth() === monthStart.getMonth()
            const isToday = sameDay(d, today)
            const isSelected = sameDay(d, active)
            const noon = new Date(d); noon.setHours(12, 0, 0, 0)
            const p = lunarPhase(noon)
            return (
              <button
                key={i}
                onClick={() => setSelected(new Date(d))}
                className={`flex flex-col items-center rounded-md py-1 transition-colors
                  ${inMonth ? '' : 'opacity-35'}
                  ${isSelected ? 'bg-muted ring-1 ring-border' : 'hover:bg-muted/60'}`}
                aria-label={`${d.toLocaleDateString()} — ${p.name}`}
              >
                <span className="text-sm leading-none select-none">{p.emoji}</span>
                <span className={`text-[10px] tabular-nums mt-0.5 ${isToday ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>
                  {d.getDate()}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
