import {
  SkeletonHeader,
  SkeletonPanel,
  SkeletonSectionHead,
  SkeletonTiles,
} from '@/components/Skeleton'

export default function Loading() {
  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      <SkeletonHeader />
      <div className="mb-12">
        <SkeletonTiles />
      </div>
      {['h-56', 'h-72', 'h-72', 'h-96'].map((h, i) => (
        <section key={i} className="mb-12">
          <SkeletonSectionHead />
          <SkeletonPanel height={h} />
        </section>
      ))}
    </div>
  )
}
