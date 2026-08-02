/**
 * Loading placeholders shared by every route's `loading.tsx`.
 *
 * App Router renders these instantly on navigation, before the server
 * component has finished — without them a tab switch just freezes on the old
 * page. Shapes mirror the real layout so nothing jumps when content lands.
 */

export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />
}

/** Editorial masthead: kicker, headline, standfirst. */
export function SkeletonHeader() {
  return (
    <header className="mb-8">
      <SkeletonBlock className="h-3 w-32 rounded-full" />
      <SkeletonBlock className="h-9 w-64 mt-2.5" />
      <SkeletonBlock className="h-4 w-full max-w-prose mt-4" />
      <SkeletonBlock className="h-4 w-2/3 max-w-prose mt-2" />
    </header>
  )
}

export function SkeletonCards({ count = 4, className = 'h-44' }: { count?: number; className?: string }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`news-card ${className} skeleton`} />
      ))}
    </div>
  )
}

/** KPI tile row — the six stat tiles at the top of Insights. */
export function SkeletonTiles({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="news-card px-4 py-3.5">
          <SkeletonBlock className="h-2.5 w-16 rounded-full" />
          <SkeletonBlock className="h-6 w-20 mt-2.5" />
          <SkeletonBlock className="h-2.5 w-24 mt-2.5 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** A titled panel with a chart-shaped void inside. */
export function SkeletonPanel({ height = 'h-56' }: { height?: string }) {
  return (
    <div className="news-card p-5">
      <SkeletonBlock className="h-2.5 w-40 rounded-full" />
      <SkeletonBlock className={`${height} w-full mt-4`} />
    </div>
  )
}

/** Section heading above a panel. */
export function SkeletonSectionHead() {
  return (
    <div className="mb-4">
      <SkeletonBlock className="h-3 w-24 rounded-full" />
      <SkeletonBlock className="h-6 w-48 mt-2" />
    </div>
  )
}

/** Generic page shell: masthead + a stack of cards. */
export default function PageSkeleton({
  cards = 5,
  cardHeight = 'h-44',
}: {
  cards?: number
  cardHeight?: string
}) {
  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      <SkeletonHeader />
      <SkeletonCards count={cards} className={cardHeight} />
    </div>
  )
}
