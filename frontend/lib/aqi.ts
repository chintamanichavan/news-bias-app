// EPA-style AQI breakpoints, expressed in the units Open-Meteo returns:
//   PM2.5, PM10, O3, NO2, SO2  →  µg/m³
//   CO                          →  µg/m³ (Open-Meteo doesn't return mg/m³)
//
// For gases (O3/NO2/SO2/CO), the EPA's official breakpoints are in ppb/ppm with
// specific averaging windows we don't have (8-hr O3, 1-hr NO2/SO2, 8-hr CO).
// We translate to instantaneous µg/m³ at 25 °C / 1 atm (standard EPA assumption)
// so a viewer gets a usable "where is this pollutant on the unhealthy ladder"
// at a glance. This is **not** intended to be an exact regulatory AQI.
//
// Each row: pollutant value at the upper edge of each AQI category band.
// Categories: Good(50) / Moderate(100) / USG(150) / Unhealthy(200) / Very(300) / Hazardous(500).

export type PollutantKey = 'pm2_5' | 'pm10' | 'o3' | 'no2' | 'so2' | 'co'

interface Breakpoint {
  // upper edge of each band's concentration; AQI of that edge follows AQI_BANDS
  edges: number[]
  unit: string
  label: string
}

const AQI_BANDS = [50, 100, 150, 200, 300, 500]

const BREAKPOINTS: Record<PollutantKey, Breakpoint> = {
  // EPA PM2.5 24-hr (µg/m³): 12.0 / 35.4 / 55.4 / 150.4 / 250.4 / 500.4
  pm2_5: { edges: [12, 35.4, 55.4, 150.4, 250.4, 500.4], unit: 'µg/m³', label: 'PM2.5' },
  // EPA PM10 24-hr (µg/m³): 54 / 154 / 254 / 354 / 424 / 604
  pm10:  { edges: [54, 154, 254, 354, 424, 604],         unit: 'µg/m³', label: 'PM10' },
  // EPA O3 8-hr ppb × 1.96 (µg/m³ at 25 °C): 106 / 137 / 167 / 206 / 392 / —
  // No 500-cutoff for ozone in EPA; we extend the top band linearly.
  o3:    { edges: [106, 137, 167, 206, 392, 600],        unit: 'µg/m³', label: 'O₃' },
  // EPA NO2 1-hr ppb × 1.88 (µg/m³): 100 / 188 / 677 / 1220 / 2348 / 3853
  no2:   { edges: [100, 188, 677, 1220, 2348, 3853],     unit: 'µg/m³', label: 'NO₂' },
  // EPA SO2 1-hr ppb × 2.62 (µg/m³): 92 / 197 / 484 / 797 / 1582 / 2107
  so2:   { edges: [92, 197, 484, 797, 1582, 2107],       unit: 'µg/m³', label: 'SO₂' },
  // EPA CO 8-hr ppm × 1145 (µg/m³): 5040 / 10760 / 14200 / 17630 / 34800 / 57700
  co:    { edges: [5040, 10760, 14200, 17630, 34800, 57700], unit: 'µg/m³', label: 'CO' },
}

export interface PollutantReading {
  key: PollutantKey
  label: string
  value: number          // raw µg/m³
  display: string        // formatted "12.3 µg/m³"
  subindex: number       // 0..500 AQI subindex
  /** 0..1 fraction of the unhealthy ceiling (subindex / 100). >1 means already unhealthy. */
  fraction: number
  bandLabel: string      // Good / Moderate / ...
  bandColor: string      // tailwind bg utility for the bar fill
  bandTextColor: string  // tailwind text utility for the label
}

const BAND_COLORS = [
  { bg: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300', label: 'Good' },
  { bg: 'bg-yellow-400',  text: 'text-yellow-700 dark:text-yellow-300',   label: 'Moderate' },
  { bg: 'bg-orange-500',  text: 'text-orange-700 dark:text-orange-300',   label: 'USG' },
  { bg: 'bg-red-600',     text: 'text-red-700 dark:text-red-300',         label: 'Unhealthy' },
  { bg: 'bg-purple-700',  text: 'text-purple-700 dark:text-purple-300',   label: 'Very unhealthy' },
  { bg: 'bg-rose-900',    text: 'text-rose-700 dark:text-rose-300',       label: 'Hazardous' },
]

/** Convert a pollutant concentration into an AQI subindex (0–500) using the
 *  piecewise-linear EPA breakpoint table. */
function toSubindex(key: PollutantKey, value: number): number {
  const bp = BREAKPOINTS[key]
  let prevEdge = 0
  let prevAqi = 0
  for (let i = 0; i < bp.edges.length; i++) {
    const edge = bp.edges[i]
    const aqi = AQI_BANDS[i]
    if (value <= edge) {
      // linear interp between (prevEdge, prevAqi) and (edge, aqi)
      const span = edge - prevEdge || 1
      return prevAqi + ((value - prevEdge) / span) * (aqi - prevAqi)
    }
    prevEdge = edge
    prevAqi = aqi
  }
  // Above the top edge — clamp at 500
  return 500
}

function bandFor(subindex: number) {
  if (subindex <= 50)  return BAND_COLORS[0]
  if (subindex <= 100) return BAND_COLORS[1]
  if (subindex <= 150) return BAND_COLORS[2]
  if (subindex <= 200) return BAND_COLORS[3]
  if (subindex <= 300) return BAND_COLORS[4]
  return BAND_COLORS[5]
}

function formatValue(value: number, unit: string): string {
  if (value >= 1000) return `${value.toFixed(0)} ${unit}`
  if (value >= 100) return `${value.toFixed(0)} ${unit}`
  return `${value.toFixed(1)} ${unit}`
}

export function readPollutant(key: PollutantKey, value: number | null | undefined): PollutantReading | null {
  if (value == null || !Number.isFinite(value)) return null
  const bp = BREAKPOINTS[key]
  const subindex = toSubindex(key, value)
  const band = bandFor(subindex)
  return {
    key,
    label: bp.label,
    value,
    display: formatValue(value, bp.unit),
    subindex,
    // 100 = "Moderate ceiling" = where things stop being plainly Good.
    // Cap visualisation fraction at 2 so an extreme outlier still draws something.
    fraction: Math.min(2, subindex / 100),
    bandLabel: band.label,
    bandColor: band.bg,
    bandTextColor: band.text,
  }
}
