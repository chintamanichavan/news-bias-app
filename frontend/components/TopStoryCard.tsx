import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import ToneChip from '@/components/ToneChip'

interface MarketSignal {
  question: string
  yes_price: number
  yes_change_24h: number
  url: string | null
  category: string | null
}

interface Source {
  id: string
  name: string
  category?: string
  topic?: string
}

interface Coverage {
  count: number
  sources: string[]
}

export interface TopStory {
  id: string
  title: string
  url: string
  body: string | null
  summary?: string | null
  image_url: string | null
  published: string | null
  source: Source
  bias_score: number | null
  confidence: number | null
  sentiment_score: number | null
  intensity_score: number | null
  coverage: Coverage
  market_signal: MarketSignal | null
}

const CATEGORY_COLORS: Record<string, string> = {
  news:        'bg-teal-100 text-teal-800 dark:bg-teal-950/40 dark:text-teal-300',
  opinion:     'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  finance:     'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  geopolitics: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300',
  science:     'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  general:     'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
}

const CATEGORY_ACCENT: Record<string, string> = {
  news:        'border-l-teal-500',
  opinion:     'border-l-amber-500',
  finance:     'border-l-emerald-500',
  geopolitics: 'border-l-indigo-500',
  science:     'border-l-violet-500',
  general:     'border-l-gray-400',
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const hours = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TopStoryCard({ story, rank }: { story: TopStory; rank: number }) {
  const category = story.source.category ?? 'general'
  const categoryClass = CATEGORY_COLORS[category] ?? CATEGORY_COLORS.general
  const accentClass = CATEGORY_ACCENT[category] ?? CATEGORY_ACCENT.general
  const cov = story.coverage
  const sig = story.market_signal
  // Prefer the curated summary; fall back to a trimmed body slice. Drop the
  // whole snippet line if it would just repeat the headline (FT-style stubs
  // where RSS body == title).
  const candidate = (story.summary && story.summary.trim().length > 10)
    ? story.summary
    : (story.body || '').slice(0, 220)
  const _norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const _titleNorm = _norm(story.title)
  const _candNorm = _norm(candidate)
  const snippetAddsInfo =
    candidate &&
    _candNorm !== _titleNorm &&
    !(_candNorm.startsWith(_titleNorm) && _candNorm.length < _titleNorm.length + 30)
  const snippet = snippetAddsInfo ? candidate : ''

  return (
    <Link href={`/article/${story.id}`} className="block group">
      <Card className={`overflow-hidden h-full hover:shadow-lg transition-all duration-200 border border-border/60 hover:border-border border-l-4 ${accentClass}`}>
        <div className="flex gap-4 p-5">
          {/* Rank */}
          <div className="shrink-0 hidden md:block">
            <span className="text-3xl font-bold text-muted-foreground/40 tabular-nums">
              {String(rank).padStart(2, '0')}
            </span>
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-2.5">
            {/* Top row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge className={`text-[10px] px-2 py-0.5 ${categoryClass}`}>
                {story.source.name}
              </Badge>
              <ToneChip
                polarity={story.sentiment_score}
                intensity={story.intensity_score}
                size="sm"
              />
              {cov.count > 1 && (
                <span
                  className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded"
                  title={cov.sources.join(', ')}
                >
                  📰 {cov.count} outlets
                </span>
              )}
              {story.published && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatTime(story.published)}
                </span>
              )}
            </div>

            {/* Headline */}
            <h2 className="text-base md:text-lg font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
              {story.title}
            </h2>

            {/* Snippet */}
            {snippet && (
              <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
                {snippet}
              </p>
            )}

            {/* Market signal cross-reference */}
            {sig && (
              <div className="flex items-center gap-2 text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-md px-2 py-1.5 mt-1">
                <span className="text-amber-700 dark:text-amber-400">🎯</span>
                <span className="font-medium text-amber-900 dark:text-amber-100">
                  {Math.round(sig.yes_price * 100)}%
                </span>
                <span className={`tabular-nums font-medium ${
                  sig.yes_change_24h > 0
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-rose-700 dark:text-rose-400'
                }`}>
                  {sig.yes_change_24h > 0 ? '↑' : '↓'} {Math.abs(Math.round(sig.yes_change_24h * 100))}pts
                </span>
                <span className="text-muted-foreground line-clamp-1 flex-1 min-w-0">
                  {sig.question}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>
    </Link>
  )
}
