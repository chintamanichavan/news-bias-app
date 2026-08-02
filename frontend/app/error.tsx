'use client'

import { useEffect } from 'react'
import Link from 'next/link'

/**
 * Route-level error boundary.
 *
 * Server components that fetch (Insights, Stats) previously took the whole
 * page down on a malformed payload — the TypeScript types are compile-time
 * only, so a renamed field upstream surfaces as a render crash. This degrades
 * to something readable and retryable instead.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[route error]', error)
  }, [error])

  return (
    <div className="max-w-2xl mx-auto px-4 py-24 text-center">
      <p className="news-section-label">Something went wrong</p>
      <h1 className="mt-2 text-2xl sm:text-3xl font-bold tracking-tight">
        This page couldn&rsquo;t load
      </h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
        The data behind it came back in a shape the page didn&rsquo;t expect. The rest of the app
        is unaffected.
      </p>
      {error.digest && (
        <p className="mt-2 text-[11px] text-muted-foreground/70 tabular-nums">
          Reference {error.digest}
        </p>
      )}
      <div className="mt-7 flex items-center justify-center gap-2.5">
        <button
          onClick={reset}
          className="text-[13px] px-4 py-2 rounded-full bg-foreground text-background font-medium hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link
          href="/"
          className="text-[13px] px-4 py-2 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Back to Top Stories
        </Link>
      </div>
    </div>
  )
}
