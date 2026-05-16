'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import TopStoryCard, { TopStory } from '@/components/TopStoryCard'
import WeatherChip from '@/components/WeatherChip'

export default function HomePage() {
  const [stories, setStories] = useState<TopStory[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const fetchTop = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/top?limit=7')
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

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h1 className="text-3xl font-bold tracking-tight">Today's Top Stories</h1>
          <div className="flex items-center gap-2">
            <WeatherChip compact />
            <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          The {stories.length || 7} most-covered stories of the last 36 hours.
          {' '}<Link href="/feed" className="text-primary hover:underline">See all articles →</Link>
        </p>
      </div>

      {/* Stories */}
      {loading && stories.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-muted/30 h-32 animate-pulse" />
          ))}
        </div>
      ) : stories.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg font-medium">No stories yet</p>
          <p className="text-sm mt-1">
            Click <span className="font-medium">Refresh</span> to pull the latest articles.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {stories.map((story, i) => (
            <TopStoryCard key={story.id} story={story} rank={i + 1} />
          ))}
        </div>
      )}

      <div className="mt-10 pt-6 border-t border-border text-center">
        <p className="text-xs text-muted-foreground mb-2">
          Want more? Browse the full feed instead of the curated digest.
        </p>
        <Link
          href="/feed"
          className="inline-flex items-center text-sm font-medium text-primary hover:underline"
        >
          Browse all articles →
        </Link>
      </div>
    </div>
  )
}
