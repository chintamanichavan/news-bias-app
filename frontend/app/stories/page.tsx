'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import BiasGauge from '@/components/BiasGauge'
import ExploreFooter from '@/components/ExploreFooter'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Source {
  id: string
  name: string
  allsides_score: number
  allsides_label: string
}

interface Article {
  id: string
  title: string
  url: string
  published: string | null
  source: Source
  bias_score: number | null
  confidence: number | null
}

interface Blindspot {
  total: number
  left: number
  center: number
  right: number
  direction: 'left' | 'right' | null
  skew: number
}

interface StoryGroup {
  group_id: string
  articles: Article[]
  blindspot: Blindspot
}

type Filter = 'all' | 'left' | 'right'

const SOURCE_TONE: Record<string, string> = {
  far_left:   'text-blue-700',
  left:       'text-blue-700',
  lean_left:  'text-blue-700',
  center:     'text-stone-600',
  lean_right: 'text-red-700',
  right:      'text-red-700',
  far_right:  'text-red-700',
}

function enrichArticle(a: Article) {
  return {
    ...a,
    score: a.bias_score ?? a.source.allsides_score,
    confidence: a.confidence ?? 0.3,
  }
}

export default function StoriesPage() {
  const { data, loading, error, reload } =
    useResource<{ groups: StoryGroup[] }>('/api/stories')
  const groups = loading ? null : (data?.groups ?? [])
  const [filter, setFilter] = useState<Filter>('all')

  const filtered = useCallback(() => {
    if (!groups) return []
    if (filter === 'all') return groups
    return groups.filter(g => g.blindspot.direction === filter)
  }, [groups, filter])

  const counts = {
    all: groups?.length ?? 0,
    left:  groups?.filter(g => g.blindspot.direction === 'left').length ?? 0,
    right: groups?.filter(g => g.blindspot.direction === 'right').length ?? 0,
  }

  const visible = filtered()

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      {/* Editorial masthead */}
      <header className="mb-7">
        <p className="news-section-label">Cross-source clustering</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">
          Same Story
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-prose">
          See how different outlets cover the same event, and which stories one side is missing.
        </p>
      </header>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        <Chip active={filter === 'all'}   onClick={() => setFilter('all')}
          label="All stories" count={counts.all} />
        <Chip active={filter === 'left'}  onClick={() => setFilter('left')}
          label="Left blindspot" count={counts.left} dot="bg-blue-500"
          tip="Mostly covered by right-leaning outlets — left-readers are missing it" />
        <Chip active={filter === 'right'} onClick={() => setFilter('right')}
          label="Right blindspot" count={counts.right} dot="bg-red-500"
          tip="Mostly covered by left-leaning outlets — right-readers are missing it" />
      </div>

      {groups === null ? (
        <SkeletonList />
      ) : error && groups.length === 0 ? (
        <LoadError message={error} onRetry={reload} />
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} groups={groups} />
      ) : (
        <div className="space-y-5">
          {visible.map(group => {
            const enriched = group.articles.map(enrichArticle)
            const sorted = [...enriched].sort((a, b) => a.score - b.score)
            const headline = sorted[Math.floor(sorted.length / 2)]?.title ?? enriched[0]?.title

            return (
              <section key={group.group_id} className="news-card overflow-hidden">
                {/* Cluster header */}
                <div className="px-5 sm:px-6 py-4 border-b border-border/50">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
                      {enriched.length} sources
                    </p>
                    {group.blindspot.direction && (
                      <BlindspotPill bs={group.blindspot} />
                    )}
                  </div>
                  <p className="font-semibold text-[17px] leading-snug tracking-tight line-clamp-2">
                    {headline}
                  </p>
                  {group.blindspot.total >= 2 && (
                    <DistributionBar bs={group.blindspot} className="mt-3" />
                  )}
                </div>

                {/* Source list — each row is the same story as told by an outlet */}
                <div>
                  {sorted.map((a, i) => (
                    <Link
                      key={a.id}
                      href={`/article/${a.id}`}
                      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:gap-4 px-5 sm:px-6 py-3 hover:bg-muted/40 transition-colors group ${
                        i > 0 ? 'border-t border-border/50' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className={`text-[11px] font-medium uppercase tracking-[0.12em] mb-0.5 ${SOURCE_TONE[a.source.allsides_label] ?? 'text-stone-600'}`}>
                          {a.source.name}
                        </div>
                        <p className="text-[14px] leading-snug line-clamp-2 group-hover:text-foreground/70 transition-colors">
                          {a.title}
                        </p>
                      </div>
                      <div className="w-28 sm:w-36 shrink-0">
                        <BiasGauge score={a.score} confidence={a.confidence} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      <ExploreFooter excludeHrefs={['/stories']} />
    </div>
  )
}

function Chip({
  active, onClick, label, count, dot, tip,
}: {
  active: boolean; onClick: () => void; label: string; count: number; dot?: string; tip?: string
}) {
  return (
    <button
      onClick={onClick}
      title={tip}
      className={`text-[13px] px-3 py-1.5 rounded-full whitespace-nowrap transition-colors flex items-center gap-2 ${
        active
          ? 'bg-foreground text-background font-medium'
          : 'bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      {dot && <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />}
      <span>{label}</span>
      {count > 0 && (
        <span className={`text-[10px] tabular-nums ${active ? 'opacity-70' : 'opacity-60'}`}>
          {count}
        </span>
      )}
    </button>
  )
}

function BlindspotPill({ bs }: { bs: Blindspot }) {
  const isLeftBs = bs.direction === 'left'
  const cls = isLeftBs
    ? 'bg-blue-100 text-blue-800'
    : 'bg-red-100 text-red-800'
  const which = isLeftBs ? 'right' : 'left'
  const pct = Math.round(bs.skew * 100)
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-md inline-flex items-center gap-1.5 tabular-nums whitespace-nowrap ${cls}`}
      title={`${pct}% of partisan outlets covering this story are ${which}-leaning`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${isLeftBs ? 'bg-blue-600' : 'bg-red-600'}`} />
      <span>{isLeftBs ? 'Left' : 'Right'} blindspot</span>
      <span className="opacity-70">· {pct}%</span>
    </span>
  )
}

function DistributionBar({ bs, className = '' }: { bs: Blindspot; className?: string }) {
  const total = bs.total
  if (total === 0) return null
  const seg = (n: number) => `${(n / total) * 100}%`
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted flex-1 max-w-sm">
        {bs.left   > 0 && <div className="bg-blue-500"            style={{ width: seg(bs.left)   }} title={`${bs.left} left`}   />}
        {bs.center > 0 && <div className="bg-muted-foreground/40" style={{ width: seg(bs.center) }} title={`${bs.center} center`} />}
        {bs.right  > 0 && <div className="bg-red-500"             style={{ width: seg(bs.right)  }} title={`${bs.right} right`}  />}
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {bs.left}L · {bs.center}C · {bs.right}R
      </span>
    </div>
  )
}

function EmptyState({ filter, groups }: { filter: Filter; groups: StoryGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="news-card text-center py-20">
        <p className="font-semibold">No story groups yet</p>
        <p className="text-sm text-muted-foreground mt-1.5">
          Refresh feeds and wait for articles to be ingested and grouped.
        </p>
      </div>
    )
  }
  const which = filter === 'left' ? 'left blindspots' : 'right blindspots'
  return (
    <div className="news-card text-center py-20">
      <p className="font-semibold">No {which} right now</p>
      <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
        A blindspot needs ≥4 outlets covering a story with ≥70% from one side. Try “All stories”,
        or add more politically diverse sources.
      </p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="news-card h-44 animate-pulse bg-muted/30" />
      ))}
    </div>
  )
}
