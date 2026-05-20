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
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    sunrise: string[]
    sunset: string[]
    uv_index_max: (number | null)[]
    wind_speed_10m_max: number[]
    wind_gusts_10m_max: number[]
    precipitation_probability_max: (number | null)[]
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

const METRICS: Record<string, { label: string; blurb: string; about: string[] }> = {
  aqi: {
    label: 'Air Quality',
    blurb: 'Pollutant load + dominant driver, with a dew-point–scale pollen strip.',
    about: [
      "The US Air Quality Index combines six pollutants (PM2.5, PM10, ozone, NO₂, SO₂, CO) on a 0–500 scale.",
      "0–50 Good · 51–100 Moderate · 101–150 Unhealthy for sensitive groups · 151–200 Unhealthy · 201–300 Very unhealthy · 300+ Hazardous.",
      "Open-Meteo updates hourly; values shown here are EPA-normalized from each pollutant's µg/m³ concentration.",
    ],
  },
  wind: {
    label: 'Wind',
    blurb: 'Sustained and gust forecasts over the next 48 hours, with the directional compass.',
    about: [
      "Sustained wind is the steady speed averaged over 10 minutes; gusts are short peaks (typically 3-second).",
      "Operational break points: 25 mph small branches stir · 39 mph (Beaufort 8) driving becomes difficult · 58 mph reaches severe thunderstorm criteria.",
    ],
  },
  pressure: {
    label: 'Pressure',
    blurb: 'Mean-sea-level pressure trajectory. The 3-hour tendency hints at incoming weather.',
    about: [
      "Mean-sea-level pressure (MSL) standardizes for elevation so values are comparable across locations.",
      "ISA reference is 1013.25 hPa. Falling pressure typically precedes weather degradation; rising pressure brings clearing. ±2 hPa over 3 hours is the meteorological 'fast' threshold.",
    ],
  },
  humidity: {
    label: 'Humidity',
    blurb: 'Dew-point comfort over the day. Background bands map to NOAA comfort tiers.',
    about: [
      "Dew point is the meaningful 'stickiness' metric — unlike relative humidity, it doesn't lie at different temperatures.",
      "Below 55°F: dry · 55-60°F: pleasant · 60-65°F: noticeable · 65-70°F: sticky · 70-75°F: oppressive · 75°F+: tropical.",
    ],
  },
  cloud: {
    label: 'Cloud Cover',
    blurb: '48-hour cloud cover. Yellow wash marks daylight hours.',
    about: [
      "Total cloud cover by area: <12% clear · 12-38% mostly clear · 38-62% partly cloudy · 62-88% mostly cloudy · 88%+ overcast.",
      "'Sunny hours' counts daytime hours with ≤25% cover — a usable proxy for direct-light exposure.",
    ],
  },
  visibility: {
    label: 'Visibility',
    blurb: 'Visibility in miles; shaded bands mark hazy / mist / fog / dense-fog ranges.',
    about: [
      "Open-Meteo reports visibility in meters; we convert to miles. Most clear days are at the 10+ mile sensor ceiling.",
      ">10 mi unrestricted · 6-10 mi hazy · 3-6 mi mist · 1-3 mi fog · <1 mi dense fog (driving advisory-worthy).",
    ],
  },
  uv: {
    label: 'UV Index',
    blurb: "Today's UV curve against the WHO risk-band background, plus weekly peak outlook.",
    about: [
      "WHO UV index: 0-2 low (no protection) · 3-5 moderate (SPF 30, hat) · 6-7 high · 8-10 very high (minimize 11am-3pm) · 11+ extreme.",
      "Burn time roughly halves for each step up from 3 — at UV 8, fair skin burns in ~15 minutes.",
    ],
  },
  'sun-moon': {
    label: 'Sun & Moon',
    blurb: "Today's sun arc, day length, the moon phase, and a 7-day rise/set table.",
    about: [
      "Day length is calculated from sunrise to sunset (excludes twilight). Around solstices the day-over-day delta is near zero; around equinoxes it changes by ~2.5 minutes/day.",
      "Moon phase uses Conway's algorithm — accurate to within a day.",
    ],
  },
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
    inner = <AirQualityCard expanded current={data.air_quality?.current ?? null} hourly={data.air_quality?.hourly ?? null} />
  } else if (metric === 'wind') {
    const sustained = slice48(data.hourly.wind_speed_10m)
    const gusts = slice48(data.hourly.wind_gusts_10m)
    const hourly = sustained && gusts ? { sustained: sustained.values, gusts: gusts.values, times: sustained.times } : null
    inner = (
      <WindCard
        expanded
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
    inner = <PressureCard expanded current={cur.pressure_msl} trend3h={trend3h} series={series} />
  } else if (metric === 'humidity') {
    const rh = slice48(data.hourly.relative_humidity_2m)
    const dew = slice48(data.hourly.dew_point_2m)
    const hourly = rh && dew ? { dewF: dew.values, rh: rh.values, times: rh.times } : null
    inner = <HumidityCard expanded currentRh={cur.relative_humidity_2m} currentDewF={cur.dew_point_2m} hourly={hourly} />
  } else if (metric === 'cloud') {
    const cover = slice48(data.hourly.cloud_cover)
    const isDay = slice48<0 | 1>(data.hourly.is_day)
    const hourly = cover && isDay ? { cover: cover.values, isDay: isDay.values, times: cover.times } : null
    inner = <CloudCard expanded current={cur.cloud_cover} hourly={hourly} />
  } else if (metric === 'visibility') {
    const v = slice48(data.hourly.visibility)
    const hourly = v ? { meters: v.values, times: v.times } : null
    inner = <VisibilityCard expanded currentM={cur.visibility} hourly={hourly} />
  } else if (metric === 'uv') {
    const v = slice48(data.hourly.uv_index)
    const hourly = v ? { uv: v.values, times: v.times } : null
    inner = <UVCard expanded current={data.air_quality?.current?.uv_index ?? today0.uv} hourly={hourly} />
  } else if (metric === 'sun-moon') {
    inner = (
      <SunMoonCard
        expanded
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
      {/* 1. Primary expanded card */}
      <Card>
        <div className="p-6 sm:p-8">
          {inner}
        </div>
      </Card>

      {/* 2. Multi-day outlook (when daily data is available for the metric) */}
      {metric === 'wind' && (
        <MultiDayStrip
          title="7-day peak gusts"
          unit="mph"
          days={data.daily.time.map((d, i) => ({
            label: dayLabel(d, i),
            primary: Math.round(data.daily.wind_gusts_10m_max[i]),
            secondary: `${Math.round(data.daily.wind_speed_10m_max[i])} sustained`,
          }))}
        />
      )}
      {metric === 'uv' && (
        <MultiDayStrip
          title="7-day peak UV"
          unit=""
          days={data.daily.time.map((d, i) => ({
            label: dayLabel(d, i),
            primary: data.daily.uv_index_max[i] != null ? (data.daily.uv_index_max[i] as number).toFixed(1) : '—',
            secondary: uvBand(data.daily.uv_index_max[i] ?? 0),
          }))}
        />
      )}
      {metric === 'sun-moon' && (
        <MultiDayStrip
          title="7-day sun"
          unit=""
          days={data.daily.time.map((d, i) => ({
            label: dayLabel(d, i),
            primary: fmtClock(data.daily.sunrise[i]),
            secondary: `set ${fmtClock(data.daily.sunset[i])}`,
          }))}
        />
      )}

      {/* 3. About — explainer with thresholds / reading guide */}
      <Card>
        <div className="p-6 sm:p-8">
          <p className="news-section-label mb-3">About</p>
          <div className="space-y-3 text-[14px] leading-relaxed text-foreground/85 max-w-prose">
            {meta.about.map((p, i) => <p key={i}>{p}</p>)}
          </div>
        </div>
      </Card>
    </DetailLayout>
  )
}

function dayLabel(iso: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tomorrow'
  return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' })
}

function fmtClock(iso: string | undefined | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function uvBand(uv: number): string {
  if (uv < 3)  return 'Low'
  if (uv < 6)  return 'Moderate'
  if (uv < 8)  return 'High'
  if (uv < 11) return 'Very high'
  return 'Extreme'
}

function MultiDayStrip({
  title, unit, days,
}: {
  title: string
  unit: string
  days: { label: string; primary: number | string; secondary?: string }[]
}) {
  return (
    <Card>
      <div className="p-6 sm:p-8">
        <p className="news-section-label mb-4">{title}</p>
        <div className="grid grid-cols-7 gap-2 sm:gap-3">
          {days.slice(0, 7).map((d, i) => (
            <div key={i} className="text-center">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{d.label}</div>
              <div className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight">{d.primary}{unit && <span className="text-[10px] font-normal text-muted-foreground ml-0.5">{unit}</span>}</div>
              {d.secondary && (
                <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">{d.secondary}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Card>
  )
}

function DetailLayout({ label, blurb, children }: { label: string; blurb: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="mb-2">
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
