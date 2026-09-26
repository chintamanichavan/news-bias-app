'use client'

// Lumy-style reminders: pick sun/moon events, get a browser notification.
// Web constraint stated in the UI: without a push server, notifications fire
// while ClearLens is open in a tab. Preferences persist in localStorage.

import { useEffect, useMemo, useState } from 'react'
import { sunEvents, upcomingPhases, upcomingEclipses } from '@/lib/astro'

interface Props {
  lat: number
  lon: number
  now: string
}

const STORE_KEY = 'cl-sun-reminders'

type EventKey = 'sunrise' | 'sunset' | 'golden-pm' | 'full-moon' | 'new-moon' | 'eclipse'

const LABELS: Record<EventKey, string> = {
  sunrise: 'Sunrise (daily)',
  sunset: 'Sunset (daily)',
  'golden-pm': 'Evening golden hour (daily)',
  'full-moon': 'Next full moon',
  'new-moon': 'Next new moon',
  eclipse: 'Next eclipse',
}

function loadPrefs(): Set<EventKey> {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    return new Set(raw ? JSON.parse(raw) : [])
  } catch { return new Set() }
}

export default function RemindersCard({ lat, lon, now }: Props) {
  const [enabled, setEnabled] = useState<Set<EventKey>>(new Set())
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')

  useEffect(() => {
    setEnabled(loadPrefs())
    setPermission(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
  }, [])

  // Next occurrence per enabled event, recomputed as the clock moves.
  const nextTimes = useMemo(() => {
    const base = new Date(now)
    const out = new Map<EventKey, Date>()
    for (const key of Array.from(enabled)) {
      let t: Date | null = null
      if (key === 'sunrise' || key === 'sunset' || key === 'golden-pm') {
        for (let i = 0; i < 2 && !t; i++) {
          const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, 12)
          const ev = sunEvents(day, lat, lon)
          const cand = key === 'sunrise' ? ev.sunrise : key === 'sunset' ? ev.sunset : ev.goldenPmStart
          if (cand && cand.getTime() > base.getTime()) t = cand
        }
      } else if (key === 'full-moon') {
        t = upcomingPhases(base).nextFull
      } else if (key === 'new-moon') {
        t = upcomingPhases(base).nextNew
      } else {
        const e = upcomingEclipses(base, 1)[0]
        if (e) t = new Date(e.date + 'T12:00')
      }
      if (t) out.set(key, t)
    }
    return out
  }, [enabled, now, lat, lon])

  // Arm timers for anything due within 24h of page-open.
  useEffect(() => {
    if (permission !== 'granted') return
    const timers: ReturnType<typeof setTimeout>[] = []
    const nowMs = Date.now()
    nextTimes.forEach((t, key) => {
      const delay = t.getTime() - nowMs
      if (delay > 0 && delay < 24 * 3_600_000) {
        timers.push(setTimeout(() => {
          try { new Notification('ClearLens · Sun & Moon', { body: LABELS[key].replace(/ \(daily\)$/, '') + ' now' }) } catch {}
        }, delay))
      }
    })
    return () => timers.forEach(clearTimeout)
  }, [nextTimes, permission])

  function toggle(key: EventKey) {
    const next = new Set(enabled)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setEnabled(next)
    try { localStorage.setItem(STORE_KEY, JSON.stringify(Array.from(next))) } catch {}
    if (next.size && permission === 'default') {
      Notification.requestPermission().then(setPermission)
    }
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Reminders
      </h2>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2">
        {(Object.keys(LABELS) as EventKey[]).map(key => (
          <label key={key} className="flex items-center gap-2.5 text-sm cursor-pointer py-0.5">
            <input
              type="checkbox"
              checked={enabled.has(key)}
              onChange={() => toggle(key)}
              className="accent-amber-500 w-4 h-4"
            />
            <span className="flex-1">{LABELS[key]}</span>
            {enabled.has(key) && nextTimes.get(key) && (
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {nextTimes.get(key)!.toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                {nextTimes.get(key)!.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </label>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-muted-foreground">
        {permission === 'unsupported' && 'This browser does not support notifications.'}
        {permission === 'denied' && 'Notifications are blocked for this site — enable them in browser settings.'}
        {(permission === 'granted' || permission === 'default') &&
          'Browser notifications fire while ClearLens is open in a tab (no push server).'}
      </p>
    </div>
  )
}
