'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import {
  type TopStory,
  HeroStoryCard,
  MediumStoryCard,
  CompactStoryRow,
} from '@/components/TopStoryCard'
import WeatherChip from '@/components/WeatherChip'

export default function HomePage() {
  const [stories, setStories] = useState<TopStory[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchTop = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/top?limit=10')
      if (res.ok) {
        const data = await res.json()
        setStories(data.stories ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTop() }, [fetchTop])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/feeds/refresh', { method: 'POST' })
      await fetchTop()
    } finally {
      setRefreshing(false)
    }
  }

  const hero = stories[0]
  const secondary = stories.slice(1, 5)
  const trending = stories.slice(5)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Editorial masthead */}
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="news-section-label">Today</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">
            Top Stories
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <WeatherChip compact />
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {loading && stories.length === 0 ? (
        <div className="space-y-6">
          <div className="news-card aspect-[16/10] sm:aspect-[2/1] animate-pulse bg-muted/40" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="news-card h-56 animate-pulse bg-muted/40" />
            ))}
          </div>
        </div>
      ) : stories.length === 0 ? (
        <div className="news-card text-center py-20">
          <p className="text-lg font-semibold">Nothing to surface yet</p>
          <p className="text-sm text-muted-foreground mt-1.5">
            Tap <span className="font-medium text-foreground">Refresh</span> to pull the latest.
          </p>
        </div>
      ) : (
        <>
          {/* Hero — the day's biggest story */}
          {hero && <HeroStoryCard story={hero} />}

          {/* Secondary — 2-column grid of #2-#5 */}
          {secondary.length > 0 && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
              {secondary.map(story => (
                <MediumStoryCard key={story.id} story={story} />
              ))}
            </div>
          )}

          {/* Trending list */}
          {trending.length > 0 && (
            <section className="mt-12">
              <div className="flex items-baseline justify-between mb-4">
                <p className="news-section-label">Trending</p>
                <Link
                  href="/feed"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  See all →
                </Link>
              </div>
              <div className="news-card px-5 py-1.5">
                {trending.map(story => (
                  <CompactStoryRow key={story.id} story={story} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div className="mt-14 text-center">
        <Link
          href="/digest"
          className="inline-flex items-center text-sm font-medium text-foreground hover:opacity-70 transition-opacity"
        >
          Read the 60-second digest →
        </Link>
      </div>
    </div>
  )
}
