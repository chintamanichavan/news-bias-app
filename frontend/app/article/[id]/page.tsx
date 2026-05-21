import { Fragment } from 'react'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import BiasGauge from '@/components/BiasGauge'
import SentimentPanel from '@/components/SentimentPanel'
import FeedbackPanel from '@/components/FeedbackPanel'
import RelatedReading from '@/components/RelatedReading'

interface Article {
  id: string
  title: string
  url: string
  body: string | null
  summary: string | null
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

/** Pick a single representative sentence for the pull-quote from the LexRank
 *  summary. Skip sentences that just restate the title (FT-style stubs). */
function buildPullQuote(title: string, summary: string, paragraphs: string[]): string | null {
  if (!summary) return null
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const titleNorm = norm(title)
  // Split summary into sentences, score by length (favor 80-180 char "essay" sentences)
  const sentences = summary
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map(s => s.trim())
    .filter(s => {
      const n = norm(s)
      if (n.length < 30) return false                                  // too short
      if (n === titleNorm) return false                                // title repeat
      if (n.startsWith(titleNorm) && n.length < titleNorm.length + 30) return false
      return true
    })
  if (!sentences.length) return null
  // Sweet spot ~120 chars
  sentences.sort((a, b) => Math.abs(a.length - 120) - Math.abs(b.length - 120))
  const chosen = sentences[0]
  // Don't quote a sentence that's already in the first 2 paragraphs (it'd
  // appear duplicated in the layout).
  const head = (paragraphs[0] + ' ' + (paragraphs[1] || '')).toLowerCase()
  if (head.includes(chosen.toLowerCase().slice(0, 40))) return null
  return chosen
}

function PullQuote({ text }: { text: string }) {
  return (
    <figure className="my-8 sm:my-10 px-4 sm:px-8">
      <blockquote className="font-serif italic text-[24px] sm:text-[28px] leading-[1.3] text-foreground text-center [text-wrap:balance]">
        <span className="news-kicker not-italic relative -top-1 mr-2 text-[18px]">“</span>
        {text.replace(/^["“”]+|["“”]+$/g, '')}
        <span className="news-kicker not-italic relative -top-1 ml-2 text-[18px]">”</span>
      </blockquote>
    </figure>
  )
}

/** Estimated reading time in minutes — based on a 230 wpm reading speed
 *  (typical for editorial nonfiction). Floors to 1 so very short summaries
 *  still show a meaningful number. */
function readingTime(body: string | null): number {
  if (!body) return 1
  const words = body.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 230))
}

// RSS bodies come as one string with mixed whitespace. We split on blank
// lines first, fall back to single newlines, then drop empties. Each chunk
// becomes a real <p> so the drop-cap CSS can target it.
function splitParagraphs(body: string): string[] {
  if (!body) return []
  const text = body.replace(/\r\n/g, '\n').trim()
  const blocks = text.includes('\n\n')
    ? text.split(/\n{2,}/)
    : text.split(/\n/)
  return blocks.map(s => s.trim()).filter(Boolean)
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

      {/* Editorial meta strip — source · reading time · published */}
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] mb-4">
        <Link
          href={`/channel/${article.source.id}`}
          className={`${tone} hover:opacity-70 transition-opacity`}
        >
          {article.source.name}
        </Link>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground tabular-nums normal-case tracking-normal">
          {readingTime(article.body)} min read
        </span>
        {article.published && (
          <>
            <span className="text-muted-foreground/60">·</span>
            <span className="text-muted-foreground tabular-nums normal-case tracking-normal">{formatDate(article.published)}</span>
          </>
        )}
      </div>

      {/* Oversized editorial headline — serif, generous, balanced wrap */}
      <h1 className="font-serif text-[32px] sm:text-[44px] font-bold leading-[1.08] tracking-tight mb-6 [text-wrap:balance]">
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

      {/* Article body — serif editorial reader with drop cap on the first
          paragraph. We split on blank lines so the drop cap targets a real
          <p>. For longer articles, we lift the LexRank summary into a
          centered serif italic pull-quote between paragraphs 2 and 3. */}
      {article.body && (() => {
        const paragraphs = splitParagraphs(article.body)
        const pullQuote = paragraphs.length >= 6 && article.summary ? buildPullQuote(article.title, article.summary, paragraphs) : null
        return (
          <div className="news-prose mb-8">
            {paragraphs.map((p, i) => (
              <Fragment key={i}>
                <p className={i > 0 ? 'mt-5' : ''}>{p}</p>
                {pullQuote && i === 1 && (
                  <PullQuote text={pullQuote} />
                )}
              </Fragment>
            ))}
          </div>
        )
      })()}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground hover:opacity-60 transition-opacity mb-10"
      >
        Read full article at {article.source.name} →
      </a>

      {/* End-of-article: cross-source coverage + more from this publication */}
      <RelatedReading
        articleId={article.id}
        sourceName={article.source.name}
        sourceId={article.source.id}
      />

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
