'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { describeWeather } from '@/lib/weather'

interface WeatherSnapshot {
  place: string
  current: { temperature_2m: number; weather_code: number; apparent_temperature: number }
  daily: { temperature_2m_max: number[]; temperature_2m_min: number[] }
}

interface Quote {
  symbol: string
  price: number | null
  change_pct: number | null
}

interface MarketsSnapshot {
  indices: Quote[]
  futures: Quote[]
  megacaps: Quote[]
  volatility: Quote[]
  commodities: Quote[]
  fetched_at: number
}

type Bucket = 'indices' | 'futures' | 'megacaps' | 'volatility' | 'commodities'
const TICKER_PICK: { src: Bucket; sym: string; label: string }[] = [
  { src: 'indices',     sym: '^GSPC', label: 'S&P' },
  { src: 'indices',     sym: '^IXIC', label: 'NDX' },
  { src: 'indices',     sym: '^DJI',  label: 'DJI' },
  { src: 'indices',     sym: '^RUT',  label: 'RUT' },
  { src: 'volatility',  sym: '^VIX',  label: 'VIX' },
  { src: 'volatility',  sym: '^VVIX', label: 'VVIX' },
  { src: 'futures',     sym: 'ES=F',  label: 'ES' },
  { src: 'futures',     sym: 'NQ=F',  label: 'NQ' },
  { src: 'commodities', sym: 'CL=F',  label: 'WTI' },
  { src: 'commodities', sym: 'BZ=F',  label: 'Brent' },
  { src: 'commodities', sym: 'NG=F',  label: 'NatGas' },
  { src: 'commodities', sym: 'GC=F',  label: 'Gold' },
  { src: 'commodities', sym: 'SI=F',  label: 'Silver' },
  { src: 'commodities', sym: 'HG=F',  label: 'Copper' },
  { src: 'futures',     sym: 'ZN=F',  label: '10Y' },
  { src: 'futures',     sym: 'DX=F',  label: 'DXY' },
  { src: 'futures',     sym: 'BTC=F', label: 'BTC' },
  { src: 'megacaps',   sym: 'NVDA',  label: 'NVDA' },
  { src: 'megacaps',   sym: 'AAPL',  label: 'AAPL' },
  { src: 'megacaps',   sym: 'MSFT',  label: 'MSFT' },
  { src: 'megacaps',   sym: 'GOOGL', label: 'GOOGL' },
  { src: 'megacaps',   sym: 'META',  label: 'META' },
  { src: 'megacaps',   sym: 'AMZN',  label: 'AMZN' },
  { src: 'megacaps',   sym: 'TSLA',  label: 'TSLA' },
  { src: 'megacaps',   sym: 'AMD',   label: 'AMD' },
  { src: 'megacaps',   sym: 'AVGO',  label: 'AVGO' },
  { src: 'megacaps',   sym: 'JPM',   label: 'JPM' },
  { src: 'megacaps',   sym: 'COIN',  label: 'COIN' },
]

function fmtPct(p: number | null): string {
  if (p == null) return '—'
  const sign = p >= 0 ? '+' : ''
  return `${sign}${p.toFixed(2)}%`
}

function pctClass(p: number | null): string {
  if (p == null) return 'text-muted-foreground'
  return p >= 0
    ? 'text-[var(--ink-emerald)] dark:text-emerald-300'
    : 'text-[var(--ink-rose)] dark:text-rose-300'
}

function fmtPrice(p: number | null): string {
  if (p == null) return '—'
  return p.toLocaleString(undefined, { maximumFractionDigits: p >= 100 ? 0 : 2 })
}

function fmtAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round(now / 1000 - ts))
  if (s < 30) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function InfoStrip() {
  const [weather, setWeather] = useState<WeatherSnapshot | null>(null)
  const [markets, setMarkets] = useState<MarketsSnapshot | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/weather').then(r => r.ok ? r.json() : null).then(setWeather).catch(() => {})
    fetch('/api/markets').then(r => r.ok ? r.json() : null).then(setMarkets).catch(() => {})
  }, [])

  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 30_000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [])

  const cond = weather ? describeWeather(weather.current.weather_code) : null
  const tickers: { label: string; q: Quote | undefined }[] = markets
    ? TICKER_PICK.map(t => ({ label: t.label, q: markets[t.src].find(q => q.symbol === t.sym) }))
    : []

  return (
    <div className="mb-5 rounded-xl border border-border bg-muted/20 overflow-hidden">
      <div className="flex items-stretch divide-x divide-border/60">
        {/* Weather */}
        <Link
          href="/weather"
          className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors shrink-0"
        >
          {weather && cond ? (
            <>
              <span className="text-2xl leading-none">{cond.emoji}</span>
              <div className="flex flex-col leading-tight">
                <span className="text-base font-semibold tabular-nums">
                  {Math.round(weather.current.temperature_2m)}°
                </span>
                <span className="text-[10px] text-muted-foreground line-clamp-1">
                  {weather.place} · {cond.label}
                </span>
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums hidden sm:block ml-2">
                ↑{Math.round(weather.daily.temperature_2m_max[0])}° ↓{Math.round(weather.daily.temperature_2m_min[0])}°
              </span>
            </>
          ) : (
            <div className="h-9 w-32 bg-muted/30 rounded animate-pulse" />
          )}
        </Link>

        {/* Markets ticker tape — auto-scrolls; pause on hover */}
        <div className="flex-1 min-w-0 overflow-hidden group">
          {tickers.length > 0 ? (
            <div className="flex w-max ticker-marquee">

              {[0, 1].map(copy => (
                <div
                  key={copy}
                  aria-hidden={copy === 1}
                  className="flex items-center divide-x divide-border/40 shrink-0"
                >
                  {tickers.map(({ label, q }) => (
                    <Link
                      key={`${copy}-${label}`}
                      href="/markets"
                      className="flex items-baseline gap-1.5 px-3 py-2.5 hover:bg-muted/40 transition-colors shrink-0"
                      title={q?.symbol ?? label}
                      tabIndex={copy === 0 ? 0 : -1}
                    >
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
                      <span className="text-sm font-medium tabular-nums">{fmtPrice(q?.price ?? null)}</span>
                      <span className={`text-[11px] font-semibold tabular-nums ${pctClass(q?.change_pct ?? null)}`}>
                        {fmtPct(q?.change_pct ?? null)}
                      </span>
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-2.5 flex gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-9 w-20 bg-muted/30 rounded animate-pulse" />
              ))}
            </div>
          )}
        </div>

        {/* Last updated + link */}
        <Link
          href="/markets"
          className="hidden md:flex flex-col justify-center items-end px-3 py-2.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors shrink-0 leading-tight tabular-nums"
          title={markets ? new Date(markets.fetched_at * 1000).toLocaleString() : ''}
        >
          <span>{markets ? fmtAgo(markets.fetched_at, now) : '—'}</span>
          <span className="text-foreground/70">all →</span>
        </Link>
      </div>
    </div>
  )
}
