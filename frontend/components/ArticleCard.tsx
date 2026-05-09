import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import BiasGauge from '@/components/BiasGauge'
import ToneChip from '@/components/ToneChip'

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
  url: string
  image_url: string | null
  published: string | null
  source: Source
  bias_score: number | null
  confidence: number | null
  sentiment_score: number | null
  intensity_score: number | null
}

const CATEGORY_COLORS: Record<string, string> = {
  finance:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  geopolitics: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
  science:     'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  general:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

// Political bias colors are still used when an article actually has bias signal
const BIAS_COLORS: Record<string, string> = {
  far_left: 'bg-blue-700 text-white',
  left: 'bg-blue-400 text-white',
  lean_left: 'bg-blue-200 text-blue-900 dark:bg-blue-900/40 dark:text-blue-200',
  center: '',  // no extra badge for center
  lean_right: 'bg-red-200 text-red-900 dark:bg-red-900/40 dark:text-red-200',
  right: 'bg-red-400 text-white',
  far_right: 'bg-red-700 text-white',
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ArticleCard({ article }: { article: Article }) {
  const score = article.bias_score ?? article.source.allsides_score
  const confidence = article.confidence ?? 0.3
  const category = article.source.category ?? 'general'
  const categoryClass = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general

  // Hide bias gauge for science/geopolitics by default (most sources are
  // factual/center). Show only when the ML detects genuine lean (|score| > 0.5).
  const hideByDefault = category === 'science' || category === 'geopolitics'
  const showBias = !hideByDefault || Math.abs(score) > 0.5
  const biasLabel = article.source.allsides_label
  const biasBadge = BIAS_COLORS[biasLabel]

  return (
    <Link href={`/article/${article.id}`} className="block group">
      <Card className="overflow-hidden h-full hover:shadow-lg transition-shadow duration-200 border border-border/60">
        {article.image_url && (
          <div className="w-full h-40 overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={article.image_url}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          </div>
        )}
        <CardContent className="p-4 flex flex-col gap-3">
          {/* Source + tone + time */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={`text-[10px] px-2 py-0.5 ${categoryClass}`}>
              {article.source.name}
            </Badge>
            <ToneChip
              polarity={article.sentiment_score}
              intensity={article.intensity_score}
              size="sm"
            />
            {biasBadge && category === 'finance' && (
              <Badge className={`text-[10px] px-1.5 py-0.5 ${biasBadge}`} title={`Source bias: ${biasLabel}`}>
                {biasLabel.replace('_', ' ')}
              </Badge>
            )}
            {article.published && (
              <span className="text-xs text-muted-foreground ml-auto">{formatTime(article.published)}</span>
            )}
          </div>

          {/* Title */}
          <h2 className="text-sm font-semibold leading-snug line-clamp-3 group-hover:text-primary transition-colors">
            {article.title}
          </h2>

          {/* Bias gauge — hidden for science (always center) to reduce visual clutter */}
          {showBias && <BiasGauge score={score} confidence={confidence} size="sm" />}
        </CardContent>
      </Card>
    </Link>
  )
}
