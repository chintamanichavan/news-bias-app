import { SkeletonHeader, SkeletonPanel, SkeletonTiles } from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <SkeletonHeader />
      {[0, 1].map(i => (
        <section key={i} className="mb-12">
          <SkeletonTiles count={4} />
          <div className="mt-5">
            <SkeletonPanel height="h-40" />
          </div>
        </section>
      ))}
    </div>
  )
}
