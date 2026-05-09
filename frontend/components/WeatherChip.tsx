'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { describeWeather } from '@/lib/weather'

interface WeatherSnapshot {
  place: string
  current: { temperature_2m: number; weather_code: number; apparent_temperature: number }
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] }
}

export default function WeatherChip({ compact = false }: { compact?: boolean }) {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)

  useEffect(() => {
    fetch('/api/weather').then(r => r.ok ? r.json() : null).then(setWeather).catch(() => {})
  }, [])

  if (!weather) {
    return <div className="h-9 w-32 bg-muted/30 rounded animate-pulse" />
  }

  const cond = describeWeather(weather.current.weather_code)
  const hi = Math.round(weather.daily.temperature_2m_max[0])
  const lo = Math.round(weather.daily.temperature_2m_min[0])

  return (
    <Link
      href="/weather"
      className="inline-flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-muted/20 hover:bg-muted/40 transition-colors"
      title={`${cond.label} · feels like ${Math.round(weather.current.apparent_temperature)}°`}
    >
      <span className="text-2xl leading-none">{cond.emoji}</span>
      <div className="flex flex-col leading-tight">
        <span className="text-base font-semibold tabular-nums">
          {Math.round(weather.current.temperature_2m)}°
        </span>
        <span className="text-[10px] text-muted-foreground line-clamp-1">
          {weather.place} · {cond.label}
        </span>
      </div>
      {!compact && (
        <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:block ml-1">
          ↑{hi}° ↓{lo}°
        </span>
      )}
    </Link>
  )
}
