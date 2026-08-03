import { notFound } from 'next/navigation'
import Link from 'next/link'
import ArticleCard from '@/components/ArticleCard'

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
  bias_score: number | null
  confidence: number | null
  sentiment_score: number | null
  intensity_score: number | null
}

interface ChannelPayload {
  source: Source
  total: number
  articles: Article[]
}

async function getChannel(id: string): Promise<ChannelPayload | null> {
  try {
    const base = process.env.ML_SERVICE_URL ?? 'http://localhost:8421'
    const res = await fetch(`${base}/channels/${id}?limit=30`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

const CATEGORY_META: Record<string, { label: string; tint: string; dot: string }> = {
  finance:     { label: 'Finance',     tint: 'from-[var(--wash-emerald-1)] via-[var(--wash-emerald-1)] to-background', dot: 'bg-emerald-500' },
  geopolitics: { label: 'Geopolitics', tint: 'from-[var(--wash-indigo-1)] via-[var(--wash-sky-1)] to-background',      dot: 'bg-indigo-500' },
  science:     { label: 'Science',     tint: 'from-[var(--wash-violet-1)] via-[var(--wash-fuchsia-1)] to-background',  dot: 'bg-violet-500' },
  general:     { label: 'General',     tint: 'from-[var(--wash-stone-1)] via-[var(--wash-stone-1)] to-background',   dot: 'bg-stone-500' },
}

const BIAS_LABEL: Record<string, string> = {
  far_left: 'Far left',
  left: 'Left',
  lean_left: 'Lean left',
  center: 'Center',
  lean_right: 'Lean right',
  right: 'Right',
  far_right: 'Far right',
}

export default async function ChannelPage({ params }: { params: { id: string } }) {
  const payload = await getChannel(params.id)
  if (!payload) notFound()

  const meta = CATEGORY_META[payload.source.category ?? 'general'] ?? CATEGORY_META.general
  const biasLabel = BIAS_LABEL[payload.source.allsides_label] ?? payload.source.allsides_label
  const articles = payload.articles

  // Source-name watermark size: first 16 chars look good at this clamp range
  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-6">
      <Link
        href="/feed"
        className="inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        ← Feed
      </Link>

      {/* Channel masthead — big tinted banner with the publication wordmark
          and a small metadata strip. Mirrors Apple News's publisher header. */}
      <div className={`relative news-card overflow-hidden mb-8 bg-gradient-to-br ${meta.tint}`}>
        <div className="relative px-6 sm:px-10 py-10 sm:py-12">
          <div className="flex items-center gap-2 mb-3 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${meta.dot}`} />
            <span>{meta.label}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{biasLabel}</span>
          </div>
          <h1 className="font-serif text-4xl sm:text-[56px] font-bold leading-[1.02] tracking-tight [text-wrap:balance]">
            {payload.source.name}
          </h1>
          <p className="mt-4 text-sm text-muted-foreground tabular-nums">
            {payload.total} article{payload.total === 1 ? '' : 's'} ingested
          </p>
        </div>
      </div>

      {/* About this channel — small bias note in editorial voice */}
      <section className="news-card p-5 sm:p-6 mb-8 max-w-prose">
        <p className="news-section-label mb-2">About this channel</p>
        <p className="text-[14px] leading-relaxed text-foreground/85">
          AllSides rates <strong className="font-semibold text-foreground">{payload.source.name}</strong> as{' '}
          <strong className="font-semibold text-foreground">{biasLabel.toLowerCase()}</strong>
          {payload.source.allsides_score !== 0 && (
            <> (score {payload.source.allsides_score > 0 ? '+' : ''}{payload.source.allsides_score})</>
          )}
          . ClearLens scores each article&apos;s individual language to detect when a piece leans further than its outlet&apos;s baseline.
        </p>
      </section>

      {/* Latest articles */}
      <section>
        <p className="news-section-label mb-4">Latest from {payload.source.name}</p>
        {articles.length === 0 ? (
          <div className="news-card text-center py-12">
            <p className="font-semibold">No articles ingested yet.</p>
            <p className="text-sm text-muted-foreground mt-1.5">Refresh the feed to pull the latest.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {articles.map(a => <ArticleCard key={a.id} article={a} />)}
          </div>
        )}
      </section>
    </div>
  )
}
