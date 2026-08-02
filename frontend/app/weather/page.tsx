'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import AtmosphericHero from '@/components/AtmosphericHero'
import HourlyTempCurve from '@/components/HourlyTempCurve'
import AirQualityCard from '@/components/AirQualityCard'
import WindCard from '@/components/WindCard'
import PressureCard from '@/components/PressureCard'
import HumidityCard from '@/components/HumidityCard'
import CloudCard from '@/components/CloudCard'
import VisibilityCard from '@/components/VisibilityCard'
import UVCard from '@/components/UVCard'
import SunMoonCard from '@/components/SunMoonCard'
import NowCastBanner from '@/components/NowCastBanner'
import { describeWeather } from '@/lib/weather'

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
    relative_humidity_2m: number[]
    dew_point_2m: number[]
    precipitation_probability: number[]
    precipitation: number[]
    weather_code: number[]
    wind_speed_10m: number[]
    wind_gusts_10m: number[]
    wind_direction_10m: number[]
    surface_pressure: number[]
    pressure_msl: number[]
    cloud_cover: number[]
    visibility: number[]
    uv_index: number[]
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
      nitrogen_dioxide: number
      sulphur_dioxide: number
      carbon_monoxide: number
      uv_index: number
    } | null
    hourly?: {
      time: string[]
      us_aqi: (number | null)[]
      alder_pollen: (number | null)[]
      birch_pollen: (number | null)[]
      grass_pollen: (number | null)[]
      mugwort_pollen: (number | null)[]
      olive_pollen: (number | null)[]
      ragweed_pollen: (number | null)[]
    }
  } | null
}

function fmtDay(iso: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tomorrow'
  return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' })
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


  if (loading && !data) {
    return (
      <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-6">
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
      <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-20 text-center">
        <p className="text-lg font-medium">Couldn&rsquo;t load weather</p>
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
  const aqHourly = data.air_quality?.hourly ?? null

  // 24h wind slice starting at the current hour, for the WindCard band chart
  const windHourly = (() => {
    if (!data.hourly?.wind_speed_10m || !data.hourly?.wind_gusts_10m) return null
    const nowIso = cur.time
    const start = Math.max(0, data.hourly.time.findIndex(t => t >= nowIso))
    const end = Math.min(start + 24, data.hourly.time.length)
    if (end - start < 2) return null
    return {
      sustained: data.hourly.wind_speed_10m.slice(start, end),
      gusts: data.hourly.wind_gusts_10m.slice(start, end),
      times: data.hourly.time.slice(start, end),
    }
  })()

  // Generic next-24h slicer using "now" as the anchor.
  const sliceNext24 = <T,>(arr: T[] | undefined): { values: T[]; times: string[] } | null => {
    if (!arr || !arr.length) return null
    const nowIso = cur.time
    const start = Math.max(0, data.hourly.time.findIndex(t => t >= nowIso))
    const end = Math.min(start + 24, data.hourly.time.length)
    if (end - start < 2) return null
    return { values: arr.slice(start, end), times: data.hourly.time.slice(start, end) }
  }

  // 24h humidity slice for HumidityCard
  const humidityHourly = (() => {
    const rh = sliceNext24(data.hourly?.relative_humidity_2m)
    const dew = sliceNext24(data.hourly?.dew_point_2m)
    if (!rh || !dew) return null
    return { rh: rh.values, dewF: dew.values, times: rh.times }
  })()

  // 24h cloud cover + day-flag slice for CloudCard
  const cloudHourly = (() => {
    const cover = sliceNext24(data.hourly?.cloud_cover)
    const isDay = sliceNext24<0 | 1>(data.hourly?.is_day)
    if (!cover || !isDay) return null
    return { cover: cover.values, isDay: isDay.values, times: cover.times }
  })()

  // 24h visibility slice for VisibilityCard
  const visibilityHourly = (() => {
    const v = sliceNext24(data.hourly?.visibility)
    return v ? { meters: v.values, times: v.times } : null
  })()

  // Nowcast inputs — weather code + precip trajectory over next 12h
  const nowcastHourly = (() => {
    const codes = sliceNext24(data.hourly?.weather_code)
    const probs = sliceNext24(data.hourly?.precipitation_probability)
    const precip = sliceNext24(data.hourly?.precipitation)
    if (!codes || !probs || !precip) return null
    return {
      times: codes.times,
      codes: codes.values,
      probs: probs.values,
      precip: precip.values,
    }
  })()

  // 24h UV slice for UVCard
  const uvHourly = (() => {
    const v = sliceNext24(data.hourly?.uv_index)
    return v ? { uv: v.values, times: v.times } : null
  })()

  // Pressure: split the past 3h (for the tendency calc) from the forecast
  // (for the chart) so the chart's index 0 is "now".
  const pressure = (() => {
    const series = data.hourly?.pressure_msl
    if (!series || !series.length) return { trend3h: null as number | null, forecast: null as null | { values: number[]; times: string[] } }
    const nowIso = cur.time
    const nowIdx = Math.max(0, data.hourly.time.findIndex(t => t >= nowIso))
    const past3hIdx = nowIdx - 3
    const trend3h = past3hIdx >= 0 && series[nowIdx] != null && series[past3hIdx] != null
      ? series[nowIdx] - series[past3hIdx]
      : null
    const end = Math.min(nowIdx + 33, data.hourly.time.length)
    const forecast = end - nowIdx >= 2
      ? { values: series.slice(nowIdx, end), times: data.hourly.time.slice(nowIdx, end) }
      : null
    return { trend3h, forecast }
  })()

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-6 space-y-4">
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

      {/* Dark-Sky-style nowcast — one-sentence hyperlocal narrative */}
      <NowCastBanner currentCode={cur.weather_code} hourly={nowcastHourly} />

      {/* Hourly temperature — full width, tap to expand */}
      <Link href="/weather/forecast" className="news-card news-card-hover block p-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Next 24 hours
        </h2>
        <HourlyTempCurve points={next24} />
        <p className="text-[11px] text-muted-foreground mt-1">
          Solid line: temperature · blue bars: precipitation chance · light wash: daylight hours
        </p>
      </Link>

      {/* Atmospheric detail cards — compact summary tiles. Tap one to drill
          into its dedicated detail page for the deep view. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Link href="/weather/aqi" className="news-card news-card-hover block p-4">
          <AirQualityCard current={aq} hourly={aqHourly} />
        </Link>
        <Link href="/weather/wind" className="news-card news-card-hover block p-4">
          <WindCard
            current={cur.wind_speed_10m}
            gust={cur.wind_gusts_10m}
            direction={cur.wind_direction_10m}
            dayPeakGust={today.gusts}
            hourly={windHourly}
          />
        </Link>
        <Link href="/weather/pressure" className="news-card news-card-hover block p-4">
          <PressureCard
            current={cur.pressure_msl}
            trend3h={pressure.trend3h}
            series={pressure.forecast}
          />
        </Link>
        <Link href="/weather/humidity" className="news-card news-card-hover block p-4">
          <HumidityCard
            currentRh={cur.relative_humidity_2m}
            currentDewF={cur.dew_point_2m}
            hourly={humidityHourly}
          />
        </Link>
        <Link href="/weather/cloud" className="news-card news-card-hover block p-4">
          <CloudCard current={cur.cloud_cover} hourly={cloudHourly} />
        </Link>
        <Link href="/weather/visibility" className="news-card news-card-hover block p-4">
          <VisibilityCard currentM={cur.visibility} hourly={visibilityHourly} />
        </Link>
        <Link href="/weather/uv" className="news-card news-card-hover block p-4">
          <UVCard current={aq?.uv_index ?? today.uv ?? 0} hourly={uvHourly} />
        </Link>
        <Link href="/weather/sun-moon" className="news-card news-card-hover block p-4">
          <SunMoonCard
            sunriseToday={today.sunrise}
            sunsetToday={today.sunset}
            sunriseTomorrow={data.daily.sunrise[1] ?? null}
            sunsetTomorrow={data.daily.sunset[1] ?? null}
            now={cur.time}
          />
        </Link>
      </div>

      {/* 7-day */}
      <Link href="/weather/forecast" className="news-card news-card-hover block p-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          7-day forecast
        </h2>
        <DailyForecast data={data.daily} />
      </Link>

      <p className="text-xs text-muted-foreground mt-4 text-center">
        Forecast & air quality from Open-Meteo · cached 10 min · sun arc updates as the day progresses
      </p>
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
