'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import SignalCard, { Signal } from '@/components/SignalCard'

type Sort = 'movers' | 'volume' | 'expiry'

interface CategoryChip {
  id: string | null
  label: string
  emoji: string
}

const CATEGORIES: CategoryChip[] = [
  { id: null,          label: 'All',         emoji: '🎯' },
  { id: 'macro',       label: 'Macro',       emoji: '📈' },
  { id: 'geopolitics', label: 'Geopolitics', emoji: '🌐' },
  { id: 'politics',    label: 'Politics',    emoji: '🗳' },
  { id: 'crypto',      label: 'Crypto',      emoji: '₿' },
  { id: 'finance',     label: 'Finance',     emoji: '💰' },
]

const SORT_OPTIONS: { id: Sort; label: string }[] = [
  { id: 'movers', label: 'Biggest movers' },
  { id: 'volume', label: 'Highest volume' },
  { id: 'expiry', label: 'Closing soonest' },
]

function formatLastUpdated(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso.replace(' ', 'T') + 'Z')
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  return `${Math.round(mins / 60)} h ago`
}

export default function SignalsPage() {
  const [signals, setSignals] = useState<Signal[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [category, setCategory] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>('movers')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchSignals = useCallback(async (cat: string | null, s: Sort) => {
    setLoading(true)
    const params = new URLSearchParams({ sort: s, limit: '60' })
    if (cat) params.set('category', cat)
    try {
      const res = await fetch(`/api/signals?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSignals(data.signals)
        setCounts(data.categories ?? {})
        setLastUpdated(data.last_updated)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSignals(category, sort)
  }, [category, sort, fetchSignals])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/signals/refresh', { method: 'POST' })
      await fetchSignals(category, sort)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-baseline justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            🎯 Signals
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Live prediction-market probabilities · Polymarket · {lastUpdated ? `updated ${formatLastUpdated(lastUpdated)}` : 'loading…'}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Category chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4 mt-4">
        {CATEGORIES.map(c => {
          const isActive = category === c.id
          const count = c.id === null
            ? Object.values(counts).reduce((a, b) => a + b, 0)
            : counts[c.id] ?? 0
          return (
            <button
              key={c.label}
              onClick={() => setCategory(c.id)}
              className={`text-sm px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'bg-primary text-primary-foreground font-medium'
                  : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
              }`}
            >
              <span>{c.emoji}</span>
              <span>{c.label}</span>
              {count > 0 && (
                <span className={`text-[10px] tabular-nums ${isActive ? 'opacity-80' : 'opacity-60'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2 mb-5 text-sm">
        <span className="text-xs text-muted-foreground">Sort:</span>
        {SORT_OPTIONS.map(o => (
          <button
            key={o.id}
            onClick={() => setSort(o.id)}
            className={`text-xs px-2.5 py-1 rounded-md transition-colors ${
              sort === o.id
                ? 'bg-primary/10 text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading && signals.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/30 h-44 animate-pulse" />
          ))}
        </div>
      ) : signals.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border border-dashed rounded-xl">
          <p className="font-medium">No markets in this category right now</p>
          <p className="text-xs mt-1">Try a different filter or click Refresh.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {signals.map(s => <SignalCard key={s.id} signal={s} />)}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-8 text-center">
        Data from Polymarket. Click any card to view the market and trade. Not financial advice.
      </p>
    </div>
  )
}
