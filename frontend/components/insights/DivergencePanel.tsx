import Link from 'next/link'
import { Divergence, pct } from '@/lib/analytics'
import { Caveat } from './Primitives'

/**
 * Coverage attention vs market-priced probability, one dumbbell per market.
 *
 * A dumbbell because the gap between the two values *is* the finding — the
 * connector's length is the measurement, not decoration. The two endpoints are
 * distinguished by shape (filled vs ring) and direct labels rather than by two
 * new hues, so nothing here competes with the bias or tone scales.
 */
export default function DivergencePanel({ divergence }: { divergence: Divergence }) {
  const { items, matched_markets, uncovered_markets, window_days } = divergence

  if (items.length === 0) {
    return (
      <div className="news-card p-8 text-center">
        <p className="font-semibold">No overlap to compare yet</p>
        <p className="text-sm text-muted-foreground mt-1.5 max-w-md mx-auto leading-relaxed">
          None of the live markets match a story these outlets ran in the last {window_days} days.
        </p>
      </div>
    )
  }

  return (
    <div className="news-card overflow-hidden">
      {/* Legend — identity by shape, stated once */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 pt-5 pb-4 border-b border-border/50">
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: 'var(--viz-magnitude)' }}
          />
          Coverage here
        </span>
        <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0 border-2 bg-transparent"
            style={{ borderColor: 'var(--viz-magnitude)' }}
          />
          Market probability
        </span>
        <span className="text-[11px] text-muted-foreground ml-auto tabular-nums">
          {matched_markets} covered · {uncovered_markets} not covered here
        </span>
      </div>

      <div className="divide-y divide-border/60">
        {items.map(d => {
          const a = Math.max(0, Math.min(1, d.attention)) * 100
          const p = Math.max(0, Math.min(1, d.probability)) * 100
          const lo = Math.min(a, p)
          const hi = Math.max(a, p)

          return (
            <div key={d.market_id} className="px-5 py-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    {d.direction} · {d.category ?? 'market'}
                  </p>
                  <p className="mt-1 font-semibold text-[14px] leading-snug tracking-tight">
                    {d.url ? (
                      <a
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-[hsl(var(--accent-news))] transition-colors"
                      >
                        {d.question}
                      </a>
                    ) : (
                      d.question
                    )}
                  </p>
                </div>
                <span
                  className="text-[13px] font-bold tabular-nums shrink-0 pt-0.5"
                  title="Gap between coverage share and priced probability"
                >
                  {d.gap > 0 ? '+' : '−'}
                  {Math.abs(Math.round(d.gap * 100))}
                </span>
              </div>

              {/* The dumbbell: connector length is the divergence */}
              <div className="relative h-6" aria-hidden>
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border" />
                <div
                  className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full"
                  style={{
                    left: `${lo}%`,
                    width: `${hi - lo}%`,
                    background: 'var(--viz-magnitude)',
                    opacity: 0.35,
                  }}
                />
                <span
                  className="absolute top-1/2 w-2.5 h-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full"
                  style={{ left: `${a}%`, background: 'var(--viz-magnitude)' }}
                  title={`Coverage: ${d.articles} articles across ${d.outlets} outlets`}
                />
                <span
                  className="absolute top-1/2 w-2.5 h-2.5 -translate-y-1/2 -translate-x-1/2 rounded-full border-2"
                  style={{
                    left: `${p}%`,
                    borderColor: 'var(--viz-magnitude)',
                    background: 'hsl(var(--card))',
                  }}
                  title={`Market: ${pct(d.probability)} implied probability`}
                />
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mt-1.5">
                <p className="text-[11px] text-muted-foreground tabular-nums">
                  {d.articles} article{d.articles === 1 ? '' : 's'} · {d.outlets} outlet
                  {d.outlets === 1 ? '' : 's'} · market at {pct(d.probability)}
                  {d.change_24h != null && d.change_24h !== 0 && (
                    <> ({d.change_24h > 0 ? '+' : ''}{Math.round(d.change_24h * 100)}pp 24h)</>
                  )}
                </p>
                {d.shared_terms.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70">
                    matched on {d.shared_terms.slice(0, 3).join(', ')}
                  </p>
                )}
              </div>

              {d.headlines[0] && (
                <Link
                  href={`/article/${d.headlines[0].id}`}
                  className="mt-1.5 block text-[12px] text-muted-foreground hover:text-foreground transition-colors truncate"
                >
                  ↳ {d.headlines[0].title}
                </Link>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-5 pb-5 pt-1">
        <Caveat>
          Both numbers are measured, neither is a forecast. Coverage is this corpus&rsquo;s article
          count over {window_days} days, scaled against the most-covered market; probability is what
          Polymarket traders are paying. A wide gap is a difference in emphasis, not evidence that
          either side is wrong — a low-probability event can deserve heavy coverage. Articles are
          linked to markets by shared distinctive terms, so matches are approximate.
        </Caveat>
      </div>
    </div>
  )
}
