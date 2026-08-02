'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import HourlyTempCurve from '@/components/HourlyTempCurve'
import { describeWeather } from '@/lib/weather'

interface WeatherData {
  current: {
    time: string
    weather_code: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
    weather_code: number[]
    is_day: (0 | 1)[]
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_probability_max: (number | null)[]
    precipitation_sum: (number | null)[]
    precipitation_hours: (number | null)[]
    sunrise: string[]
    sunset: string[]
  }
}

export default function ForecastDetailPage() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/weather')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Extend the hourly window for the detail view: 48h instead of 24h.
  const next48 = useMemo(() => {
    if (!data) return []
    const nowIso = data.current.time
    const start = Math.max(0, data.hourly.time.findIndex(t => t >= nowIso))
    const end = Math.min(start + 48, data.hourly.time.length)
    return Array.from({ length: end - start }, (_, i) => ({
      time: data.hourly.time[start + i],
      temperature_2m: data.hourly.temperature_2m[start + i],
      precipitation_probability: data.hourly.precipitation_probability[start + i],
      weather_code: data.hourly.weather_code[start + i],
      is_day: data.hourly.is_day[start + i],
    }))
  }, [data])

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/weather"
        className="inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Weather
      </Link>

      <div className="mb-2">
        <p className="news-section-label">Detail</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">Forecast</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-prose">
          Hourly temperature for the next two days and a 7-day daily outlook with high/low ranges and precipitation odds.
        </p>
      </div>

      {error && (
        <Card><div className="p-6 text-center text-sm text-muted-foreground">Couldn&apos;t load weather: {error}</div></Card>
      )}

      {!data ? (
        <>
          <Card><div className="p-6 h-72 bg-muted/30 animate-pulse rounded-2xl" /></Card>
          <Card><div className="p-6 h-80 bg-muted/30 animate-pulse rounded-2xl" /></Card>
        </>
      ) : (
        <>
          {/* Hourly temp + precip — 48h */}
          <Card>
            <div className="p-6 sm:p-7">
              <p className="news-section-label mb-4">Next 48 hours</p>
              <HourlyTempCurve points={next48} />
              <p className="text-[11px] text-muted-foreground mt-2">
                Solid line: temperature · blue bars: precipitation chance · light wash: daylight hours
              </p>
            </div>
          </Card>

          {/* 7-day forecast */}
          <Card>
            <div className="p-6 sm:p-7">
              <p className="news-section-label mb-4">7-day outlook</p>
              <DailyForecast data={data.daily} />
            </div>
          </Card>

          {/* About */}
          <Card>
            <div className="p-6 sm:p-7">
              <p className="news-section-label mb-3">About</p>
              <div className="space-y-3 text-[14px] leading-relaxed text-foreground/85 max-w-prose">
                <p>Open-Meteo forecasts are updated every 15 minutes from the German Weather Service and ECMWF model blend. Hourly resolution is good to ±1°F within the next 24 hours; daily highs/lows are within ±2°F most of the week.</p>
                <p>Precipitation probability is the chance of any measurable precipitation within the hour, not the intensity. &ldquo;Sum&rdquo; is the day&rsquo;s total accumulation in inches; &ldquo;hours&rdquo; is the number of hours expected to see precip.</p>
              </div>
            </div>
          </Card>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center pt-2">
        Forecast from Open-Meteo · cached 10 min
      </p>
    </div>
  )
}

function fmtDay(iso: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tomorrow'
  return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' })
}

function DailyForecast({ data }: { data: WeatherData['daily'] }) {
  const hottest = Math.max(...data.temperature_2m_max)
  const coldest = Math.min(...data.temperature_2m_min)
  const weekMin = coldest
  const weekMax = hottest
  const range = weekMax - weekMin || 1

  return (
    <div className="space-y-2.5">
      {data.time.map((day, i) => {
        const c = describeWeather(data.weather_code[i])
        const hi = data.temperature_2m_max[i]
        const lo = data.temperature_2m_min[i]
        const pop = data.precipitation_probability_max[i] ?? 0
        const precip = data.precipitation_sum[i] ?? 0
        const hours = data.precipitation_hours[i] ?? 0
        const tag: string | null =
          hi === hottest && i > 0 ? 'warmest' :
          lo === coldest && i > 0 ? 'coldest' :
          pop >= 70 ? 'wet' :
          null
        const left = ((lo - weekMin) / range) * 100
        const width = ((hi - lo) / range) * 100
        return (
          <div
            key={day}
            className="grid grid-cols-[80px_32px_1fr_104px] sm:grid-cols-[100px_36px_1fr_130px] items-center gap-3 py-2"
          >
            <div className="text-sm font-medium">{fmtDay(day, i)}</div>
            <div className="text-2xl text-center" title={c.label}>{c.emoji}</div>
            <div className="relative h-4 rounded-full bg-muted/50 overflow-hidden">
              <div
                className="absolute top-0 h-4 rounded-full"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  background: 'linear-gradient(to right, #60a5fa 0%, #fde047 50%, #f97316 100%)',
                }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-2 text-[10px] font-semibold tabular-nums">
                <span className="text-muted-foreground">{Math.round(lo)}°</span>
                <span className="text-foreground">{Math.round(hi)}°</span>
              </div>
            </div>
            <div className="text-right text-[11px] text-muted-foreground tabular-nums flex items-center justify-end gap-1.5">
              {tag && (
                <span className={`text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded
                  ${tag === 'warmest' ? 'bg-orange-100 text-orange-800' :
                    tag === 'coldest' ? 'bg-sky-100 text-sky-800' :
                    'bg-blue-100 text-blue-800'}`}>{tag}</span>
              )}
              <span className={pop >= 30 ? 'text-sky-600' : ''} title={precip > 0 ? `${precip.toFixed(2)}" over ~${Math.round(hours)}h` : 'no precip expected'}>
                {pop}%
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
