import Link from 'next/link'
import { Analytics, ago } from '@/lib/analytics'
import { MagnitudeBar, SpreadBar } from './Primitives'

export default function CoveragePanel({ coverage }: { coverage: Analytics['coverage'] }) {
  const { size_distribution, top, blindspots, total_groups, clustered_articles } = coverage
  const maxGroups = Math.max(1, ...size_distribution.map(s => s.groups))
  const widest = Math.max(1, ...top.map(g => g.outlets))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-6">
      {/* ── Cluster size distribution ── */}
      <div className="news-card p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-4">
          How many outlets per story
        </p>
        {size_distribution.length === 0 ? (
          <p className="text-sm text-muted-foreground">No clusters yet.</p>
        ) : (
          <div className="space-y-2.5">
            {size_distribution.map(s => (
              <MagnitudeBar
                key={s.outlets}
                label={`${s.outlets} outlets`}
                value={s.groups}
                max={maxGroups}
                caption={`${s.groups}`}
              />
            ))}
          </div>
        )}

        <dl className="mt-5 pt-4 border-t border-border/60 space-y-2 text-[12px]">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Clustered stories</dt>
            <dd className="tabular-nums font-medium">{total_groups.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Articles inside a cluster</dt>
            <dd className="tabular-nums font-medium">{clustered_articles.toLocaleString()}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Left blindspots</dt>
            <dd className="tabular-nums font-medium">{blindspots.left}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Right blindspots</dt>
            <dd className="tabular-nums font-medium">{blindspots.right}</dd>
          </div>
        </dl>

        {blindspots.left + blindspots.right === 0 && (
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80 border-l-2 border-border pl-2.5">
            A blindspot needs ≥4 outlets on one story with ≥70% from a single side. None qualify
            right now — see <Link href="/stories" className="underline underline-offset-2">Same Story</Link>.
          </p>
        )}
      </div>

      {/* ── Most-covered stories ── */}
      <div className="news-card overflow-hidden">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground px-5 pt-5 pb-3">
          Most-covered stories
        </p>
        {top.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-muted-foreground">No clusters yet.</p>
        ) : (
          <div className="divide-y divide-border/60">
            {top.map(g => {
              const body = (
                <>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="h-1 rounded-full w-10 shrink-0 bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(g.outlets / widest) * 100}%`,
                          background: 'var(--viz-magnitude)',
                        }}
                      />
                    </div>
                    <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground tabular-nums">
                      {g.outlets} outlets · {g.articles} articles
                    </span>
                    {g.bias_range != null && g.bias_range > 0 && (
                      <span
                        className="text-[10px] tabular-nums text-muted-foreground ml-auto"
                        title="Spread between the most- and least-biased framing in this cluster"
                      >
                        Δbias {g.bias_range.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <p className="font-semibold text-[14px] leading-snug tracking-tight line-clamp-2">
                    {g.headline ?? 'Untitled story'}
                  </p>
                  <SpreadBar
                    left={g.spread.left}
                    center={g.spread.center}
                    right={g.spread.right}
                    className="mt-2"
                  />
                  <p className="mt-1.5 text-[11px] text-muted-foreground truncate">
                    {g.sources.slice(0, 4).join(' · ')}
                    {g.sources.length > 4 && ` +${g.sources.length - 4}`}
                    {g.published && ` · ${ago(g.published)}`}
                  </p>
                </>
              )
              return g.article_id ? (
                <Link
                  key={g.group_id}
                  href={`/article/${g.article_id}`}
                  className="block px-5 py-3.5 hover:bg-muted/30 transition-colors"
                >
                  {body}
                </Link>
              ) : (
                <div key={g.group_id} className="px-5 py-3.5">
                  {body}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
