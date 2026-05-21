'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ChevronRight } from 'lucide-react'
import {
  type TopStory,
  HeroStoryCard,
  MediumStoryCard,
  CompactStoryRow,
} from '@/components/TopStoryCard'
import WeatherChip from '@/components/WeatherChip'
import ExploreFooter from '@/components/ExploreFooter'
import TodayCarousel from '@/components/TodayCarousel'

export default function HomePage() {
  const [stories, setStories] = useState<TopStory[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchTop = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/top?limit=16')
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

  // Carousel sits above the hero — a quick at-a-glance ribbon of the day's top picks.
  // Trending list takes everything past the hero + secondary so it stays full
  // even when the carousel is shown.
  const carouselStories = stories.slice(0, 6)
  const hero = stories[0]
  const secondary = stories.slice(1, 5)
  const trending = stories.slice(5)

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      {/* Editorial masthead */}
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="news-section-label">Today</p>
          <h1 className="mt-1 font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-none">
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
          {/* Today carousel — quick swipeable ribbon above the hero */}
          <TodayCarousel stories={carouselStories} />

          {/* Hero — the day's biggest story */}
          {hero && <HeroStoryCard story={hero} />}

          {/* Secondary — 2-column on lg, 4-column on xl+ for one neat row */}
          {secondary.length > 0 && (
            <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
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
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  See all
                  <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              {/* Hairline-divided list — no card chrome, like an editorial
                  contents page. 2-column on lg+ so it reads as a wide spread. */}
              <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10 border-t border-border/60">
                {trending.map(story => (
                  <CompactStoryRow key={story.id} story={story} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <ExploreFooter excludeHrefs={['/']} />
    </div>
  )
}
