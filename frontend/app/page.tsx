'use client'

// Home = the sentiment engine, front and center. Artha is a signals-
// research platform: multi-channel sentiment composites (news, social,
// prediction markets, vol regime, weather risk) built as inputs for
// systematic trading and long-term investing strategies. The coverage list
// that used to be the whole page is now the supporting cast.

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { type TopStory, HeroStoryCard, CompactStoryRow } from '@/components/TopStoryCard'
import WeatherChip from '@/components/WeatherChip'
import SignalEnginePanel from '@/components/SignalEnginePanel'
import StrategyLab from '@/components/StrategyLab'
import LoadError from '@/components/LoadError'
import { invalidate, useResource } from '@/lib/useResource'

const TOP_URL = '/api/top?limit=12'

export default function HomePage() {
  const { data, loading, error, reload } = useResource<{ stories: TopStory[] }>(TOP_URL)
  const stories = data?.stories ?? []
  const [refreshing, setRefreshing] = useState(false)

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch('/api/feeds/refresh', { method: 'POST' })
      invalidate(TOP_URL)
      reload()
    } finally {
      setRefreshing(false)
    }
  }

  const hero = stories[0]
  const rest = stories.slice(1)

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      {/* Masthead — the engine is the product */}
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <p className="news-section-label">Systematic signal research</p>
          <h1 className="mt-1 font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-none">
            The Sentiment Engine
          </h1>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[62ch]">
            Five signal channels — news, social, prediction markets, the vol regime, and
            weather risk — continuously ingested, scored by a classical ML sentiment engine,
            and composed per security across a global universe. Built as research input for
            systematic trading and long-term investing strategies.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <WeatherChip compact />
          <Button size="sm" variant="outline" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      {/* The engine's read */}
      <SignalEnginePanel />

      {/* PnL, risk, simulation, research — the signals facing consequences */}
      <StrategyLab />

      {/* Coverage feeding the engine */}
      <section className="mt-12">
        <div className="flex items-baseline justify-between mb-4">
          <p className="news-section-label">Coverage behind the signal</p>
        </div>

        {loading && stories.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="news-card h-40 animate-pulse bg-muted/40" />
            ))}
          </div>
        ) : error && stories.length === 0 ? (
          <LoadError message={error} onRetry={reload} retrying={loading} />
        ) : stories.length === 0 ? (
          <div className="news-card text-center py-16">
            <p className="text-lg font-semibold">Nothing to surface yet</p>
            <p className="text-sm text-muted-foreground mt-1.5">
              Tap <span className="font-medium text-foreground">Refresh</span> to pull the latest.
            </p>
          </div>
        ) : (
          <>
            {hero && <HeroStoryCard story={hero} />}
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 lg:gap-x-10 border-t border-border/60">
              {rest.map(story => (
                <CompactStoryRow key={story.id} story={story} />
              ))}
            </div>
          </>
        )}
      </section>

    </div>
  )
}
