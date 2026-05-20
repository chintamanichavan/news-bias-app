'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import QuoteRow, { Quote } from '@/components/QuoteRow'

interface MarketsData {
  indices: Quote[]
  volatility: Quote[]
  megacaps: Quote[]
  commodities: Quote[]
  futures: Quote[]
  etfs: Quote[]
  trending: Quote[]
  fetched_at: number
}

interface Section {
  key: keyof Omit<MarketsData, 'fetched_at'>
  label: string
}

const SECTIONS: Section[] = [
  { key: 'indices',     label: 'Indices' },
  { key: 'volatility',  label: 'Volatility' },
  { key: 'megacaps',    label: 'Most-Active Equities' },
  { key: 'commodities', label: 'Commodities' },
  { key: 'futures',     label: 'Futures' },
  { key: 'etfs',        label: 'Sector ETFs' },
  { key: 'trending',    label: 'Trending' },
]

function timeAgo(ts: number): string {
  const s = Math.round(Date.now() / 1000 - ts)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

export default function MarketsPage() {
  const [data, setData] = useState<MarketsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch('/api/markets')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchMarkets() }, [fetchMarkets])

  function handleRefresh() {
    setRefreshing(true)
    fetchMarkets()
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Apple-Stocks-style masthead */}
      <header className="mb-7 flex items-end justify-between gap-3">
        <div>
          <p className="news-section-label">My Watchlist</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">
            Markets
          </h1>
          {data && (
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              Updated {timeAgo(data.fetched_at)} · quotes delayed 15+ min
            </p>
          )}
        </div>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </header>

      {/* Section anchor chips */}
      <nav className="flex flex-wrap items-center gap-1.5 mb-6 -mx-1 px-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]">
        {SECTIONS.map(s => (
          <a
            key={s.key}
            href={`#${s.key}`}
            className="text-[13px] px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap"
          >
            {s.label}
          </a>
        ))}
      </nav>

      {error && (
        <div className="news-card text-center py-10 mb-6">
          <p className="font-semibold">Couldn't load markets</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <section key={i}>
              <div className="h-3 w-32 bg-muted/40 rounded animate-pulse mb-3" />
              <div className="news-card h-72 animate-pulse bg-muted/30" />
            </section>
          ))}
        </div>
      ) : data ? (
        <div className="space-y-9">
          {SECTIONS.map(s => {
            const items = data[s.key]
            return (
              <section key={s.key} id={s.key} className="scroll-mt-20">
                <div className="flex items-baseline justify-between mb-3 px-1">
                  <h2 className="news-section-label">{s.label}</h2>
                  <span className="text-[11px] text-muted-foreground tabular-nums">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="news-card text-xs text-muted-foreground p-4 text-center">
                    No data — upstream may be rate-limiting. Try refresh.
                  </div>
                ) : (
                  <div className="news-card px-4 py-1.5">
                    {items.map(q => <QuoteRow key={q.symbol} q={q} />)}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground mt-12 text-center">
        Quotes from Yahoo Finance · cached 60s · delayed 15+ min · not financial advice.
      </p>
    </div>
  )
}
