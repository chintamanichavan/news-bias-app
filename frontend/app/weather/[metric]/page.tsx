'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/card'
import AirQualityCard from '@/components/AirQualityCard'
import WindCard from '@/components/WindCard'
import PressureCard from '@/components/PressureCard'
import HumidityCard from '@/components/HumidityCard'
import CloudCard from '@/components/CloudCard'
import VisibilityCard from '@/components/VisibilityCard'
import UVCard from '@/components/UVCard'
import SunMoonCard from '@/components/SunMoonCard'

interface WeatherData {
  place: string
  current: {
    time: string
    temperature_2m: number
    apparent_temperature: number
    relative_humidity_2m: number
    is_day: 0 | 1
    weather_code: number
    wind_speed_10m: number
    wind_direction_10m: number
    wind_gusts_10m: number
    pressure_msl: number
    cloud_cover: number
    visibility: number
    dew_point_2m: number
  }
  hourly: {
    time: string[]
    relative_humidity_2m: number[]
    dew_point_2m: number[]
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
    sunrise: string[]
    sunset: string[]
    uv_index_max: (number | null)[]
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

const METRICS: Record<string, { label: string; blurb: string }> = {
  aqi:        { label: 'Air Quality',  blurb: 'Pollutant load + dominant driver, with a dew-point–scale pollen strip.' },
  wind:       { label: 'Wind',         blurb: 'Sustained and gust forecasts over the next 24 hours, with the directional compass.' },
  pressure:   { label: 'Pressure',     blurb: 'Mean-sea-level pressure trajectory. The 3-hour tendency hints at incoming weather.' },
  humidity:   { label: 'Humidity',     blurb: 'Dew-point comfort over the day. Background bands map to NOAA comfort tiers.' },
  cloud:      { label: 'Cloud Cover',  blurb: '24-hour cloud cover. Yellow wash marks daylight hours.' },
  visibility: { label: 'Visibility',   blurb: 'Visibility in miles; shaded bands mark hazy / mist / fog / dense-fog ranges.' },
  uv:         { label: 'UV Index',     blurb: "Today's UV curve against the WHO risk-band background." },
  'sun-moon': { label: 'Sun & Moon',   blurb: "Today's sun arc, day length, and the moon phase with its lit fraction." },
}

export default function WeatherDetailPage({ params }: { params: { metric: string } }) {
  const { metric } = params
  const meta = METRICS[metric]
  if (!meta) notFound()

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

  if (error) {
    return (
      <DetailLayout label={meta.label} blurb={meta.blurb}>
        <Card><div className="p-6 text-center text-sm text-muted-foreground">Couldn't load weather: {error}</div></Card>
      </DetailLayout>
    )
  }
  if (!data) {
    return (
      <DetailLayout label={meta.label} blurb={meta.blurb}>
        <Card><div className="p-6 h-64 bg-muted/30 animate-pulse rounded-2xl" /></Card>
      </DetailLayout>
    )
  }

  const cur = data.current
  const today0 = {
    sunrise: data.daily.sunrise[0],
    sunset:  data.daily.sunset[0],
    uv:      data.daily.uv_index_max[0] ?? 0,
    gusts:   data.daily.wind_gusts_10m_max[0],
  }

  // 48h slice — twice the main-page window so the detail page actually shows
  // more than the tile did. Charts auto-scale to whatever they're given.
  function slice48<T>(arr: T[] | undefined): { values: T[]; times: string[] } | null {
    if (!arr || !arr.length) return null
    const start = Math.max(0, data!.hourly.time.findIndex(t => t >= cur.time))
    const end = Math.min(start + 48, data!.hourly.time.length)
    if (end - start < 2) return null
    return { values: arr.slice(start, end), times: data!.hourly.time.slice(start, end) }
  }

  let inner: React.ReactNode = null

  if (metric === 'aqi') {
    inner = <AirQualityCard current={data.air_quality?.current ?? null} hourly={data.air_quality?.hourly ?? null} />
  } else if (metric === 'wind') {
    const sustained = slice48(data.hourly.wind_speed_10m)
    const gusts = slice48(data.hourly.wind_gusts_10m)
    const hourly = sustained && gusts ? { sustained: sustained.values, gusts: gusts.values, times: sustained.times } : null
    inner = (
      <WindCard
        current={cur.wind_speed_10m}
        gust={cur.wind_gusts_10m}
        direction={cur.wind_direction_10m}
        dayPeakGust={today0.gusts}
        hourly={hourly}
      />
    )
  } else if (metric === 'pressure') {
    const series = slice48(data.hourly.pressure_msl)
    const nowIdx = Math.max(0, data.hourly.time.findIndex(t => t >= cur.time))
    const past3hIdx = nowIdx - 3
    const trend3h = past3hIdx >= 0 && data.hourly.pressure_msl[nowIdx] != null && data.hourly.pressure_msl[past3hIdx] != null
      ? data.hourly.pressure_msl[nowIdx] - data.hourly.pressure_msl[past3hIdx]
      : null
    inner = <PressureCard current={cur.pressure_msl} trend3h={trend3h} series={series} />
  } else if (metric === 'humidity') {
    const rh = slice48(data.hourly.relative_humidity_2m)
    const dew = slice48(data.hourly.dew_point_2m)
    const hourly = rh && dew ? { dewF: dew.values, rh: rh.values, times: rh.times } : null
    inner = <HumidityCard currentRh={cur.relative_humidity_2m} currentDewF={cur.dew_point_2m} hourly={hourly} />
  } else if (metric === 'cloud') {
    const cover = slice48(data.hourly.cloud_cover)
    const isDay = slice48<0 | 1>(data.hourly.is_day)
    const hourly = cover && isDay ? { cover: cover.values, isDay: isDay.values, times: cover.times } : null
    inner = <CloudCard current={cur.cloud_cover} hourly={hourly} />
  } else if (metric === 'visibility') {
    const v = slice48(data.hourly.visibility)
    const hourly = v ? { meters: v.values, times: v.times } : null
    inner = <VisibilityCard currentM={cur.visibility} hourly={hourly} />
  } else if (metric === 'uv') {
    const v = slice48(data.hourly.uv_index)
    const hourly = v ? { uv: v.values, times: v.times } : null
    inner = <UVCard current={data.air_quality?.current?.uv_index ?? today0.uv} hourly={hourly} />
  } else if (metric === 'sun-moon') {
    inner = (
      <SunMoonCard
        sunriseToday={today0.sunrise}
        sunsetToday={today0.sunset}
        sunriseTomorrow={data.daily.sunrise[1] ?? null}
        sunsetTomorrow={data.daily.sunset[1] ?? null}
        now={cur.time}
      />
    )
  }

  return (
    <DetailLayout label={meta.label} blurb={meta.blurb}>
      <Card>
        <div className="p-6 sm:p-8">
          {inner}
        </div>
      </Card>
    </DetailLayout>
  )
}

function DetailLayout({ label, blurb, children }: { label: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-6">
        <Link
          href="/weather"
          className="inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          ← Weather
        </Link>
        <p className="news-section-label">Detail</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">{label}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-prose">{blurb}</p>
      </div>
      {children}
    </div>
  )
}
