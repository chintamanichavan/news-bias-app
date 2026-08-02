'use client'

import { aqiCategory } from '@/lib/weather'
import { readPollutant, type PollutantKey } from '@/lib/aqi'

interface CurrentAQ {
  us_aqi: number
  pm2_5: number
  pm10: number
  ozone: number
  nitrogen_dioxide: number
  sulphur_dioxide: number
  carbon_monoxide: number
  uv_index: number
}

interface HourlyAQ {
  time: string[]
  alder_pollen: (number | null)[]
  birch_pollen: (number | null)[]
  grass_pollen: (number | null)[]
  mugwort_pollen: (number | null)[]
  olive_pollen: (number | null)[]
  ragweed_pollen: (number | null)[]
}

interface Props {
  current: CurrentAQ | null
  hourly?: HourlyAQ | null
  /** Detail-page mode — larger headline + thicker bars. */
  expanded?: boolean
}

const POLLUTANT_ORDER: { key: PollutantKey; source: keyof CurrentAQ }[] = [
  { key: 'pm2_5', source: 'pm2_5' },
  { key: 'pm10',  source: 'pm10'  },
  { key: 'o3',    source: 'ozone' },
  { key: 'no2',   source: 'nitrogen_dioxide' },
  { key: 'so2',   source: 'sulphur_dioxide' },
  { key: 'co',    source: 'carbon_monoxide' },
]

const POLLEN_SPECIES: { key: keyof HourlyAQ; label: string }[] = [
  { key: 'alder_pollen',   label: 'Alder' },
  { key: 'birch_pollen',   label: 'Birch' },
  { key: 'grass_pollen',   label: 'Grass' },
  { key: 'mugwort_pollen', label: 'Mugwort' },
  { key: 'olive_pollen',   label: 'Olive' },
  { key: 'ragweed_pollen', label: 'Ragweed' },
]

function pollenBand(grains: number): { label: string; tone: string } {
  if (grains <= 5)  return { label: 'Low',       tone: 'bg-emerald-400' }
  if (grains <= 20) return { label: 'Moderate',  tone: 'bg-yellow-400'  }
  if (grains <= 50) return { label: 'High',      tone: 'bg-orange-500'  }
  return                  { label: 'Very high', tone: 'bg-red-600'     }
}

export default function AirQualityCard({ current, hourly, expanded = false }: Props) {
  if (!current) {
    return <p className="text-sm text-muted-foreground">No air-quality data available.</p>
  }
  const aqi = aqiCategory(current.us_aqi)
  const readings = POLLUTANT_ORDER
    .map(({ key, source }) => readPollutant(key, current[source] as number))
    .filter((r): r is NonNullable<typeof r> => r !== null)

  // Top driver: pollutant with the highest subindex (i.e. what's hurting today's AQI)
  const driver = readings.reduce(
    (a, b) => (b.subindex > a.subindex ? b : a),
    readings[0],
  )

  // Per-species daily peak from hourly arrays
  const pollens: { label: string; peak: number }[] = hourly
    ? POLLEN_SPECIES
        .map(({ key, label }) => {
          const arr = (hourly[key] || []) as (number | null)[]
          let peak = 0
          for (const v of arr) if (v != null && v > peak) peak = v
          return { label, peak }
        })
        .filter(p => p.peak > 1)
        .sort((a, b) => b.peak - a.peak)
    : []

  return (
    <div className="h-full flex flex-col">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
        Air quality
      </h2>

      {/* AQI hero */}
      <div className={`flex items-end gap-${expanded ? '5' : '3'} mb-1`}>
        <div className={`${expanded ? 'px-5 py-3' : 'px-3 py-2'} rounded-lg ${aqi.bg} ${aqi.color}`}>
          <div className={`${expanded ? 'text-6xl' : 'text-3xl'} font-bold tabular-nums leading-none`}>{current.us_aqi}</div>
          <div className={`${expanded ? 'text-xs mt-2' : 'text-[10px] mt-1'} uppercase tracking-wider opacity-90`}>US AQI</div>
        </div>
        <div className="pb-1 flex-1">
          <div className={`${expanded ? 'text-xl' : 'text-sm'} font-medium leading-tight`}>{aqi.label}</div>
          {driver && (
            <div className={`${expanded ? 'text-sm mt-1.5' : 'text-[11px] mt-0.5'} text-muted-foreground leading-tight`}>
              driver: <span className="font-medium">{driver.label}</span>
            </div>
          )}
        </div>
      </div>

      {/* Pollutant bars — EPA-normalized */}
      <div className="space-y-1.5 mt-3">
        {readings.map(r => (
          <div key={r.key} className="grid grid-cols-[56px_1fr_72px] items-center gap-2 text-xs">
            <span className="text-muted-foreground tabular-nums">{r.label}</span>
            <div className="relative h-2 rounded-full bg-muted/40 overflow-hidden">
              {/* Tick at the "Moderate ceiling" (= 100% subindex). Anything past
                  it is plainly unhealthy and we color the bar accordingly. */}
              <div
                className={`absolute inset-y-0 left-0 ${r.bandColor} rounded-full`}
                style={{ width: `${Math.min(100, (r.fraction / 2) * 100)}%` }}
              />
              <div className="absolute inset-y-0 w-px bg-foreground/30 left-1/2" />
            </div>
            <span className="text-right tabular-nums text-muted-foreground">{r.display}</span>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground/80 pt-1">
          The vertical tick marks where readings cross into &ldquo;moderate&rdquo;; bars past it are unhealthy.
        </p>
      </div>

      {/* Pollen strip */}
      {pollens.length > 0 && (
        <div className="mt-4 pt-3 border-t border-border/60">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Pollen — today&rsquo;s peak
          </div>
          <div className="space-y-1">
            {pollens.slice(0, 4).map(p => {
              const band = pollenBand(p.peak)
              const fillPct = Math.min(100, (p.peak / 50) * 100)
              return (
                <div key={p.label} className="grid grid-cols-[56px_1fr_44px] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{p.label}</span>
                  <div className="relative h-1.5 rounded-full bg-muted/40 overflow-hidden">
                    <div className={`absolute inset-y-0 left-0 ${band.tone} rounded-full`} style={{ width: `${fillPct}%` }} />
                  </div>
                  <span className="text-right tabular-nums text-muted-foreground">{p.peak.toFixed(0)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
