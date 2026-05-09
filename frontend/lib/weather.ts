// WMO weather code → human label + emoji.
// Source: https://open-meteo.com/en/docs (WMO 4677)
export interface Condition {
  label: string
  emoji: string
}

const WMO: Record<number, Condition> = {
  0:  { label: 'Clear',                emoji: '☀️' },
  1:  { label: 'Mostly clear',         emoji: '🌤️' },
  2:  { label: 'Partly cloudy',        emoji: '⛅' },
  3:  { label: 'Overcast',             emoji: '☁️' },
  45: { label: 'Fog',                  emoji: '🌫️' },
  48: { label: 'Rime fog',             emoji: '🌫️' },
  51: { label: 'Light drizzle',        emoji: '🌦️' },
  53: { label: 'Drizzle',              emoji: '🌦️' },
  55: { label: 'Heavy drizzle',        emoji: '🌧️' },
  56: { label: 'Freezing drizzle',     emoji: '🌧️' },
  57: { label: 'Freezing drizzle',     emoji: '🌧️' },
  61: { label: 'Light rain',           emoji: '🌦️' },
  63: { label: 'Rain',                 emoji: '🌧️' },
  65: { label: 'Heavy rain',           emoji: '🌧️' },
  66: { label: 'Freezing rain',        emoji: '🌧️' },
  67: { label: 'Freezing rain',        emoji: '🌧️' },
  71: { label: 'Light snow',           emoji: '🌨️' },
  73: { label: 'Snow',                 emoji: '❄️' },
  75: { label: 'Heavy snow',           emoji: '❄️' },
  77: { label: 'Snow grains',          emoji: '❄️' },
  80: { label: 'Rain showers',         emoji: '🌦️' },
  81: { label: 'Rain showers',         emoji: '🌧️' },
  82: { label: 'Heavy showers',        emoji: '🌧️' },
  85: { label: 'Snow showers',         emoji: '🌨️' },
  86: { label: 'Heavy snow showers',   emoji: '❄️' },
  95: { label: 'Thunderstorm',         emoji: '⛈️' },
  96: { label: 'Thunderstorm + hail',  emoji: '⛈️' },
  99: { label: 'Thunderstorm + hail',  emoji: '⛈️' },
}

export function describeWeather(code: number | null | undefined): Condition {
  if (code == null) return { label: 'Unknown', emoji: '❓' }
  return WMO[code] ?? { label: 'Unknown', emoji: '❓' }
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export function compass(deg: number | null | undefined): string {
  if (deg == null) return ''
  return DIRS[Math.round(deg / 45) % 8]
}

// ── Visual theming ──────────────────────────────────────────────────────────
// Maps WMO code + day/night to a gradient and an animation kind.

export type AtmoKind = 'clear-day' | 'clear-night' | 'cloudy-day' | 'cloudy-night'
                    | 'rain' | 'snow' | 'thunder' | 'fog'

export interface Atmosphere {
  kind: AtmoKind
  gradient: string  // CSS background-image
  accent: string    // text color hint
  animation: 'sun' | 'moon' | 'clouds' | 'rain' | 'snow' | 'lightning' | 'fog' | 'none'
}

export function atmosphereFor(code: number | null | undefined, isDay: boolean): Atmosphere {
  const c = code ?? 0
  // Thunderstorm — overrides everything
  if (c >= 95) return {
    kind: 'thunder',
    gradient: 'linear-gradient(135deg, #1f2640 0%, #3d2c5a 50%, #1a1730 100%)',
    accent: 'text-violet-100',
    animation: 'lightning',
  }
  // Snow
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return {
    kind: 'snow',
    gradient: 'linear-gradient(135deg, #c5d3e0 0%, #98aec7 100%)',
    accent: 'text-slate-900',
    animation: 'snow',
  }
  // Rain / drizzle / showers
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return {
    kind: 'rain',
    gradient: 'linear-gradient(135deg, #4a5868 0%, #2c3e50 100%)',
    accent: 'text-sky-100',
    animation: 'rain',
  }
  // Fog
  if (c === 45 || c === 48) return {
    kind: 'fog',
    gradient: 'linear-gradient(135deg, #b8c0c8 0%, #8a96a3 100%)',
    accent: 'text-slate-900',
    animation: 'fog',
  }
  // Overcast / cloudy
  if (c === 3) return {
    kind: isDay ? 'cloudy-day' : 'cloudy-night',
    gradient: isDay
      ? 'linear-gradient(135deg, #8aa1b8 0%, #5e7791 100%)'
      : 'linear-gradient(135deg, #2b3a4d 0%, #1a2533 100%)',
    accent: isDay ? 'text-slate-50' : 'text-slate-100',
    animation: 'clouds',
  }
  // Partly cloudy
  if (c === 1 || c === 2) return {
    kind: isDay ? 'cloudy-day' : 'cloudy-night',
    gradient: isDay
      ? 'linear-gradient(135deg, #5cb0e8 0%, #87ceeb 50%, #b6d8f0 100%)'
      : 'linear-gradient(135deg, #1e2c4a 0%, #2c3e6b 100%)',
    accent: isDay ? 'text-blue-50' : 'text-indigo-100',
    animation: 'clouds',
  }
  // Clear
  return {
    kind: isDay ? 'clear-day' : 'clear-night',
    gradient: isDay
      ? 'linear-gradient(135deg, #ffb74d 0%, #ffd54f 35%, #4fc3f7 100%)'
      : 'linear-gradient(180deg, #0f1839 0%, #1e2954 50%, #2d3766 100%)',
    accent: isDay ? 'text-amber-50' : 'text-indigo-100',
    animation: isDay ? 'sun' : 'moon',
  }
}

// ── Moon phase ──────────────────────────────────────────────────────────────
// Conway's algorithm — accurate to ~1 day.

export interface MoonPhase {
  phase: number      // 0..1
  illumination: number  // 0..100 (%)
  name: string
  emoji: string
}

export function moonPhase(date = new Date()): MoonPhase {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth() + 1
  const d = date.getUTCDate()
  let r = y % 100
  r %= 19
  if (r > 9) r -= 19
  r = ((r * 11) % 30) + m + d
  if (m < 3) r += 2
  r -= ((y < 2000) ? 4 : 8.3)
  r = Math.floor(r + 0.5) % 30
  const phase = (r < 0 ? r + 30 : r) / 29.53
  const illumination = Math.round(50 * (1 - Math.cos(2 * Math.PI * phase)))

  // Pick name + emoji
  if (phase < 0.03 || phase > 0.97) return { phase, illumination, name: 'New Moon',         emoji: '🌑' }
  if (phase < 0.22)                  return { phase, illumination, name: 'Waxing Crescent',  emoji: '🌒' }
  if (phase < 0.28)                  return { phase, illumination, name: 'First Quarter',    emoji: '🌓' }
  if (phase < 0.47)                  return { phase, illumination, name: 'Waxing Gibbous',   emoji: '🌔' }
  if (phase < 0.53)                  return { phase, illumination, name: 'Full Moon',        emoji: '🌕' }
  if (phase < 0.72)                  return { phase, illumination, name: 'Waning Gibbous',   emoji: '🌖' }
  if (phase < 0.78)                  return { phase, illumination, name: 'Last Quarter',     emoji: '🌗' }
  return                                    { phase, illumination, name: 'Waning Crescent',  emoji: '🌘' }
}

// ── AQI ─────────────────────────────────────────────────────────────────────

export function aqiCategory(aqi: number | null | undefined): { label: string; color: string; bg: string } {
  if (aqi == null) return { label: 'Unknown', color: 'text-muted-foreground', bg: 'bg-muted' }
  if (aqi <= 50)  return { label: 'Good',                   color: 'text-emerald-50', bg: 'bg-emerald-600' }
  if (aqi <= 100) return { label: 'Moderate',               color: 'text-yellow-950', bg: 'bg-yellow-400' }
  if (aqi <= 150) return { label: 'Unhealthy for sensitive', color: 'text-orange-50',  bg: 'bg-orange-500' }
  if (aqi <= 200) return { label: 'Unhealthy',              color: 'text-red-50',     bg: 'bg-red-600' }
  if (aqi <= 300) return { label: 'Very unhealthy',         color: 'text-purple-50',  bg: 'bg-purple-700' }
  return            { label: 'Hazardous',                   color: 'text-red-50',     bg: 'bg-rose-900' }
}
