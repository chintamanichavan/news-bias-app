import Link from 'next/link'

interface Entry {
  href: string
  label: string
  blurb: string
  tone: string         // tailwind text utility for the label tone
  tint: string         // tailwind bg gradient for the card hero
}

// Apple News calls these "Channels" or "Browse" — bottom-of-page exit ramps so
// the layout always offers somewhere to scroll into next.
const ALL_ENTRIES: Entry[] = [
  {
    href: '/digest',
    label: 'Digest',
    blurb: '60-second extracts, one card per story',
    tone: 'text-foreground',
    tint: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
  },
  {
    href: '/feed',
    label: 'Feed',
    blurb: 'Every article, filterable by source or category',
    tone: 'text-foreground',
    tint: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
  },
  {
    href: '/stories',
    label: 'Same Story',
    blurb: 'Cross-source clusters + left/right blindspots',
    tone: 'text-foreground',
    tint: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
  },
  {
    href: '/insights',
    label: 'Insights',
    blurb: 'Corpus-wide bias, tone, cadence and coverage',
    tone: 'text-foreground',
    tint: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
  },
  {
    href: '/markets',
    label: 'Markets',
    blurb: 'Indices, equities, commodities, futures',
    tone: 'text-emerald-700',
    tint: 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-stone-50',
  },
  {
    href: '/weather',
    label: 'Weather',
    blurb: 'Hourly forecast, air quality, sun arc',
    tone: 'text-indigo-700',
    tint: 'bg-gradient-to-br from-indigo-100 via-sky-50 to-stone-50',
  },
  {
    href: '/',
    label: 'Top Stories',
    blurb: 'Editorial digest of the most-covered events',
    tone: 'text-foreground',
    tint: 'bg-gradient-to-br from-stone-100 via-stone-50 to-background',
  },
]

interface Props {
  /** Optional list of routes to exclude (typically the current page). */
  excludeHrefs?: string[]
}

export default function ExploreFooter({ excludeHrefs = [] }: Props) {
  const entries = ALL_ENTRIES.filter(e => !excludeHrefs.includes(e.href))
  return (
    <section className="mt-14 pt-10 border-t border-border/60">
      <p className="news-section-label mb-4">Explore</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {entries.map(e => (
          <Link
            key={e.href}
            href={e.href}
            className="group news-card news-card-hover overflow-hidden block"
          >
            <div className={`relative h-16 ${e.tint}`}>
              <div className="absolute inset-0 flex items-center px-4">
                <span className={`text-[clamp(20px,3.5vw,28px)] font-bold tracking-tighter leading-none ${e.tone} opacity-90`}>
                  {e.label}
                </span>
              </div>
            </div>
            <div className="px-4 py-3">
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                {e.blurb}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
