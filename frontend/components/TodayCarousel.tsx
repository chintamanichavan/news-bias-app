'use client'

import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { TopStory } from '@/components/TopStoryCard'
import { useHorizontalRail } from '@/lib/useHorizontalRail'

const CATEGORY_TONE: Record<string, string> = {
  finance:     'text-[var(--ink-emerald)]',
  geopolitics: 'text-[var(--ink-indigo)]',
  science:     'text-[var(--ink-violet)]',
  general:     'text-muted-foreground',
}

const CATEGORY_TINT: Record<string, string> = {
  finance:     'bg-gradient-to-br from-[var(--wash-emerald-1)] via-[var(--wash-emerald-2)] to-background',
  geopolitics: 'bg-gradient-to-br from-[var(--wash-indigo-1)] via-[var(--wash-sky-2)] to-background',
  science:     'bg-gradient-to-br from-[var(--wash-violet-1)] via-[var(--wash-fuchsia-2)] to-background',
  general:     'bg-gradient-to-br from-[var(--wash-stone-1)] via-[var(--wash-stone-2)] to-background',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const h = Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60))
  if (h < 1) return 'just now'
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

interface Props {
  stories: TopStory[]
}

export default function TodayCarousel({ stories }: Props) {
  const rail = useHorizontalRail<HTMLDivElement>()
  if (!stories.length) return null

  const scrollable = rail.canLeft || rail.canRight
  return (
    <section className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="news-section-label">Top Stories — at a glance</p>
        {/* Buttons rather than a "Swipe →" hint: with a mouse there is nothing
            to swipe, and the hidden scrollbar left no other way to move. */}
        {scrollable && (
          <div className="flex items-center gap-1">
            <RailButton
              label="Scroll left"
              disabled={!rail.canLeft}
              onClick={() => rail.scrollByPage(-1)}
            >
              <ChevronLeft className="w-4 h-4" />
            </RailButton>
            <RailButton
              label="Scroll right"
              disabled={!rail.canRight}
              onClick={() => rail.scrollByPage(1)}
            >
              <ChevronRight className="w-4 h-4" />
            </RailButton>
          </div>
        )}
      </div>
      {/* Horizontal scroll-snap rail. negative margins let cards bleed to the
          edge of the page so the rail feels native-ish on Mac and mobile. */}
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-10 xl:-mx-14">
        <div
          ref={rail.ref}
          className={`overflow-x-auto snap-x snap-mandatory [&::-webkit-scrollbar]:hidden [scrollbar-width:none] ${
            rail.dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
          }`}
        >
          <div className="flex gap-3 px-4 sm:px-6 lg:px-10 xl:px-14 pb-2">
            {stories.map((story, i) => (
              <CarouselCard key={story.id} story={story} index={i + 1} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function RailButton({
  label, disabled, onClick, children,
}: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid place-items-center w-7 h-7 rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
    >
      {children}
    </button>
  )
}

function CarouselCard({ story, index }: { story: TopStory; index: number }) {
  const cat = story.source.category ?? 'general'
  const tone = CATEGORY_TONE[cat] ?? CATEGORY_TONE.general
  const tint = CATEGORY_TINT[cat] ?? CATEGORY_TINT.general
  return (
    <Link
      href={`/article/${story.id}`}
      className="group news-card news-card-hover overflow-hidden snap-start shrink-0 w-[78%] sm:w-[42%] md:w-[32%] lg:w-[24%] xl:w-[20%] flex flex-col"
    >
      {story.image_url ? (
        <div className="relative w-full aspect-[4/3] bg-muted overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={story.image_url}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-500"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="absolute top-2 left-2 bg-black/55 text-white text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded">
            {String(index).padStart(2, '0')}
          </span>
        </div>
      ) : (
        <div className={`relative w-full aspect-[4/3] overflow-hidden ${tint}`}>
          <div className="absolute inset-0 flex items-center justify-center px-3">
            <span className="text-[clamp(20px,5vw,36px)] font-bold tracking-tighter leading-none text-foreground opacity-[0.1] select-none text-center line-clamp-2">
              {story.source.name}
            </span>
          </div>
          <span className="absolute top-2 left-2 bg-foreground/12 text-foreground text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded">
            {String(index).padStart(2, '0')}
          </span>
        </div>
      )}
      <div className="p-3 flex-1 flex flex-col">
        <div className={`text-[10px] font-medium uppercase tracking-[0.12em] mb-1 ${tone}`}>
          {story.source.name}
          {story.published && (
            <span className="text-muted-foreground normal-case tracking-normal"> · {timeAgo(story.published)}</span>
          )}
        </div>
        <h3 className="font-serif text-[14px] sm:text-[15px] font-semibold leading-snug tracking-tight line-clamp-3 group-hover:text-foreground/80 transition-colors [text-wrap:balance]">
          {story.title}
        </h3>
      </div>
    </Link>
  )
}
