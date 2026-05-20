'use client'

import { useMemo } from 'react'

// Dark-Sky-style hyperlocal narrative banner: one short sentence derived from
// the next ~12 hours of WMO weather codes + precipitation probability/amount.
// No LLM — just a small state machine over the forecast trajectory.

interface Props {
  /** Current weather code (WMO 4677). */
  currentCode: number
  /** Hourly arrays beginning at the current hour (sliced upstream). */
  hourly: {
    times: string[]
    codes: number[]
    probs: number[]   // 0..100
    precip: number[]  // inches per hour
  } | null
}

// WMO code helpers
function isPrecip(code: number | null | undefined): boolean {
  if (code == null) return false
  if (code >= 51 && code <= 67) return true   // drizzle / rain
  if (code >= 71 && code <= 77) return true   // snow
  if (code >= 80 && code <= 86) return true   // showers / snow showers
  if (code >= 95 && code <= 99) return true   // thunderstorms
  return false
}

function precipNoun(code: number): 'rain' | 'snow' | 'thunderstorms' | 'showers' | 'drizzle' {
  if (code >= 95) return 'thunderstorms'
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow'
  if (code >= 80 && code <= 82) return 'showers'
  if (code >= 51 && code <= 57) return 'drizzle'
  return 'rain'
}

function intensityFor(code: number): 'light' | '' | 'heavy' {
  // Trailing modifiers within each WMO trio: 51/61/71/80 light, 53/63/73 moderate, 55/65/75/82/86 heavy
  if ([55, 65, 67, 75, 82, 86, 99].includes(code)) return 'heavy'
  if ([51, 61, 71, 80, 85, 95].includes(code)) return 'light'
  return ''
}

function isClearSky(code: number | null | undefined): boolean {
  if (code == null) return false
  return code <= 3 // 0-3 are clear / partly cloudy / overcast
}

function isCloudySky(code: number | null | undefined): boolean {
  if (code == null) return false
  return code === 2 || code === 3 || code === 45 || code === 48 // partly cloudy / overcast / fog
}

function hoursPhrase(h: number): string {
  if (h <= 1) return 'about an hour'
  if (h <= 2) return 'a couple of hours'
  if (h <= 4) return `${h} hours`
  if (h <= 7) return 'a few hours'
  if (h <= 12) return 'the rest of the morning'
  return `${h} hours`
}

function timeOfDay(iso: string): 'morning' | 'afternoon' | 'evening' | 'overnight' {
  const h = new Date(iso).getHours()
  if (h < 5)  return 'overnight'
  if (h < 12) return 'morning'
  if (h < 17) return 'afternoon'
  if (h < 21) return 'evening'
  return 'overnight'
}

/** Build the narrative sentence. */
function buildNowcast(props: Props): string {
  const { currentCode, hourly } = props
  if (!hourly || hourly.codes.length < 2) {
    // Fallback to a snapshot of the current condition
    if (isPrecip(currentCode)) return 'Precipitation now.'
    if (isCloudySky(currentCode)) return 'Cloudy now.'
    if (isClearSky(currentCode)) return 'Clear now.'
    return 'Conditions stable.'
  }

  const { codes, probs, precip } = hourly
  const N = Math.min(12, codes.length)
  const rainingNow = isPrecip(currentCode) || probs[0] >= 50

  if (rainingNow) {
    // Find when it stops
    let stopAt = -1
    for (let i = 1; i < N; i++) {
      if (!isPrecip(codes[i]) && probs[i] < 30 && precip[i] < 0.005) {
        stopAt = i
        break
      }
    }
    const noun = precipNoun(currentCode || codes[0])
    const intensity = intensityFor(currentCode || codes[0])
    const phrase = intensity ? `${intensity} ${noun}` : noun
    if (stopAt === -1) {
      return `${capitalize(phrase)} through the next ${hoursPhrase(N - 1)}.`
    }
    if (stopAt === 1) return `${capitalize(phrase)}, easing in about an hour.`
    return `${capitalize(phrase)} for about ${hoursPhrase(stopAt)}, then easing.`
  }

  // Currently dry — find when it starts
  let startAt = -1
  for (let i = 1; i < N; i++) {
    if (isPrecip(codes[i]) || (probs[i] >= 50 && precip[i] >= 0.005)) {
      startAt = i
      break
    }
  }

  // Status of "now"
  const skyNow = isCloudySky(currentCode) ? 'Cloudy' : isClearSky(currentCode) ? 'Clear' : 'Calm'

  if (startAt === -1) {
    return `${skyNow} for the next ${hoursPhrase(N - 1)}.`
  }
  const incoming = codes[startAt]
  const noun = precipNoun(incoming)
  const intensity = intensityFor(incoming)
  const phrase = intensity ? `${intensity} ${noun}` : noun
  if (startAt <= 1) return `${skyNow} now, ${phrase} starting within the hour.`
  if (startAt <= 3) return `${skyNow} for the next ${hoursPhrase(startAt)}, then ${phrase}.`
  const partOfDay = timeOfDay(hourly.times[startAt])
  return `${skyNow} for a few hours, then ${phrase} by ${partOfDay}.`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function NowCastBanner(props: Props) {
  const sentence = useMemo(() => buildNowcast(props), [props])
  return (
    <div className="news-card px-6 py-5 sm:px-8 sm:py-6">
      <p className="news-section-label">Nowcast</p>
      <p className="mt-1.5 text-[22px] sm:text-[28px] font-bold tracking-tight leading-[1.15] text-foreground">
        {sentence}
      </p>
    </div>
  )
}
