'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import BiasGauge from '@/components/BiasGauge'
import { Badge } from '@/components/ui/badge'

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

const LABEL_COLORS: Record<string, string> = {
  far_left: 'bg-blue-700 text-white',
  left: 'bg-blue-400 text-white',
  lean_left: 'bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  center: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  lean_right: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  right: 'bg-red-400 text-white',
  far_right: 'bg-red-700 text-white',
}

function enrichArticle(a: Article) {
  return {
    ...a,
    score: a.bias_score ?? a.source.allsides_score,
    confidence: a.confidence ?? 0.3,
  }
}

export default function StoriesPage() {
  const [groups, setGroups] = useState<StoryGroup[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    fetch('/api/stories', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : { groups: [] })
      .then(d => setGroups(d.groups ?? []))
      .catch(() => setGroups([]))
  }, [])

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-1">Same Story, Different Lens</h1>
      <p className="text-sm text-muted-foreground mb-6">
        See how different outlets cover the same events — and which stories one side is missing.
      </p>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5 mb-6">
        <FilterChip active={filter === 'all'}   onClick={() => setFilter('all')}
          label="All stories" emoji="📰" count={counts.all} />
        <FilterChip active={filter === 'left'}  onClick={() => setFilter('left')}
          label="Left blindspot" emoji="🔵" count={counts.left}
          tip="Mostly covered by right-leaning outlets — left-readers are missing it" />
        <FilterChip active={filter === 'right'} onClick={() => setFilter('right')}
          label="Right blindspot" emoji="🔴" count={counts.right}
          tip="Mostly covered by left-leaning outlets — right-readers are missing it" />
      </div>

      {groups === null ? (
        <SkeletonList />
      ) : visible.length === 0 ? (
        <EmptyState filter={filter} groups={groups} />
      ) : (
        <div className="space-y-10">
          {visible.map(group => {
            const enriched = group.articles.map(enrichArticle)
            const sorted = [...enriched].sort((a, b) => a.score - b.score)
            const headline = sorted[Math.floor(sorted.length / 2)]?.title ?? enriched[0]?.title

            return (
              <div key={group.group_id} className="rounded-xl border border-border overflow-hidden">
                <div className="bg-muted/40 px-5 py-3 border-b border-border">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Story · {enriched.length} sources
                    </p>
                    {group.blindspot.direction && (
                      <BlindspotPill bs={group.blindspot} />
                    )}
                  </div>
                  <p className="font-semibold text-sm leading-snug line-clamp-2">{headline}</p>
                  {group.blindspot.total >= 2 && (
                    <DistributionBar bs={group.blindspot} className="mt-2.5" />
                  )}
                </div>
                <div className="divide-y divide-border">
                  {sorted.map(a => (
                    <Link
                      key={a.id}
                      href={`/article/${a.id}`}
                      className="flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 hover:bg-muted/30 transition-colors group"
                    >
                      <div className="w-32 sm:w-44 shrink-0 min-w-0">
                        <Badge
                          title={a.source.name}
                          className={`text-[10px] px-1.5 py-0.5 max-w-full block truncate ${LABEL_COLORS[a.source.allsides_label] ?? 'bg-gray-200 dark:bg-gray-700'}`}
                        >
                          {a.source.name}
                        </Badge>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm line-clamp-1 group-hover:text-primary transition-colors">
                          {a.title}
                        </p>
                      </div>
                      <div className="w-32 sm:w-40 shrink-0">
                        <BiasGauge score={a.score} confidence={a.confidence} size="sm" />
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  active, onClick, label, emoji, count, tip,
}: {
  active: boolean; onClick: () => void; label: string; emoji: string; count: number; tip?: string
}) {
  return (
    <button
      onClick={onClick}
      title={tip}
      className={`text-sm px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
        active
          ? 'bg-primary text-primary-foreground font-medium'
          : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
      }`}
    >
      <span>{emoji}</span>
      <span>{label}</span>
      <span className={`text-[10px] tabular-nums ${active ? 'opacity-80' : 'opacity-60'}`}>
        {count}
      </span>
    </button>
  )
}

function BlindspotPill({ bs }: { bs: Blindspot }) {
  const isLeftBs = bs.direction === 'left'
  const cls = isLeftBs
    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200'
    : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
  const dot = isLeftBs ? '🔵' : '🔴'
  const which = isLeftBs ? 'right' : 'left'
  const pct = Math.round(bs.skew * 100)
  return (
    <span
      className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded inline-flex items-center gap-1 tabular-nums whitespace-nowrap ${cls}`}
      title={`${pct}% of partisan outlets covering this story are ${which}-leaning`}
    >
      <span>{dot}</span>
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
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted flex-1 max-w-xs">
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
      <div className="text-center py-20 text-muted-foreground border border-dashed rounded-xl">
        <p className="font-medium">No story groups yet</p>
        <p className="text-sm mt-1">Refresh feeds and wait for articles to be ingested and grouped.</p>
      </div>
    )
  }
  const which = filter === 'left' ? 'left blindspots' : 'right blindspots'
  return (
    <div className="text-center py-20 text-muted-foreground border border-dashed rounded-xl">
      <p className="font-medium">No {which} right now</p>
      <p className="text-sm mt-1">
        A blindspot needs ≥4 outlets covering a story with ≥70% from one side.
        Try “All stories”, or add more politically diverse sources.
      </p>
    </div>
  )
}

function SkeletonList() {
  return (
    <div className="space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-40 rounded-xl bg-muted/30 animate-pulse" />
      ))}
    </div>
  )
}
