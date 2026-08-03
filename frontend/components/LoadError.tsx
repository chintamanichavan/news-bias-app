'use client'

/**
 * What a tab shows when its data genuinely could not be loaded.
 *
 * The point is that it is distinguishable from "there is nothing here" — the
 * old pages reported a failed fetch as an empty result, which is why a blip
 * looked like real emptiness and only a reload told you otherwise.
 */
export default function LoadError({
  message,
  onRetry,
  retrying = false,
}: {
  message: string
  onRetry: () => void
  retrying?: boolean
}) {
  return (
    <div className="news-card p-8 text-center max-w-md mx-auto my-10">
      <p className="font-semibold">Couldn&rsquo;t load this</p>
      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{message}</p>
      <button
        onClick={onRetry}
        disabled={retrying}
        className="mt-4 text-sm font-semibold px-4 py-1.5 rounded-full border border-border hover:bg-muted/50 transition-colors disabled:opacity-50"
      >
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  )
}
