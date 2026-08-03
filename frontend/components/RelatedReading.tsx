'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface Article {
  id: string
  title: string
  url: string
  body: string | null
  summary: string | null
  image_url: string | null
  published: string | null
  source: {
    id: string
    name: string
    category?: string
    allsides_label: string
  }
}

interface RelatedPayload {
  same_story: Article[]
  more_from_source: Article[]
}

interface Props {
  articleId: string
  sourceName: string
  sourceId: string
}

const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-[var(--ink-emerald)]',
  geopolitics: 'text-[var(--ink-indigo)]',
  science:     'text-[var(--ink-violet)]',
  general:     'text-muted-foreground',
}

const CATEGORY_TINT: Record<string, string> = {
  finance:     'bg-gradient-to-br from-[var(--wash-emerald-1)] via-[var(--wash-emerald-2)] to-background',
  geopolitics: 'bg-gradient-to-br from-[var(--wash-indigo-1)] via-[var(--wash-sky-2)] to-background',
  science:     'bg-gradient-to-br from-[var(--wash-violet-1)] via-[var(--wash-fuchsia-2)] to-background',
  general:     'bg-gradient-to-br from-[var(--wash-stone-1)] via-[var(--wash-stone-2)] to-background',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const h = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60))
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  return `${days}d ago`
}

export default function RelatedReading({ articleId, sourceName, sourceId }: Props) {
  const [data, setData] = useState<RelatedPayload | null>(null)

  useEffect(() => {
    fetch(`/api/articles/${articleId}/related?limit=6`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => setData({ same_story: [], more_from_source: [] }))
  }, [articleId])

  if (!data) return null
  const sameStoryCount = data.same_story.length
  const moreCount = data.more_from_source.length
  if (!sameStoryCount && !moreCount) return null

  return (
    <div className="mt-12">
      {/* End-of-article editorial flourish */}
      <div aria-hidden className="flex items-center justify-center gap-1.5 mb-10 text-muted-foreground/50">
        <span className="h-px w-8 bg-current" />
        <span className="text-base leading-none">◆</span>
        <span className="h-px w-8 bg-current" />
      </div>

      {sameStoryCount > 0 && (
        <section className="mb-10">
          <p className="news-section-label mb-4">More on this story</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.same_story.map(a => <CompactReadCard key={a.id} article={a} />)}
          </div>
        </section>
      )}

      {moreCount > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-4">
            <p className="news-section-label">More from {sourceName}</p>
            <Link
              href={`/channel/${sourceId}`}
              className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors"
            >
              See all →
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {data.more_from_source.map(a => <CompactReadCard key={a.id} article={a} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function CompactReadCard({ article }: { article: Article }) {
  const cat = article.source.category ?? 'general'
  const tone = CATEGORY_TONE[cat] ?? CATEGORY_TONE.general
  const tint = CATEGORY_TINT[cat] ?? CATEGORY_TINT.general

  return (
    <Link href={`/article/${article.id}`} className="group block news-card news-card-hover overflow-hidden h-full flex flex-col">
      {article.image_url ? (
        <div className="relative w-full aspect-[16/9] overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      ) : (
        <div className={`relative w-full aspect-[16/9] overflow-hidden ${tint}`}>
          <div className="absolute inset-0 flex items-center justify-center px-3">
            <span className="text-[clamp(18px,4vw,32px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.1] select-none text-center line-clamp-2">
              {article.source.name}
            </span>
          </div>
        </div>
      )}
      <div className="p-4 flex-1 flex flex-col">
        <div className={`text-[11px] font-medium uppercase tracking-[0.12em] mb-1.5 ${tone}`}>
          {article.source.name}
          {article.published && (
            <span className="text-muted-foreground normal-case tracking-normal"> · {timeAgo(article.published)}</span>
          )}
        </div>
        <h3 className="font-serif text-[15px] sm:text-[16px] font-semibold leading-snug tracking-tight line-clamp-3 group-hover:text-foreground/80 transition-colors [text-wrap:balance]">
          {article.title}
        </h3>
      </div>
    </Link>
  )
}
