import Link from 'next/link'

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

// Apple-News-style: every source name uses the same uppercase tracking idiom,
// but the color hints at the section the source belongs to.
const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-emerald-700',
  geopolitics: 'text-indigo-700',
  science:     'text-violet-700',
  general:     'text-stone-600',
}

const CATEGORY_TINT: Record<string, string> = {
  finance:     'from-emerald-50 to-transparent',
  geopolitics: 'from-indigo-50 to-transparent',
  science:     'from-violet-50 to-transparent',
  general:     'from-stone-50 to-transparent',
}

function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const hours = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ArticleCard({ article }: { article: Article }) {
  const category = article.source.category ?? 'general'
  const tone = CATEGORY_TONE[category] ?? CATEGORY_TONE.general
  const tint = CATEGORY_TINT[category] ?? CATEGORY_TINT.general

  const candidate = (article.summary && article.summary.trim().length > 10)
    ? article.summary
    : (article.body || '')
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const titleNorm = norm(article.title)
  const candNorm = norm(candidate)
  const excerpt =
    candidate &&
    candNorm !== titleNorm &&
    !(candNorm.startsWith(titleNorm) && candNorm.length < titleNorm.length + 30)
      ? candidate
      : ''

  return (
    <Link href={`/article/${article.id}`} className="group block news-card news-card-hover overflow-hidden h-full">
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
        <div className={`w-full h-20 bg-gradient-to-br ${tint}`} />
      )}
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium">
          <span className={`uppercase tracking-wider ${tone}`}>{article.source.name}</span>
          {article.published && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground tabular-nums">{formatTime(article.published)}</span>
            </>
          )}
        </div>

        <h2 className="text-[15px] sm:text-base font-semibold leading-snug tracking-tight line-clamp-3 group-hover:text-foreground/80 transition-colors">
          {article.title}
        </h2>

        {excerpt && (
          <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-4">
            {excerpt}
          </p>
        )}
      </div>
    </Link>
  )
}
