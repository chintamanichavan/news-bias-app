'use client'

import { useEffect, useState, useCallback } from 'react'
import ArticleCard from '@/components/ArticleCard'
import FilterDrawer from '@/components/FilterDrawer'
import InfoStrip from '@/components/InfoStrip'
import { Button } from '@/components/ui/button'

interface Source {
  id: string
  name: string
  category: string
  topic?: string
  allsides_label: string
  allsides_score: number
}

interface Article {
  id: string
  title: string
  url: string
  image_url: string | null
  published: string | null
  source: Source
  bias_score: number | null
  confidence: number | null
  sentiment_score: number | null
  intensity_score: number | null
}

interface Filters {
  category: string | null
  sourceId: string | null
  minScore: number
  maxScore: number
  lookbackHours: number | null   // null = use server default (24h when essential, unlimited when all)
  includeAll: boolean            // true = include tabloid/partisan/opinion sources
}

const DEFAULT_FILTERS: Filters = {
  category: null, sourceId: null, minScore: -5, maxScore: 5,
  lookbackHours: 24, includeAll: false,
}
const PER_PAGE = 24

const WINDOW_OPTIONS: { label: string; hours: number | null }[] = [
  { label: '24h', hours: 24 },
  { label: '3d',  hours: 72 },
  { label: '7d',  hours: 168 },
  { label: 'All', hours: null },
]

const CATEGORY_HEADING: Record<string, string> = {
  finance:     '📈 Finance',
  geopolitics: '🌐 Geopolitics',
  science:     '🔬 Science',
}

export default function HomePage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  const fetchArticles = useCallback(async (f: Filters, p: number) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) })
    if (f.sourceId) params.set('source_id', f.sourceId)
    if (f.category) params.set('category', f.category)
    if (f.minScore > -5) params.set('min_score', String(f.minScore))
    if (f.maxScore < 5) params.set('max_score', String(f.maxScore))
    // Picking a specific source means "show me everything from them" — skip the
    // lookback window in that case so slow-publishing sources (e.g. Liberty
    // Street, 0 posts in the last 24h) don't look empty when clicked.
    if (f.lookbackHours !== null && !f.sourceId) params.set('lookback_hours', String(f.lookbackHours))
    if (f.includeAll) params.set('include_all', 'true')

    try {
      const res = await fetch(`/api/articles?${params}`)
      if (res.ok) {
        const data = await res.json()
        setArticles(prev => p === 1 ? data.articles : [...prev, ...data.articles])
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetch('/api/sources').then(r => r.json()).then(setSources).catch(() => {})
  }, [])

  useEffect(() => {
    setPage(1)
    fetchArticles(filters, 1)
  }, [filters, fetchArticles])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/feeds/refresh', { method: 'POST' })
      setPage(1)
      await fetchArticles(filters, 1)
    } finally {
      setRefreshing(false)
    }
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    fetchArticles(filters, next)
  }

  // Heading reflects what's currently filtered
  let heading = 'Your Feed'
  let subheading = 'High-signal sources, last 24h.'
  if (filters.category) {
    heading = CATEGORY_HEADING[filters.category] ?? filters.category
    subheading = `${total} articles in this category`
  } else if (filters.sourceId) {
    const src = sources.find(s => s.id === filters.sourceId)
    heading = src?.name ?? 'Source'
    subheading = `${total} articles from ${src?.name ?? 'this source'}`
  } else {
    const windowLabel = filters.lookbackHours === null ? 'all time'
      : filters.lookbackHours === 24 ? 'last 24h'
      : filters.lookbackHours === 72 ? 'last 3d'
      : filters.lookbackHours === 168 ? 'last 7d'
      : `last ${filters.lookbackHours}h`
    const scope = filters.includeAll ? 'all sources' : 'essential sources'
    subheading = `${total} articles · ${scope} · ${windowLabel}`
  }

  // Display label for the current source filter, when one is selected
  const activeSourceLabel = filters.sourceId
    ? sources.find(s => s.id === filters.sourceId)?.name ?? 'source'
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <InfoStrip />

      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="news-section-label">Feed</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">{heading}</h1>
          <p className="text-sm text-muted-foreground mt-2">{subheading}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDrawerOpen(true)}
            className="gap-1.5"
          >
            <span className="inline-block w-3.5 leading-none text-base relative -top-px">⛂</span>
            <span>
              Filter
              {(filters.category || filters.sourceId) && (
                <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-[hsl(var(--accent-news))] align-middle" />
              )}
            </span>
          </Button>
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {/* Active filter chip — shows what's currently filtered, with a clear button */}
      {(filters.category || filters.sourceId) && (
        <div className="flex items-center gap-2 mb-4 text-[13px]">
          <span className="text-muted-foreground">Showing:</span>
          <button
            onClick={() => setFilters(f => ({ ...f, category: null, sourceId: null }))}
            className="inline-flex items-center gap-1.5 bg-foreground text-background px-2.5 py-1 rounded-full font-medium hover:opacity-80 transition-opacity"
          >
            <span>{activeSourceLabel ?? CATEGORY_HEADING[filters.category ?? ''] ?? filters.category}</span>
            <span className="opacity-70">×</span>
          </button>
        </div>
      )}

      <FilterDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sources={sources}
        filters={filters}
        onFiltersChange={setFilters}
      />

      {!filters.sourceId && (
        <div className="flex flex-wrap items-center gap-3 mb-5 text-sm">
          <div className="flex items-center gap-1">
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground mr-2">Window</span>
            {WINDOW_OPTIONS.map(o => (
              <button
                key={o.label}
                onClick={() => setFilters(f => ({ ...f, lookbackHours: o.hours }))}
                className={`text-[12px] px-2.5 py-1 rounded-md transition-colors ${
                  filters.lookbackHours === o.hours
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
          {!filters.category && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer ml-1">
              <input
                type="checkbox"
                checked={filters.includeAll}
                onChange={e => setFilters(f => ({ ...f, includeAll: e.target.checked }))}
                className="cursor-pointer"
              />
              Show all sources (incl. tabloid/opinion)
            </label>
          )}
        </div>
      )}

      {loading && articles.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="news-card h-64 animate-pulse bg-muted/30" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="news-card text-center py-20">
          <p className="font-semibold">No articles yet</p>
          <p className="text-sm text-muted-foreground mt-1.5">Click <span className="font-medium text-foreground">Refresh</span> to pull the latest.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {articles.map(a => <ArticleCard key={a.id} article={a} />)}
          </div>
          {articles.length < total && (
            <div className="mt-8 text-center">
              <Button variant="outline" onClick={loadMore} disabled={loading}>
                {loading ? 'Loading…' : `Load more (${total - articles.length} remaining)`}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
