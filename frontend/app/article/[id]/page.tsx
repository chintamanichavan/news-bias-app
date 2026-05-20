import { notFound } from 'next/navigation'
import Link from 'next/link'
import BiasGauge from '@/components/BiasGauge'
import SentimentPanel from '@/components/SentimentPanel'
import FeedbackPanel from '@/components/FeedbackPanel'

interface Article {
  id: string
  title: string
  url: string
  body: string | null
  image_url: string | null
  published: string | null
  source: {
    id: string; name: string; category?: string
    allsides_score: number; allsides_label: string
  }
  bias_score: number | null
  confidence: number | null
  sentiment_score: number | null
  intensity_score: number | null
  emotion_breakdown: Record<string, number> | null
}

async function getArticle(id: string): Promise<Article | null> {
  try {
    const base = process.env.ML_SERVICE_URL ?? 'http://localhost:8421'
    const res = await fetch(`${base}/articles/${id}`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-emerald-700',
  geopolitics: 'text-indigo-700',
  science:     'text-violet-700',
  general:     'text-stone-600',
}

// Category-tinted gradient used as the hero fallback when an article has no
// image. Matches the Top-page / Feed-card treatment so a no-image article
// still has visual anchor at the top of the reader.
const CATEGORY_TINT: Record<string, string> = {
  finance:     'bg-gradient-to-br from-emerald-100 via-emerald-50 to-stone-50',
  geopolitics: 'bg-gradient-to-br from-indigo-100 via-sky-50 to-stone-50',
  science:     'bg-gradient-to-br from-violet-100 via-fuchsia-50 to-stone-50',
  general:     'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
}

function formatDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
}

export default async function ArticlePage({ params }: { params: { id: string } }) {
  const article = await getArticle(params.id)
  if (!article) notFound()

  const biasScore = article.bias_score ?? article.source.allsides_score
  const confidence = article.confidence ?? 0.3
  const polarity = article.sentiment_score ?? 0
  const intensity = article.intensity_score ?? 0
  const tone = CATEGORY_TONE[article.source.category ?? 'general'] ?? CATEGORY_TONE.general
  const tint = CATEGORY_TINT[article.source.category ?? 'general'] ?? CATEGORY_TINT.general

  return (
    <article className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/"
        className="inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        ← Top Stories
      </Link>

      {/* Editorial meta strip — Apple-News-style uppercase source + dot date */}
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] mb-4">
        <span className={tone}>{article.source.name}</span>
        {article.published && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground tabular-nums normal-case tracking-normal">{formatDate(article.published)}</span>
          </>
        )}
      </div>

      {/* Oversized editorial headline */}
      <h1 className="text-3xl sm:text-[40px] font-bold leading-[1.1] tracking-tight mb-6">
        {article.title}
      </h1>

      {/* Hero — image when available, otherwise a category-tinted gradient
          with the source name as a soft watermark. */}
      {article.image_url ? (
        <div className="relative rounded-2xl overflow-hidden mb-8 bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={article.image_url}
            alt=""
            className="w-full h-auto max-h-[440px] object-cover"
          />
        </div>
      ) : (
        <div className={`relative rounded-2xl overflow-hidden mb-8 aspect-[16/7] ${tint}`}>
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <span className="text-[clamp(40px,9vw,96px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.08] select-none text-center line-clamp-2">
              {article.source.name}
            </span>
          </div>
        </div>
      )}

      {/* RSS body — generous reading column with serif-y proportions */}
      {article.body && (
        <div className="text-[17px] leading-[1.65] text-foreground/90 mb-8 whitespace-pre-line">
          {article.body}
        </div>
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:opacity-60 transition-opacity mb-10"
      >
        Read full article at {article.source.name} →
      </a>

      {/* Bias analysis — shown after the read so it doesn't prime the reader */}
      <section className="news-card p-6 sm:p-7 mb-4">
        <p className="news-section-label mb-4">Political bias</p>
        <BiasGauge score={biasScore} confidence={confidence} size="lg" />
        <p className="text-[13px] text-muted-foreground mt-4 leading-relaxed">
          Source baseline: AllSides rates <strong className="font-semibold text-foreground">{article.source.name}</strong> as{' '}
          <strong className="font-semibold text-foreground">{article.source.allsides_label.replace('_', ' ')}</strong>.
          {article.bias_score !== null
            ? ' Our ML model analysed this article\'s specific language.'
            : ' Score shown is the source baseline (not yet analysed).'}
        </p>
      </section>

      {/* Sentiment analysis */}
      <section className="news-card p-6 sm:p-7 mb-8">
        <p className="news-section-label mb-4">Tone &amp; emotion</p>
        <SentimentPanel
          polarity={polarity}
          intensity={intensity}
          emotionBreakdown={article.emotion_breakdown}
        />
      </section>

      <section className="mb-6">
        <p className="news-section-label mb-3">Help improve the model</p>
        <FeedbackPanel
          articleId={article.id}
          bias={{ score: biasScore, confidence }}
          sentiment={{ polarity, intensity }}
        />
      </section>
    </article>
  )
}
