'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import AtmosphericHero from '@/components/AtmosphericHero'
import HourlyTempCurve from '@/components/HourlyTempCurve'
import { describeWeather, compass, aqiCategory } from '@/lib/weather'

interface WeatherData {
  place: string
  current: {
    time: string
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    is_day: 0 | 1
    precipitation: number
    weather_code: number
    wind_speed_10m: number
    wind_direction_10m: number
    wind_gusts_10m: number
    surface_pressure: number
    pressure_msl: number
    cloud_cover: number
    visibility: number
    dew_point_2m: number
  }
  hourly: {
    time: string[]
    temperature_2m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    weather_code: number[]
    wind_speed_10m: number[]
    surface_pressure: number[]
    cloud_cover: number[]
    is_day: (0 | 1)[]
  }
  daily: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    apparent_temperature_max: number[]
    apparent_temperature_min: number[]
    precipitation_probability_max: number[]
    precipitation_sum: number[]
    precipitation_hours: number[]
    sunrise: string[]
    sunset: string[]
    uv_index_max: number[]
    wind_speed_10m_max: number[]
    wind_gusts_10m_max: number[]
  }
  air_quality: {
    current: {
      us_aqi: number
      pm10: number
      pm2_5: number
      ozone: number
      uv_index: number
    } | null
  } | null
}

function fmtDay(iso: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tomorrow'
  return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' })
}

function uvLabel(uv: number): string {
  if (uv < 3) return 'Low'
  if (uv < 6) return 'Moderate'
  if (uv < 8) return 'High'
  if (uv < 11) return 'Very High'
  return 'Extreme'
}

export default function WeatherPage() {
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWeather = useCallback(async () => {
    try {
      const res = await fetch('/api/weather')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchWeather() }, [fetchWeather])

  // Pull next 24 hours starting at the current hour
  const next24 = useMemo(() => {
    if (!data) return []
    const nowIso = data.current.time
    const start = Math.max(0, data.hourly.time.findIndex(t => t >= nowIso))
    return Array.from({ length: 24 }, (_, i) => start + i)
      .filter(i => i < data.hourly.time.length)
      .map(i => ({
        time: data.hourly.time[i],
        temperature_2m: data.hourly.temperature_2m[i],
        precipitation_probability: data.hourly.precipitation_probability[i],
        weather_code: data.hourly.weather_code[i],
        is_day: data.hourly.is_day[i],
      }))
  }, [data])

  // Pressure trend over last few hourly steps (around now ± few)
  const pressureTrend = useMemo(() => {
    if (!data) return null
    const nowIso = data.current.time
    const idx = data.hourly.time.findIndex(t => t >= nowIso)
    if (idx < 2) return null
    const a = data.hourly.surface_pressure[idx - 2]
    const b = data.hourly.surface_pressure[idx]
    if (a == null || b == null) return null
    return b - a
  }, [data])

  if (loading && !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="h-[360px] rounded-2xl bg-muted/30 animate-pulse mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 h-56 rounded-xl bg-muted/30 animate-pulse" />
          <div className="h-56 rounded-xl bg-muted/30 animate-pulse" />
        </div>
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-lg font-medium">Couldn't load weather</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={() => { setRefreshing(true); fetchWeather() }}>Retry</Button>
      </div>
    )
  }

  const cur = data.current
  const today = {
    high: data.daily.temperature_2m_max[0],
    low:  data.daily.temperature_2m_min[0],
    sunrise: data.daily.sunrise[0],
    sunset:  data.daily.sunset[0],
    uv:      data.daily.uv_index_max[0],
    precipHours: data.daily.precipitation_hours[0],
    gusts: data.daily.wind_gusts_10m_max[0],
  }
  const aq = data.air_quality?.current ?? null
  const aqi = aqiCategory(aq?.us_aqi ?? null)

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      {/* Atmospheric hero */}
      <AtmosphericHero
        temp={cur.temperature_2m}
        feelsLike={cur.apparent_temperature}
        weatherCode={cur.weather_code}
        isDay={cur.is_day === 1}
        place={data.place}
        high={today.high}
        low={today.low}
        humidity={cur.relative_humidity_2m}
        windSpeed={cur.wind_speed_10m}
        windDir={cur.wind_direction_10m}
        sunrise={today.sunrise}
        sunset={today.sunset}
        updated={cur.time}
      />

      <div className="flex items-center justify-end -mt-2">
        <Button size="sm" variant="outline" onClick={() => { setRefreshing(true); fetchWeather() }} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Hourly curve + AQI side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Next 24 hours
            </h2>
            <HourlyTempCurve points={next24} />
            <p className="text-[11px] text-muted-foreground mt-1">
              Solid line: temperature · blue bars: precipitation chance · light wash: daylight hours
            </p>
          </div>
        </Card>

        <Card>
          <div className="p-4 h-full flex flex-col">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Air quality
            </h2>
            {aq ? (
              <>
                <div className="flex items-end gap-3 mb-3">
                  <div className={`px-3 py-2 rounded-lg ${aqi.bg} ${aqi.color}`}>
                    <div className="text-3xl font-bold tabular-nums leading-none">{aq.us_aqi}</div>
                    <div className="text-[10px] uppercase tracking-wider mt-1 opacity-90">US AQI</div>
                  </div>
                  <div className="text-sm font-medium pb-2">{aqi.label}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <Stat label="PM2.5"  value={`${aq.pm2_5.toFixed(1)} µg/m³`} />
                  <Stat label="PM10"   value={`${aq.pm10.toFixed(1)} µg/m³`} />
                  <Stat label="Ozone"  value={`${aq.ozone.toFixed(0)} µg/m³`} />
                  <Stat label="UV"     value={`${aq.uv_index.toFixed(1)} (${uvLabel(aq.uv_index)})`} />
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No air-quality data available.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Detailed metrics row */}
      <Card>
        <div className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Now
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            <Metric label="Wind" value={`${Math.round(cur.wind_speed_10m)} mph`} sub={compass(cur.wind_direction_10m)}
              icon={<WindArrow deg={cur.wind_direction_10m} />} />
            <Metric label="Gusts" value={`${Math.round(cur.wind_gusts_10m)} mph`} />
            <Metric label="Pressure"
              value={`${cur.pressure_msl.toFixed(0)} hPa`}
              sub={pressureTrend == null ? '—' : pressureTrend > 0.5 ? '↑ rising' : pressureTrend < -0.5 ? '↓ falling' : '→ steady'} />
            <Metric label="Humidity" value={`${cur.relative_humidity_2m}%`} sub={`dew ${Math.round(cur.dew_point_2m)}°`} />
            <Metric label="Cloud cover" value={`${cur.cloud_cover}%`} />
            <Metric label="Visibility" value={cur.visibility >= 16093 ? '10+ mi' : `${(cur.visibility / 1609).toFixed(1)} mi`} />
            <Metric label="UV today" value={today.uv?.toFixed(0) ?? '—'} sub={today.uv != null ? uvLabel(today.uv) : ''} />
          </div>
        </div>
      </Card>

      {/* 7-day */}
      <Card>
        <div className="p-4">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            7-day forecast
          </h2>
          <DailyForecast data={data.daily} />
        </div>
      </Card>

      <p className="text-xs text-muted-foreground mt-4 text-center">
        Forecast & air quality from Open-Meteo · cached 10 min · sun arc updates as the day progresses
      </p>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

function Metric({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {icon && <div className="shrink-0">{icon}</div>}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold tabular-nums">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
      </div>
    </div>
  )
}

function WindArrow({ deg }: { deg: number }) {
  return (
    <div className="relative w-10 h-10 rounded-full border border-border bg-muted/40 flex items-center justify-center">
      <svg viewBox="0 0 20 20" className="w-6 h-6" style={{ transform: `rotate(${deg}deg)` }}>
        <path d="M10 2 L13 14 L10 11 L7 14 Z" className="fill-foreground/80" />
      </svg>
      <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 text-[8px] text-muted-foreground">N</div>
    </div>
  )
}

function DailyForecast({ data }: { data: WeatherData['daily'] }) {
  const hottest = Math.max(...data.temperature_2m_max)
  const coldest = Math.min(...data.temperature_2m_min)
  return (
    <div className="space-y-2">
      {data.time.map((day, i) => {
        const c = describeWeather(data.weather_code[i])
        const hi = data.temperature_2m_max[i]
        const lo = data.temperature_2m_min[i]
        const pop = data.precipitation_probability_max[i] ?? 0
        const tag: string | null =
          hi === hottest && i > 0 ? 'warmest' :
          lo === coldest && i > 0 ? 'coldest' :
          pop >= 70 ? 'wet' :
          null
        // Range bar showing today's hi/lo within week's range
        const weekMin = Math.min(...data.temperature_2m_min)
        const weekMax = Math.max(...data.temperature_2m_max)
        const range = weekMax - weekMin || 1
        const left = ((lo - weekMin) / range) * 100
        const width = ((hi - lo) / range) * 100
        return (
          <div
            key={day}
            className="grid grid-cols-[80px_36px_1fr_70px] sm:grid-cols-[100px_36px_1fr_120px] items-center gap-3 p-2 rounded-lg hover:bg-muted/30"
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
                  ${tag === 'warmest' ? 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200' :
                    tag === 'coldest' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200' :
                    'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'}`}>{tag}</span>
              )}
              <span className={pop >= 30 ? 'text-sky-600 dark:text-sky-400' : ''}>💧{pop}%</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
