'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import QuoteCard, { Quote } from '@/components/QuoteCard'

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
  emoji: string
  blurb: string
}

const SECTIONS: Section[] = [
  { key: 'indices',     label: 'Indices',              emoji: '📊',  blurb: 'Major US equity indices' },
  { key: 'volatility',  label: 'Volatility',           emoji: '⚡',  blurb: 'Vol indices — derivatives anchor' },
  { key: 'megacaps',    label: 'Most-Active Equities', emoji: '🏛️', blurb: 'Megacaps + most-traded options names' },
  { key: 'commodities', label: 'Commodities',          emoji: '🛢️', blurb: 'Energy, metals, agriculture' },
  { key: 'futures',     label: 'Futures',              emoji: '⛓️', blurb: 'Equity index, rates, FX, crypto' },
  { key: 'etfs',        label: 'Sector ETFs',          emoji: '🧺', blurb: 'Indices + bonds + sectors' },
  { key: 'trending',    label: 'Trending',             emoji: '🔥', blurb: 'Most-searched right now (Yahoo)' },
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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">📈 Markets</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Indices, volatility, equities, futures, sector ETFs, trending
            {data ? ` · updated ${timeAgo(data.fetched_at)}` : ''}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Section anchor nav */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6 mt-4">
        {SECTIONS.map(s => (
          <a
            key={s.key}
            href={`#${s.key}`}
            className="text-sm px-3 py-1.5 rounded-full bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <span>{s.emoji}</span>
            <span>{s.label}</span>
          </a>
        ))}
      </div>

      {error && (
        <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl mb-6">
          <p className="font-medium">Couldn't load markets</p>
          <p className="text-xs mt-1">{error}</p>
        </div>
      )}

      {loading && !data ? (
        <div className="space-y-8">
          {SECTIONS.map(s => (
            <section key={s.key}>
              <div className="h-6 w-40 bg-muted/30 rounded animate-pulse mb-3" />
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-xl bg-muted/30 animate-pulse" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : data ? (
        <div className="space-y-8">
          {SECTIONS.map(s => {
            const items = data[s.key]
            return (
              <section key={s.key} id={s.key} className="scroll-mt-20">
                <div className="flex items-baseline justify-between mb-2">
                  <h2 className="text-base font-semibold flex items-center gap-2">
                    <span>{s.emoji}</span>
                    <span>{s.label}</span>
                    <span className="text-xs text-muted-foreground font-normal">· {items.length}</span>
                  </h2>
                  <span className="text-[11px] text-muted-foreground hidden sm:inline">{s.blurb}</span>
                </div>
                {items.length === 0 ? (
                  <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                    No data — upstream may be rate-limiting. Try refresh.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                    {items.map(q => <QuoteCard key={q.symbol} q={q} />)}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground mt-10 text-center">
        Quotes from Yahoo Finance · cached 60s · delayed 15+ min · not financial advice.
      </p>
    </div>
  )
}
