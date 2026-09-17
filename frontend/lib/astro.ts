// On-device solar + lunar astronomy — no API calls, mirroring how Lumy/Moonlitt
// compute everything locally. Formulas follow Astronomy on the Personal Computer
// (Montenbruck & Pfleger) via the compact SunCalc formulation; sun times are
// good to ~1 min, moon times to ~2 min, phase to well under an hour.

const rad = Math.PI / 180
const DAY_MS = 86_400_000
const J1970 = 2440588
const J2000 = 2451545
const OBLIQUITY = rad * 23.4397
const SYNODIC_MONTH = 29.530588853  // days

function toJulian(date: Date): number { return date.valueOf() / DAY_MS - 0.5 + J1970 }
function fromJulian(j: number): Date { return new Date((j + 0.5 - J1970) * DAY_MS) }
function toDays(date: Date): number { return toJulian(date) - J2000 }

function rightAscension(l: number, b: number): number {
  return Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l))
}
function declination(l: number, b: number): number {
  return Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l))
}
function siderealTime(d: number, lw: number): number { return rad * (280.16 + 360.9856235 * d) - lw }

function altitudeOf(H: number, phi: number, dec: number): number {
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
}
function azimuthOf(H: number, phi: number, dec: number): number {
  return Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi))
}

// ── Sun position ────────────────────────────────────────────────────────────

function solarMeanAnomaly(d: number): number { return rad * (357.5291 + 0.98560028 * d) }

function eclipticLongitude(M: number): number {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const P = rad * 102.9372  // perihelion of Earth
  return M + C + P + Math.PI
}

function sunCoords(d: number) {
  const M = solarMeanAnomaly(d)
  const L = eclipticLongitude(M)
  return { dec: declination(L, 0), ra: rightAscension(L, 0), lng: L }
}

export interface SunPosition {
  altitude: number  // degrees above horizon
  azimuth: number   // degrees, 0 = N, 90 = E
}

export function sunPosition(date: Date, lat: number, lon: number): SunPosition {
  const lw = rad * -lon
  const phi = rad * lat
  const d = toDays(date)
  const c = sunCoords(d)
  const H = siderealTime(d, lw) - c.ra
  return {
    altitude: altitudeOf(H, phi, c.dec) / rad,
    azimuth: (azimuthOf(H, phi, c.dec) / rad + 180 + 360) % 360,  // shift from S-based to N-based
  }
}

// ── Sun event times ─────────────────────────────────────────────────────────

const J0 = 0.0009

function julianCycle(d: number, lw: number): number { return Math.round(d - J0 - lw / (2 * Math.PI)) }
function approxTransit(Ht: number, lw: number, n: number): number { return J0 + (Ht + lw) / (2 * Math.PI) + n }
function solarTransitJ(ds: number, M: number, L: number): number {
  return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
}
function hourAngle(h: number, phi: number, dec: number): number {
  return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)))
}

export interface SunEvents {
  solarNoon: Date
  maxAltitude: number       // degrees at solar noon
  sunrise: Date | null      // null at extreme latitudes (never rises/sets)
  sunset: Date | null
  civilDawn: Date | null    // sun at −6°
  civilDusk: Date | null
  nauticalDawn: Date | null // −12°
  nauticalDusk: Date | null
  astroDawn: Date | null    // −18°
  astroDusk: Date | null
  goldenAmEnd: Date | null  // sun climbs past +6°
  goldenPmStart: Date | null
  blueAmStart: Date | null  // −6° → −4°
  blueAmEnd: Date | null
  bluePmStart: Date | null
  bluePmEnd: Date | null
}

export function sunEvents(date: Date, lat: number, lon: number): SunEvents {
  const lw = rad * -lon
  const phi = rad * lat
  const d = toDays(date)
  const n = julianCycle(d, lw)
  const ds = approxTransit(0, lw, n)
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L, 0)
  const Jnoon = solarTransitJ(ds, M, L)

  // Morning/evening pair of times where the sun crosses altitude h (degrees).
  function pair(h: number): [Date | null, Date | null] {
    const w = hourAngle(rad * h, phi, dec)
    if (!isFinite(w)) return [null, null]
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L)
    const Jrise = Jnoon - (Jset - Jnoon)
    return [fromJulian(Jrise), fromJulian(Jset)]
  }

  const [sunrise, sunset] = pair(-0.833)
  const [civilDawn, civilDusk] = pair(-6)
  const [nauticalDawn, nauticalDusk] = pair(-12)
  const [astroDawn, astroDusk] = pair(-18)
  const [goldenAmEnd, goldenPmStart] = pair(6)
  const [blueAmEnd, bluePmStart] = pair(-4)

  return {
    solarNoon: fromJulian(Jnoon),
    maxAltitude: 90 - Math.abs(lat - dec / rad),
    sunrise, sunset,
    civilDawn, civilDusk,
    nauticalDawn, nauticalDusk,
    astroDawn, astroDusk,
    goldenAmEnd, goldenPmStart,
    blueAmStart: civilDawn, blueAmEnd,
    bluePmStart, bluePmEnd: civilDusk,
  }
}

// ── Moon position ───────────────────────────────────────────────────────────

function moonCoords(d: number) {
  const L = rad * (218.316 + 13.176396 * d)   // mean longitude
  const M = rad * (134.963 + 13.064993 * d)   // mean anomaly
  const F = rad * (93.272 + 13.229350 * d)    // argument of latitude
  const l = L + rad * 6.289 * Math.sin(M)
  const b = rad * 5.128 * Math.sin(F)
  const dt = 385001 - 20905 * Math.cos(M)     // distance, km
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt, lng: l }
}

export function moonAltitude(date: Date, lat: number, lon: number): number {
  const lw = rad * -lon
  const phi = rad * lat
  const d = toDays(date)
  const c = moonCoords(d)
  const H = siderealTime(d, lw) - c.ra
  // parallax correction — the moon is close enough that it matters
  const h = altitudeOf(H, phi, c.dec)
  return (h - Math.asin(6371 / c.dist) * Math.cos(h)) / rad
}

export interface MoonTimes {
  rise: Date | null
  set: Date | null
  culmination: Date | null  // highest point, null if below horizon all day
  culminationAlt: number
}

/** Moonrise / moonset / culmination for the local calendar day containing `date`. */
export function moonTimes(date: Date, lat: number, lon: number): MoonTimes {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const hc = 0.133  // degrees — refraction + mean semi-diameter

  let rise: Date | null = null
  let set: Date | null = null
  let bestAlt = -90
  let bestT = 0

  let prev = moonAltitude(start, lat, lon) - hc
  for (let i = 1; i <= 24; i++) {
    const t = start.getTime() + i * 3_600_000
    const cur = moonAltitude(new Date(t), lat, lon) - hc
    if (prev <= 0 && cur > 0 && !rise) {
      rise = new Date(t - 3_600_000 + 3_600_000 * (-prev / (cur - prev)))
    }
    if (prev >= 0 && cur < 0 && !set) {
      set = new Date(t - 3_600_000 + 3_600_000 * (prev / (prev - cur)))
    }
    if (cur > bestAlt) { bestAlt = cur; bestT = t }
    prev = cur
  }

  return {
    rise, set,
    culmination: bestAlt > 0 ? new Date(bestT) : null,
    culminationAlt: bestAlt + hc,
  }
}

// ── Moon phase / illumination ───────────────────────────────────────────────

export interface LunarPhase {
  phase: number         // 0 = new, 0.5 = full, 1 = new again
  illumination: number  // 0..100 %
  age: number           // days since new moon
  name: string
  emoji: string
  waxing: boolean
  zodiac: string        // tropical sign the moon sits in
}

const PHASE_NAMES: [number, string, string][] = [
  [0.03, 'New Moon', '🌑'],
  [0.22, 'Waxing Crescent', '🌒'],
  [0.28, 'First Quarter', '🌓'],
  [0.47, 'Waxing Gibbous', '🌔'],
  [0.53, 'Full Moon', '🌕'],
  [0.72, 'Waning Gibbous', '🌖'],
  [0.78, 'Last Quarter', '🌗'],
  [0.97, 'Waning Crescent', '🌘'],
  [1.01, 'New Moon', '🌑'],
]

const ZODIAC = ['Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces']

export function lunarPhase(date = new Date()): LunarPhase {
  const d = toDays(date)
  const s = sunCoords(d)
  const m = moonCoords(d)

  const sdist = 149_598_000  // km, Earth–Sun
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  )
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi))
  const angle = Math.atan2(
    Math.cos(s.dec) * Math.sin(s.ra - m.ra),
    Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra)
  )
  const phase = 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI
  const illumination = Math.round(100 * (1 + Math.cos(inc)) / 2)

  const entry = PHASE_NAMES.find(([lim]) => phase < lim) ?? PHASE_NAMES[0]
  const lngDeg = ((m.lng / rad) % 360 + 360) % 360

  return {
    phase, illumination,
    age: phase * SYNODIC_MONTH,
    name: entry[1], emoji: entry[2],
    waxing: phase < 0.5,
    zodiac: ZODIAC[Math.floor(lngDeg / 30) % 12],
  }
}

// Traditional North American full-moon names by month.
const FULL_MOON_NAMES = ['Wolf Moon', 'Snow Moon', 'Worm Moon', 'Pink Moon',
  'Flower Moon', 'Strawberry Moon', 'Buck Moon', 'Sturgeon Moon',
  'Harvest Moon', "Hunter's Moon", 'Beaver Moon', 'Cold Moon']

export function fullMoonName(date: Date): string { return FULL_MOON_NAMES[date.getMonth()] }

export interface UpcomingPhases {
  nextFull: Date
  nextFullName: string
  nextNew: Date
}

/** Next full and new moon after `date`, found by hourly scan + interpolation. */
export function upcomingPhases(date = new Date()): UpcomingPhases {
  let nextFull: Date | null = null
  let nextNew: Date | null = null
  let prev = lunarPhase(date).phase

  for (let h = 1; h <= 24 * 31 && (!nextFull || !nextNew); h++) {
    const t = new Date(date.getTime() + h * 3_600_000)
    const cur = lunarPhase(t).phase
    if (!nextFull && prev < 0.5 && cur >= 0.5) {
      const f = (0.5 - prev) / (cur - prev)
      nextFull = new Date(t.getTime() - (1 - f) * 3_600_000)
    }
    if (!nextNew && cur < prev - 0.5) {  // phase wrapped 1 → 0
      const f = (1 - prev) / (cur + 1 - prev)
      nextNew = new Date(t.getTime() - (1 - f) * 3_600_000)
    }
    prev = cur
  }

  // Scans over a full synodic month always find both; fall back defensively.
  nextFull ??= new Date(date.getTime() + 15 * DAY_MS)
  nextNew ??= new Date(date.getTime() + 15 * DAY_MS)
  return { nextFull, nextFullName: fullMoonName(nextFull), nextNew }
}

// ── Seasons ─────────────────────────────────────────────────────────────────

export interface SeasonInfo {
  season: string            // astronomical season (northern hemisphere naming)
  nextEvent: string         // "September equinox", "December solstice", …
  nextEventDate: Date
  daysUntil: number
  meteorological: string    // meteorological season
}

const SEASON_EVENTS = ['March equinox', 'June solstice', 'September equinox', 'December solstice']
const SEASONS_N = ['Spring', 'Summer', 'Autumn', 'Winter']

function sunLongitudeDeg(date: Date): number {
  const L = eclipticLongitude(solarMeanAnomaly(toDays(date))) / rad
  return ((L % 360) + 360) % 360
}

export function seasonInfo(date = new Date(), lat = 41.88): SeasonInfo {
  const lng = sunLongitudeDeg(date)
  const quadrant = Math.floor(lng / 90)          // 0: Mar→Jun, 1: Jun→Sep, …
  const targetLng = ((quadrant + 1) * 90) % 360  // next crossing

  // Daily scan for the crossing, then linear interpolation.
  let prevDelta = ((targetLng - lng + 540) % 360) - 180
  let eventDate = new Date(date.getTime() + 95 * DAY_MS)
  for (let i = 1; i <= 95; i++) {
    const t = new Date(date.getTime() + i * DAY_MS)
    const delta = ((targetLng - sunLongitudeDeg(t) + 540) % 360) - 180
    if (prevDelta > 0 && delta <= 0) {
      const f = prevDelta / (prevDelta - delta)
      eventDate = new Date(t.getTime() - (1 - f) * DAY_MS)
      break
    }
    prevDelta = delta
  }

  const north = lat >= 0
  const season = north ? SEASONS_N[quadrant] : SEASONS_N[(quadrant + 2) % 4]
  const m = date.getMonth()
  const metQ = m >= 2 && m <= 4 ? 0 : m >= 5 && m <= 7 ? 1 : m >= 8 && m <= 10 ? 2 : 3
  const meteorological = north ? SEASONS_N[metQ] : SEASONS_N[(metQ + 2) % 4]

  return {
    season,
    nextEvent: SEASON_EVENTS[(quadrant + 1) % 4],
    nextEventDate: eventDate,
    daysUntil: Math.round((eventDate.getTime() - date.getTime()) / DAY_MS),
    meteorological,
  }
}
