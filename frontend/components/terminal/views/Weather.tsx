import { Fetched, Note, Table } from '../kit'
import { day } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Forecast {
  place?: { name?: string } | string | null
  current: {
    temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number
    wind_speed_10m: number; wind_gusts_10m: number; precipitation: number
  }
  daily: {
    time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]
    precipitation_probability_max?: number[]
  }
}

export default function Weather() {
  const { data, error, loading } = useResource<Forecast>('/api/weather')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {w => {
        const c = w.current
        const days = w.daily.time.map((t, i) => ({
          t, hi: w.daily.temperature_2m_max[i], lo: w.daily.temperature_2m_min[i],
          rain: w.daily.precipitation_probability_max?.[i] ?? null,
        }))
        return (
          <div className="space-y-3">
            <div className="flex items-baseline gap-3 tabular-nums">
              <span className="text-2xl font-bold">{Math.round(c.temperature_2m)}°F</span>
              <span className="text-[12px] text-muted-foreground">
                feels {Math.round(c.apparent_temperature)}° · humidity {c.relative_humidity_2m}% ·
                wind {Math.round(c.wind_speed_10m)} mph, gusts {Math.round(c.wind_gusts_10m)}
              </span>
            </div>
            <Table
              rows={days}
              rowKey={r => r.t}
              columns={[
                { head: 'Day', align: 'left', cell: r => day(r.t) },
                { head: 'High', cell: r => `${Math.round(r.hi)}°` },
                { head: 'Low', cell: r => `${Math.round(r.lo)}°` },
                { head: 'Rain chance', cell: r => (r.rain == null ? '—' : `${r.rain}%`) },
              ]}
            />
            <Note>Chicago. The Weather page has the full forecast and hazard map.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
