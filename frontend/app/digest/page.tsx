'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'

interface Source {
  id: string
  name: string
  category: string
}

interface Article {
  id: string
  title: string
  summary: string | null
  body: string | null
  url: string
  image_url: string | null
  published: string | null
  source: Source
  bias_score: number | null
  sentiment_score: number | null
}

const CATEGORY_META: Record<string, { label: string; tone: string; gradient: string }> = {
  finance:     { label: 'Finance',     tone: 'text-emerald-700',
                 gradient: 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-background' },
  geopolitics: { label: 'Geopolitics', tone: 'text-indigo-700',
                 gradient: 'bg-gradient-to-br from-indigo-100 via-sky-50 to-background' },
  science:     { label: 'Science',     tone: 'text-violet-700',
                 gradient: 'bg-gradient-to-br from-violet-100 via-fuchsia-50 to-background' },
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.replace(' ', 'T') + (iso.endsWith('Z') || iso.includes('+') ? '' : 'Z'))
  const mins = Math.round((Date.now() - d.getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export default function DigestPage() {
  const [articles, setArticles] = useState<Article[]>([])
  const [loading, setLoading] = useState(true)
  const [activeIdx, setActiveIdx] = useState(0)
  const [imageFailed, setImageFailed] = useState<Record<string, boolean>>({})
  const containerRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    setLoading(true)
    fetch('/api/articles?per_page=50')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.articles) {
          // A card needs real content beyond the headline — drop articles where
          // the summary is just the title rehashed, or where everything we have
          // is too short to be worth reading. Stops FT-style paywalled stubs
          // from appearing as identical-text cards.
          const norm = (s: string) =>
            s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
          const usable = (d.articles as Article[]).filter(a => {
            const title = norm(a.title || '')
            const summary = norm(a.summary || '')
            const body = norm(a.body || '')
            const candidate = summary.length >= title.length ? summary : body
            if (!candidate) return false
            if (candidate.split(' ').length < 15) return false
            // Reject if the candidate is essentially the title with nothing added
            if (candidate === title) return false
            if (candidate.startsWith(title) && candidate.length < title.length + 30) return false
            return true
          })
          setArticles(usable)
        }
      })
      .finally(() => setLoading(false))
  }, [])

  // Keyboard navigation (desktop)
  const advance = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(articles.length - 1, activeIdx + delta))
    const el = cardRefs.current[next]
    if (el) el.scrollIntoView({ behavior: 'smooth' })
  }, [activeIdx, articles.length])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowDown' || e.key === 'j' || e.key === ' ') {
        e.preventDefault(); advance(1)
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault(); advance(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [advance])

  // Track which card is currently snapped
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new IntersectionObserver(
      entries => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.idx)
            if (!Number.isNaN(idx)) setActiveIdx(idx)
          }
        }
      },
      { root: containerRef.current, threshold: [0.6] },
    )
    cardRefs.current.forEach(el => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [articles])

  if (loading) {
    return (
      <div className="h-[calc(100dvh-3.5rem)] flex items-center justify-center text-muted-foreground">
        Loading digest…
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <div className="h-[calc(100dvh-3.5rem)] flex items-center justify-center text-muted-foreground">
        No articles to digest right now.
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="h-[calc(100dvh-3.5rem)] overflow-y-auto snap-y snap-mandatory bg-background"
    >
      {articles.map((a, i) => {
        const text = (a.summary && a.summary.trim().length > 10) ? a.summary : (a.body ?? '')
        const cat = CATEGORY_META[a.source.category] ?? {
          label: a.source.category, tone: 'text-stone-700',
          gradient: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
        }
        const hasImage = !!a.image_url && !imageFailed[a.id]
        return (
          <section
            key={a.id}
            ref={el => { cardRefs.current[i] = el }}
            data-idx={i}
            className="h-[calc(100dvh-3.5rem)] snap-start snap-always flex flex-col"
          >
            {/* Hero — image when available, otherwise a category-tinted gradient
                panel so the card never has a blank top half. */}
            {hasImage ? (
              <div className="relative w-full h-2/5 md:h-1/2 bg-muted overflow-hidden shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.image_url!}
                  alt=""
                  className="w-full h-full object-cover"
                  onError={() => setImageFailed(prev => ({ ...prev, [a.id]: true }))}
                />
                <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background via-background/80 to-transparent" />
              </div>
            ) : (
              <div className={`relative w-full h-[30%] md:h-[35%] shrink-0 overflow-hidden ${cat.gradient}`}>
                <div className="absolute inset-0 flex items-center justify-center px-6">
                  <span className="text-[clamp(36px,8vw,80px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.1] select-none text-center line-clamp-2">
                    {a.source.name}
                  </span>
                </div>
              </div>
            )}

            {/* Content — Apple-News-style editorial layout */}
            <div className="flex-1 min-h-0 flex flex-col px-6 md:px-8 py-6 md:py-8 max-w-2xl w-full mx-auto">
              {/* Source row — uppercase, tracked, category-colored */}
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] mb-4">
                <span className={cat.tone}>{a.source.name}</span>
                {a.published && (
                  <>
                    <span className="text-muted-foreground/60">·</span>
                    <span className="text-muted-foreground tabular-nums">{formatTime(a.published)}</span>
                  </>
                )}
              </div>

              <h2 className="font-serif text-[28px] md:text-[40px] font-bold leading-[1.08] tracking-tight mb-5 [text-wrap:balance]">
                {a.title}
              </h2>

              <p className="text-[17px] md:text-[19px] leading-[1.55] text-foreground/85 mb-auto">
                {text}
              </p>

              <div className="flex items-center justify-between gap-3 pt-5 mt-8 border-t border-border/60">
                <a
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-foreground hover:opacity-60 transition-opacity"
                >
                  Read full article →
                </a>
                <Link
                  href={`/article/${a.id}`}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  More context
                </Link>
              </div>
            </div>
          </section>
        )
      })}

      {/* Position indicator — minimal, bottom right */}
      <div className="fixed bottom-4 right-4 text-[11px] font-medium text-muted-foreground bg-card/90 backdrop-blur px-3 py-1.5 rounded-full shadow-sm tabular-nums">
        {activeIdx + 1} · {articles.length}
      </div>
    </div>
  )
}
