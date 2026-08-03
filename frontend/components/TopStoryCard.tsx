import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

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
  sentiment_score: number | null
  intensity_score: number | null
  coverage: Coverage
}

const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-[var(--ink-emerald)]',
  geopolitics: 'text-[var(--ink-indigo)]',
  science:     'text-[var(--ink-violet)]',
  general:     'text-muted-foreground',
}

// Fallback art for image-less cards — a soft category-tinted gradient that
// occupies the same visual slot the image would, so a no-image card doesn't
// collapse into "headline floating in white space" next to siblings with images.
const CATEGORY_TINT: Record<string, string> = {
  finance:     'bg-gradient-to-br from-[var(--wash-emerald-1)] via-[var(--wash-emerald-2)] to-background',
  geopolitics: 'bg-gradient-to-br from-[var(--wash-indigo-1)] via-[var(--wash-sky-2)] to-background',
  science:     'bg-gradient-to-br from-[var(--wash-violet-1)] via-[var(--wash-fuchsia-2)] to-background',
  general:     'bg-gradient-to-br from-[var(--wash-stone-1)] via-[var(--wash-stone-2)] to-background',
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

// Apple-News-style italic-serif kicker for the hero — categorizes the story
// in editorial voice ("ANALYSIS", "POLITICS", etc).
const CATEGORY_KICKER: Record<string, string> = {
  finance:     'Finance',
  geopolitics: 'Geopolitics',
  science:     'Science',
  general:     'Top Story',
}

function MetaRow({ story, accent, light }: { story: TopStory; accent?: string; light?: boolean }) {
  const tone = CATEGORY_TONE[story.source.category ?? 'general'] ?? CATEGORY_TONE.general
  const meta = light ? 'text-white/75' : 'text-muted-foreground'
  const dot = light ? 'text-white/50' : 'text-muted-foreground'
  return (
    <div className="flex items-center gap-1.5 text-[11px] font-medium">
      <span className={`uppercase tracking-wider ${light ? 'text-white' : (accent ?? tone)}`}>{story.source.name}</span>
      {story.published && (
        <>
          <span className={dot}>·</span>
          <span className={`${meta} tabular-nums`}>{formatTime(story.published)}</span>
        </>
      )}
      {story.coverage.count > 1 && (
        <>
          <span className={dot}>·</span>
          <span className={`${meta} tabular-nums`} title={story.coverage.sources.join(', ')}>
            {story.coverage.count} sources
          </span>
        </>
      )}
    </div>
  )
}

// ── Hero variant ───────────────────────────────────────────────────────────
// Editorial centerpiece. Full-width, big image, oversized headline.

export function HeroStoryCard({ story }: { story: TopStory }) {
  const snippet = useSnippet(story)
  const tint = CATEGORY_TINT[story.source.category ?? 'general'] ?? CATEGORY_TINT.general
  const kicker = CATEGORY_KICKER[story.source.category ?? 'general'] ?? CATEGORY_KICKER.general

  // With an image: text overlay over the photo with a bottom-up dark gradient.
  // Without an image: traditional stack (watermark hero → meta + headline below).
  if (story.image_url) {
    return (
      <Link href={`/article/${story.id}`} className="group block news-card news-card-hover overflow-hidden">
        <div className="relative w-full aspect-[16/9] sm:aspect-[2/1] xl:aspect-[5/2] 2xl:aspect-[3/1] max-h-[72vh] bg-muted overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          {/* Bottom-up scrim — Apple News-style dark gradient for legibility */}
          <div className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black/85 via-black/40 to-transparent pointer-events-none" />
          {/* Editorial kicker — top left, italic serif */}
          <div className="absolute top-5 left-5 sm:top-7 sm:left-7">
            <span className="news-kicker text-white" style={{ color: 'rgba(255,255,255,0.95)' }}>
              <em>{kicker}</em>
            </span>
          </div>
          {/* Headline + meta — bottom left */}
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
            <h2 className="font-serif text-white text-[26px] sm:text-[34px] xl:text-[40px] font-bold leading-[1.1] tracking-tight max-w-[26ch] [text-wrap:balance]">
              {story.title}
            </h2>
            {snippet && (
              <p className="mt-3 text-[14px] sm:text-[15px] leading-relaxed text-white/85 line-clamp-2 max-w-[60ch]">
                {snippet}
              </p>
            )}
            <div className="mt-3">
              <MetaRow story={story} light />
            </div>
          </div>
        </div>
      </Link>
    )
  }

  // No image — original stacked layout with the watermark fallback
  return (
    <Link href={`/article/${story.id}`} className="group block news-card news-card-hover overflow-hidden">
      <div className={`relative w-full aspect-[16/7] sm:aspect-[5/2] xl:aspect-[3/1] 2xl:aspect-[16/5] max-h-[64vh] overflow-hidden ${tint}`}>
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <span className="text-[clamp(40px,8vw,80px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.08] select-none">
            {story.source.name}
          </span>
        </div>
        <div className="absolute top-5 left-6 sm:top-7 sm:left-8">
          <span className="news-kicker"><em>{kicker}</em></span>
        </div>
      </div>
      <div className="p-6 sm:p-8">
        <MetaRow story={story} />
        <h2 className="mt-3 font-serif text-[26px] sm:text-[32px] xl:text-[36px] font-bold leading-[1.12] tracking-tight group-hover:text-foreground/80 transition-colors [text-wrap:balance]">
          {story.title}
        </h2>
        {snippet && (
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground line-clamp-3 max-w-[62ch]">
            {snippet}
          </p>
        )}
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
        <h3 className="mt-2 font-serif text-[19px] sm:text-[21px] font-semibold leading-[1.18] tracking-tight line-clamp-3 group-hover:text-foreground/80 transition-colors [text-wrap:balance]">
          {story.title}
        </h3>
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
      <h3 className="mt-1 font-serif text-[16px] sm:text-[17px] font-semibold leading-snug tracking-tight line-clamp-2 group-hover:text-foreground/80 transition-colors">
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
