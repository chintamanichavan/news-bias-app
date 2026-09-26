'use client'

// Particle-style For You: follow markets/weather interests, mute sources, get
// a ranked personal feed. Preferences live in this browser (lib/prefs) — the
// backend ranks statelessly from the query string.

import { useEffect, useMemo, useState } from 'react'
import ArticleCard from '@/components/ArticleCard'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'
import { getFollowedTopics, getMutedSources, toggleTopic, toggleMutedSource } from '@/lib/prefs'

interface Source {
  id: string
  name: string
  category?: string
  topic?: string
  allsides_score: number
  allsides_label: string
}

interface Article {
  id: string
  title: string
  body?: string | null
  summary?: string | null
  url: string
  image_url: string | null
  published: string | null
  source: Source
  sentiment_score: number | null
  intensity_score: number | null
  topics?: string[]
}

export default function ForYouPage() {
  const [followed, setFollowed] = useState<string[]>([])
  const [muted, setMuted] = useState<string[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setFollowed(getFollowedTopics())
    setMuted(getMutedSources())
    setHydrated(true)
  }, [])

  const { data: topicData } = useResource<{ topics: string[] }>('/api/topics')
  const feedUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (followed.length) params.set('topics', followed.join(','))
    if (muted.length) params.set('muted', muted.join(','))
    return `/api/foryou?${params.toString()}`
  }, [followed, muted])
  const { data, loading, error, reload } = useResource<{ articles: Article[] }>(hydrated ? feedUrl : null)

  const allTopics = topicData?.topics ?? []
  const articles = data?.articles ?? []
  const mutedSet = new Set(muted)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <p className="news-section-label">Personalized</p>
      <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">For You</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-prose">
        Follow the markets and weather interests you care about. Stories are ranked by
        your follows, freshness, and the sentiment engine&rsquo;s intensity read.
      </p>

      {/* Interests */}
      <div className="mt-5 flex flex-wrap gap-2">
        {allTopics.map(t => {
          const on = followed.includes(t)
          return (
            <button
              key={t}
              onClick={() => setFollowed(toggleTopic(t))}
              className={`text-[13px] px-3 py-1.5 rounded-full border transition-colors ${
                on
                  ? 'bg-foreground text-background border-foreground font-medium'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/40'
              }`}
            >
              {on ? '✓ ' : '+ '}{t}
            </button>
          )
        })}
      </div>

      {followed.length === 0 && (
        <p className="mt-3 text-[12px] text-muted-foreground">
          Nothing followed yet — showing the freshest in-scope stories. Pick a few interests to shape the ranking.
        </p>
      )}

      {/* Feed */}
      <div className="mt-8">
        {error && articles.length === 0 && <LoadError message={error} onRetry={reload} />}
        {loading && articles.length === 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
          </div>
        )}
        {articles.length > 0 && (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {articles.map(a => (
              <div key={a.id} className="relative group">
                <ArticleCard article={a} />
                <div className="mt-1.5 flex items-center justify-between px-1">
                  <div className="flex flex-wrap gap-1">
                    {(a.topics ?? []).slice(0, 2).map(t => (
                      <span key={t} className="text-[10px] uppercase tracking-wider text-muted-foreground">{t}</span>
                    ))}
                  </div>
                  <button
                    onClick={() => setMuted(toggleMutedSource(a.source.id))}
                    className="text-[10px] text-muted-foreground/70 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    title={`Mute ${a.source.name}`}
                  >
                    {mutedSet.has(a.source.id) ? 'unmute' : 'mute'} {a.source.name}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && articles.length === 0 && !error && (
          <p className="text-sm text-muted-foreground">Nothing matches yet — try following more interests.</p>
        )}
      </div>

      {/* Muted sources */}
      {muted.length > 0 && (
        <div className="mt-10 pt-5 border-t border-border/60">
          <p className="news-section-label mb-2">Muted sources</p>
          <div className="flex flex-wrap gap-2">
            {muted.map(id => (
              <button key={id} onClick={() => setMuted(toggleMutedSource(id))}
                className="text-[12px] px-2.5 py-1 rounded-full bg-muted text-muted-foreground hover:text-foreground">
                {id} ✕
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
