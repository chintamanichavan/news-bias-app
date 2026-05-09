'use client'

import { useEffect, useState, useCallback } from 'react'
import ArticleCard from '@/components/ArticleCard'
import FeedSidebar from '@/components/FeedSidebar'
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
}

const DEFAULT_FILTERS: Filters = { category: null, sourceId: null, minScore: -5, maxScore: 5 }
const PER_PAGE = 24

const CATEGORY_HEADING: Record<string, string> = {
  finance:     '📈 Finance',
  geopolitics: '🌐 Geopolitics',
  science:     '🔬 Science',
  general:     '📰 General',
}

export default function HomePage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [sources, setSources] = useState<Source[]>([])
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchArticles = useCallback(async (f: Filters, p: number) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), per_page: String(PER_PAGE) })
    if (f.sourceId) params.set('source_id', f.sourceId)
    if (f.category) params.set('category', f.category)
    if (f.minScore > -5) params.set('min_score', String(f.minScore))
    if (f.maxScore < 5) params.set('max_score', String(f.maxScore))

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
  let subheading = 'Finance and science, curated.'
  if (filters.category) {
    heading = CATEGORY_HEADING[filters.category] ?? filters.category
    subheading = `${total} articles in this category`
  } else if (filters.sourceId) {
    const src = sources.find(s => s.id === filters.sourceId)
    heading = src?.name ?? 'Source'
    subheading = `${total} articles from ${src?.name ?? 'this source'}`
  } else {
    subheading = `${total} articles · ML-rated for tone and bias`
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex gap-8">
        <FeedSidebar sources={sources} filters={filters} onFiltersChange={setFilters} />

        <div className="flex-1 min-w-0">
          <InfoStrip />

          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-2xl font-bold">{heading}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">{subheading}</p>
            </div>
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh feeds'}
            </Button>
          </div>

          {loading && articles.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-border bg-muted/30 h-64 animate-pulse" />
              ))}
            </div>
          ) : articles.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg font-medium">No articles yet</p>
              <p className="text-sm mt-1">Click &quot;Refresh feeds&quot; to fetch the latest news</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {articles.map(a => <ArticleCard key={a.id} article={a} />)}
              </div>
              {articles.length < total && (
                <div className="mt-8 text-center">
                  <Button variant="outline" onClick={loadMore} disabled={loading}>
                    {loading ? 'Loading...' : `Load more (${total - articles.length} remaining)`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
