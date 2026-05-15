import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
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
  source: { id: string; name: string; allsides_score: number; allsides_label: string }
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

const LABEL_COLORS: Record<string, string> = {
  far_left: 'bg-blue-700 text-white',
  left: 'bg-blue-400 text-white',
  lean_left: 'bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  center: 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  lean_right: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  right: 'bg-red-400 text-white',
  far_right: 'bg-red-700 text-white',
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
  const labelClass = LABEL_COLORS[article.source.allsides_label] ?? 'bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200'

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground mb-6 inline-flex items-center gap-1">
        ← Back to feed
      </Link>

      {article.image_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.image_url}
          alt=""
          className="w-full h-56 object-cover rounded-xl mb-6 mt-4"
        />
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Badge className={`${labelClass} text-xs`}>{article.source.name}</Badge>
        {article.published && (
          <span className="text-xs text-muted-foreground">{formatDate(article.published)}</span>
        )}
      </div>

      <h1 className="text-2xl font-bold leading-snug mb-4">{article.title}</h1>

      {/* Bias analysis */}
      <div className="rounded-xl border border-border bg-muted/20 p-5 mb-4">
        <p className="text-sm font-semibold mb-3">Political bias</p>
        <BiasGauge score={biasScore} confidence={confidence} size="lg" />
        <p className="text-xs text-muted-foreground mt-3">
          Source baseline: AllSides rates <strong>{article.source.name}</strong> as{' '}
          <strong>{article.source.allsides_label.replace('_', ' ')}</strong>.
          {article.bias_score !== null
            ? ' Our ML model analysed this article\'s specific language.'
            : ' Score shown is the source baseline (not yet analysed).'}
        </p>
      </div>

      {/* Sentiment analysis */}
      <div className="rounded-xl border border-border bg-muted/20 p-5 mb-6">
        <p className="text-sm font-semibold mb-3">Tone &amp; emotion</p>
        <SentimentPanel
          polarity={polarity}
          intensity={intensity}
          emotionBreakdown={article.emotion_breakdown}
        />
      </div>

      {/* Snippet */}
      {article.body && (
        <div className="text-sm leading-relaxed text-muted-foreground mb-6 line-clamp-6">
          {article.body.slice(0, 800)}{article.body.length > 800 ? '…' : ''}
        </div>
      )}

      <a
        href={article.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline mb-8"
      >
        Read full article at {article.source.name} →
      </a>

      <div>
        <p className="text-sm font-semibold mb-3">Help improve the model</p>
        <FeedbackPanel
          articleId={article.id}
          bias={{ score: biasScore, confidence }}
          sentiment={{ polarity, intensity }}
        />
      </div>
    </div>
  )
}
