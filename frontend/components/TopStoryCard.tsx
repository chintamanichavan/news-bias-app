import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

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

const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-emerald-700',
  geopolitics: 'text-indigo-700',
  science:     'text-violet-700',
  general:     'text-stone-600',
}

// Fallback art for image-less cards — a soft category-tinted gradient that
// occupies the same visual slot the image would, so a no-image card doesn't
// collapse into "headline floating in white space" next to siblings with images.
const CATEGORY_TINT: Record<string, string> = {
  finance:     'bg-gradient-to-br from-emerald-100 via-emerald-50 to-stone-50',
  geopolitics: 'bg-gradient-to-br from-indigo-100 via-sky-50 to-stone-50',
  science:     'bg-gradient-to-br from-violet-100 via-fuchsia-50 to-stone-50',
  general:     'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
}

function formatTime(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const hours = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function useSnippet(story: TopStory): string | null {
  const candidate = (story.summary && story.summary.trim().length > 10)
    ? story.summary
    : (story.body || '').slice(0, 240)
  const norm = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const t = norm(story.title)
  const c = norm(candidate)
  if (!c || c === t) return null
  if (c.startsWith(t) && c.length < t.length + 30) return null
  return candidate
}

function MetaRow({ story, accent }: { story: TopStory; accent?: string }) {
  const tone = CATEGORY_TONE[story.source.category ?? 'general'] ?? CATEGORY_TONE.general
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium">
      <span className={`uppercase tracking-wider ${accent ?? tone}`}>{story.source.name}</span>
      {story.published && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground tabular-nums">{formatTime(story.published)}</span>
        </>
      )}
      {story.coverage.count > 1 && (
        <>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground tabular-nums" title={story.coverage.sources.join(', ')}>
            {story.coverage.count} sources
          </span>
        </>
      )}
    </div>
  )
}

function MarketBadge({ sig }: { sig: MarketSignal }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-[11px] mt-2 px-2 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200/60">
      <span>🎯 {Math.round(sig.yes_price * 100)}%</span>
      <span className={`tabular-nums font-medium ${sig.yes_change_24h > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
        {sig.yes_change_24h > 0 ? '↑' : '↓'}{Math.abs(Math.round(sig.yes_change_24h * 100))}pt
      </span>
      <span className="opacity-70 line-clamp-1 max-w-[14em]">{sig.question}</span>
    </div>
  )
}

// ── Hero variant ───────────────────────────────────────────────────────────
// Editorial centerpiece. Full-width, big image, oversized headline.

export function HeroStoryCard({ story }: { story: TopStory }) {
  const snippet = useSnippet(story)
  const tint = CATEGORY_TINT[story.source.category ?? 'general'] ?? CATEGORY_TINT.general
  return (
    <Link href={`/article/${story.id}`} className="group block news-card news-card-hover overflow-hidden">
      {story.image_url ? (
        <div className="relative w-full aspect-[16/9] sm:aspect-[2/1] bg-muted overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      ) : (
        <div className={`relative w-full aspect-[16/7] sm:aspect-[5/2] overflow-hidden ${tint}`}>
          {/* Big oversized headline ghost — visual anchor on text-only stories.
              Inherits category tone via the gradient above. */}
          <div className="absolute inset-0 flex items-center justify-center p-8">
            <span className="text-[clamp(40px,8vw,80px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.08] select-none">
              {story.source.name}
            </span>
          </div>
        </div>
      )}
      <div className="p-6 sm:p-7">
        <MetaRow story={story} />
        <h2 className="mt-2.5 text-2xl sm:text-[28px] font-bold leading-[1.15] tracking-tight group-hover:text-foreground/80 transition-colors">
          {story.title}
        </h2>
        {snippet && (
          <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground line-clamp-3">
            {snippet}
          </p>
        )}
        {story.market_signal && <MarketBadge sig={story.market_signal} />}
      </div>
    </Link>
  )
}

// ── Medium variant ─────────────────────────────────────────────────────────
// Used in the 2-column secondary row.

export function MediumStoryCard({ story }: { story: TopStory }) {
  const tint = CATEGORY_TINT[story.source.category ?? 'general'] ?? CATEGORY_TINT.general
  return (
    <Link href={`/article/${story.id}`} className="group block news-card news-card-hover overflow-hidden h-full flex flex-col">
      {story.image_url ? (
        <div className="relative w-full aspect-[16/9] bg-muted overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        </div>
      ) : (
        <div className={`relative w-full aspect-[16/9] overflow-hidden ${tint}`}>
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <span className="text-[clamp(28px,5vw,44px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.1] select-none text-center">
              {story.source.name}
            </span>
          </div>
        </div>
      )}
      <div className="p-4 sm:p-5 flex-1 flex flex-col">
        <MetaRow story={story} />
        <h3 className="mt-2 text-[17px] sm:text-[19px] font-semibold leading-snug tracking-tight line-clamp-3 group-hover:text-foreground/80 transition-colors">
          {story.title}
        </h3>
        {story.market_signal && <MarketBadge sig={story.market_signal} />}
      </div>
    </Link>
  )
}

// ── Compact variant ────────────────────────────────────────────────────────
// Used for the trending list. No image, two-line title, fine separators.

export function CompactStoryRow({ story }: { story: TopStory }) {
  return (
    <Link href={`/article/${story.id}`} className="group block py-3.5 first:pt-0 last:pb-0 border-b border-border/60 last:border-b-0">
      <MetaRow story={story} />
      <h3 className="mt-1 text-[15px] sm:text-base font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-foreground/80 transition-colors">
        {story.title}
      </h3>
    </Link>
  )
}

// Default export kept for any existing imports — renders the medium variant.
export default function TopStoryCard({ story }: { story: TopStory; rank?: number }) {
  return <MediumStoryCard story={story} />
}

// Re-export Badge so other call-sites don't have to know about the indirection.
export { Badge }
