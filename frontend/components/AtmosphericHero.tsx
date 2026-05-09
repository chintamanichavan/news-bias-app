'use client'

import { useMemo } from 'react'
import { describeWeather, atmosphereFor, compass, moonPhase } from '@/lib/weather'

interface Props {
  temp: number
  feelsLike: number
  weatherCode: number
  isDay: boolean
  place: string
  high: number
  low: number
  humidity: number
  windSpeed: number
  windDir: number
  sunrise: string  // ISO local time
  sunset: string
  updated: string  // ISO local time
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
}

// Sun arc: half-circle from sunrise (left) to sunset (right). Position dot
// based on current time. Below the horizon → moon mode.
function SunArc({ sunrise, sunset, now, isDay }: { sunrise: Date; sunset: Date; now: Date; isDay: boolean }) {
  const tSun = sunset.getTime() - sunrise.getTime()
  const tNow = now.getTime() - sunrise.getTime()
  const fraction = tSun > 0 ? Math.max(0, Math.min(1, tNow / tSun)) : 0.5

  // Half-circle path from (10, 60) to (190, 60) arcing up to (100, 10)
  const cx = 10 + fraction * 180
  // y = top of arc when fraction = 0.5
  const cy = 60 - Math.sin(fraction * Math.PI) * 50

  return (
    <svg viewBox="0 0 200 70" className="w-full h-16" fill="none">
      {/* Arc */}
      <path d="M 10 60 A 90 90 0 0 1 190 60" stroke="currentColor" strokeWidth="1" strokeOpacity="0.4" strokeDasharray="3 3" />
      {/* Horizon line */}
      <line x1="0" y1="60" x2="200" y2="60" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1" />
      {/* Sunrise dot */}
      <circle cx="10" cy="60" r="2" fill="currentColor" opacity="0.5" />
      <circle cx="190" cy="60" r="2" fill="currentColor" opacity="0.5" />
      {/* Sun position */}
      {isDay && (
        <g>
          <circle cx={cx} cy={cy} r="5" fill="#fde047" stroke="#fff8" strokeWidth="0.5" />
          <circle cx={cx} cy={cy} r="9" fill="#fde047" opacity="0.25" />
        </g>
      )}
      {/* Labels */}
      <text x="10" y="69" fontSize="7" fill="currentColor" opacity="0.7" textAnchor="middle">↑ {fmtTime(sunrise.toISOString())}</text>
      <text x="190" y="69" fontSize="7" fill="currentColor" opacity="0.7" textAnchor="middle">↓ {fmtTime(sunset.toISOString())}</text>
    </svg>
  )
}

// ── Animated layers ───────────────────────────────────────────────────────

function SunLayer() {
  return (
    <div className="absolute -top-12 -right-12 w-64 h-64 pointer-events-none opacity-90">
      <svg viewBox="0 0 200 200" className="wx-sun">
        <circle cx="100" cy="100" r="38" fill="#fde047" />
        {Array.from({ length: 12 }).map((_, i) => {
          const a = (i * Math.PI * 2) / 12
          const x1 = 100 + Math.cos(a) * 50
          const y1 = 100 + Math.sin(a) * 50
          const x2 = 100 + Math.cos(a) * 78
          const y2 = 100 + Math.sin(a) * 78
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#fde047" strokeWidth="3" strokeLinecap="round" />
        })}
      </svg>
    </div>
  )
}

function MoonLayer() {
  const phase = moonPhase()
  return (
    <>
      {/* Star field */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 25 }).map((_, i) => {
          const top = (i * 53) % 100
          const left = (i * 71) % 100
          const delay = (i * 0.4) % 3
          const size = 1 + (i % 3)
          return (
            <span
              key={i}
              className="absolute rounded-full bg-white wx-twinkle"
              style={{ top: `${top}%`, left: `${left}%`, width: size, height: size, animationDelay: `${delay}s` }}
            />
          )
        })}
      </div>
      {/* Moon */}
      <div className="absolute top-6 right-8 text-7xl opacity-90 select-none" title={phase.name}>
        {phase.emoji}
      </div>
    </>
  )
}

function CloudsLayer({ count = 3 }: { count?: number }) {
  const clouds = Array.from({ length: count }).map((_, i) => ({
    top: 8 + i * 28,
    delay: i * 4,
    scale: 0.6 + (i % 3) * 0.2,
    opacity: 0.5 + (i % 2) * 0.2,
  }))
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {clouds.map((c, i) => (
        <svg
          key={i}
          viewBox="0 0 100 40"
          className="absolute wx-cloud"
          style={{ top: `${c.top}%`, width: `${40 + i * 12}%`, opacity: c.opacity, animationDelay: `${c.delay}s` }}
        >
          <ellipse cx="30" cy="25" rx="22" ry="12" fill="#fff" />
          <ellipse cx="55" cy="20" rx="28" ry="15" fill="#fff" />
          <ellipse cx="78" cy="26" rx="18" ry="10" fill="#fff" />
        </svg>
      ))}
    </div>
  )
}

function RainLayer() {
  const drops = Array.from({ length: 60 }).map((_, i) => ({
    left: (i * 17) % 100,
    delay: ((i * 0.13) % 1).toFixed(2),
    duration: (0.6 + ((i % 5) * 0.1)).toFixed(2),
    opacity: 0.3 + ((i % 4) * 0.15),
  }))
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {drops.map((d, i) => (
        <span
          key={i}
          className="absolute top-0 wx-rain"
          style={{
            left: `${d.left}%`,
            width: 1.2,
            height: 14,
            background: 'linear-gradient(to bottom, transparent, #cfe5ff)',
            opacity: d.opacity,
            animationDelay: `${d.delay}s`,
            animationDuration: `${d.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

function SnowLayer() {
  const flakes = Array.from({ length: 40 }).map((_, i) => ({
    left: (i * 23) % 100,
    delay: ((i * 0.21) % 6).toFixed(2),
    duration: (5 + ((i % 5))).toFixed(2),
    size: 2 + (i % 4),
    opacity: 0.5 + ((i % 4) * 0.12),
  }))
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {flakes.map((f, i) => (
        <span
          key={i}
          className="absolute top-0 rounded-full bg-white wx-snow"
          style={{
            left: `${f.left}%`,
            width: f.size,
            height: f.size,
            opacity: f.opacity,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
          }}
        />
      ))}
    </div>
  )
}

function LightningLayer() {
  return (
    <>
      <CloudsLayer count={4} />
      <RainLayer />
      <div className="absolute inset-0 pointer-events-none bg-white/0 wx-lightning" style={{ background: 'radial-gradient(ellipse at top, rgba(255,255,255,0.7) 0%, transparent 60%)' }} />
    </>
  )
}

function FogLayer() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="absolute wx-fog"
          style={{
            top: `${15 + i * 22}%`,
            left: 0,
            right: 0,
            height: '20%',
            background: 'linear-gradient(to right, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
            animationDelay: `${i * 2}s`,
            filter: 'blur(8px)',
          }}
        />
      ))}
    </div>
  )
}

function AnimationLayer({ kind }: { kind: ReturnType<typeof atmosphereFor>['animation'] }) {
  if (kind === 'sun')       return <SunLayer />
  if (kind === 'moon')      return <MoonLayer />
  if (kind === 'clouds')    return <CloudsLayer />
  if (kind === 'rain')      return <RainLayer />
  if (kind === 'snow')      return <SnowLayer />
  if (kind === 'lightning') return <LightningLayer />
  if (kind === 'fog')       return <FogLayer />
  return null
}

// ── Hero ──────────────────────────────────────────────────────────────────

export default function AtmosphericHero(props: Props) {
  const cond = describeWeather(props.weatherCode)
  const atmo = useMemo(() => atmosphereFor(props.weatherCode, props.isDay), [props.weatherCode, props.isDay])

  const sunrise = new Date(props.sunrise)
  const sunset = new Date(props.sunset)
  const now = new Date(props.updated)

  return (
    <div
      className={`relative overflow-hidden rounded-2xl shadow-lg ${atmo.accent}`}
      style={{ background: atmo.gradient, minHeight: 360 }}
    >
      {/* Animated atmospheric layer */}
      <AnimationLayer kind={atmo.animation} />

      {/* Foreground content */}
      <div className="relative p-6 sm:p-8 flex flex-col justify-between min-h-[360px]">
        {/* Top: place + condition */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-widest opacity-80">{props.place}</p>
            <p className="text-base mt-0.5 opacity-90">{cond.label}</p>
          </div>
          <p className="text-xs opacity-70 tabular-nums hidden sm:block">{fmtTime(props.updated)}</p>
        </div>

        {/* Middle: temperature */}
        <div className="my-4">
          <div className="flex items-start gap-3">
            <span className="text-8xl sm:text-9xl font-extralight leading-none tracking-tight">
              {Math.round(props.temp)}
            </span>
            <span className="text-3xl opacity-80 mt-2">°F</span>
          </div>
          <p className="text-sm opacity-85 mt-1">
            Feels like {Math.round(props.feelsLike)}° · H {Math.round(props.high)}° · L {Math.round(props.low)}°
          </p>
        </div>

        {/* Bottom: sun arc + meta */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <SunArc sunrise={sunrise} sunset={sunset} now={now} isDay={props.isDay} />
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Meta label="Humidity" value={`${props.humidity}%`} />
            <Meta label="Wind" value={`${Math.round(props.windSpeed)} ${compass(props.windDir)}`} />
            <Meta
              label={props.isDay ? 'Daylight' : 'Phase'}
              value={
                props.isDay
                  ? formatDayLength(sunrise, sunset)
                  : moonPhase().name
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider opacity-70">{label}</div>
      <div className="text-sm font-medium tabular-nums">{value}</div>
    </div>
  )
}

function formatDayLength(sunrise: Date, sunset: Date): string {
  const minutes = Math.round((sunset.getTime() - sunrise.getTime()) / 60000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}
