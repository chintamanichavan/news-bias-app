'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Outlet, ago, divergingVar, duration, signed } from '@/lib/analytics'

type SortKey = 'articles' | 'articles_window' | 'allsides_score' | 'mean_tone' | 'full_text' | 'latest'

const COLUMNS: { key: SortKey; label: string; numeric: boolean }[] = [
  { key: 'articles', label: 'Articles', numeric: true },
  { key: 'articles_window', label: '24h', numeric: true },
  { key: 'allsides_score', label: 'Lean', numeric: true },
  { key: 'mean_tone', label: 'Mean tone', numeric: true },
  { key: 'full_text', label: 'Full text', numeric: true },
  { key: 'latest', label: 'Newest', numeric: false },
]

const LEAN_LABEL: Record<string, string> = { left: 'Left', center: 'Centre', right: 'Right' }

function leanColor(lean: string): string {
  if (lean === 'left') return 'var(--viz-bias-l3)'
  if (lean === 'right') return 'var(--viz-bias-r3)'
  return 'var(--viz-mid)'
}

export default function OutletTable({ outlets }: { outlets: Outlet[] }) {
  const [sort, setSort] = useState<SortKey>('articles')

  const rows = useMemo(() => {
    const val = (o: Outlet): number => {
      if (sort === 'latest') return o.latest ? Date.parse(o.latest) : 0
      const v = o[sort]
      return typeof v === 'number' ? v : 0
    }
    return [...outlets].sort((a, b) => val(b) - val(a))
  }, [outlets, sort])

  const maxArticles = Math.max(1, ...outlets.map(o => o.articles))

  return (
    <div className="news-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left font-medium text-[11px] uppercase tracking-[0.1em] text-muted-foreground px-4 py-2.5">
                Outlet
              </th>
              {COLUMNS.map(c => (
                <th key={c.key} className="px-3 py-2.5 text-right">
                  <button
                    onClick={() => setSort(c.key)}
                    className={`text-[11px] uppercase tracking-[0.1em] font-medium transition-colors whitespace-nowrap ${
                      sort === c.key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {c.label}
                    {sort === c.key && <span className="ml-1 opacity-60">↓</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map(o => (
              <tr key={o.source_id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-2.5 min-w-[190px]">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: leanColor(o.lean) }}
                      title={`${LEAN_LABEL[o.lean]}-leaning (AllSides)`}
                    />
                    <Link
                      href={`/channel/${o.source_id}`}
                      className="font-medium truncate hover:text-[hsl(var(--accent-news))] transition-colors"
                    >
                      {o.name}
                    </Link>
                    {o.error_count > 0 && (
                      <span
                        className="text-[10px] px-1.5 py-px rounded font-semibold shrink-0"
                        style={{ background: 'var(--viz-tone-n1)', color: '#fff' }}
                        title={`${o.error_count} consecutive fetch errors — last fetch ${ago(o.last_fetched)}`}
                      >
                        {o.error_count} err
                      </span>
                    )}
                    {o.stale && o.error_count === 0 && (
                      <span
                        className="text-[10px] px-1.5 py-px rounded font-semibold shrink-0 border"
                        style={{ borderColor: 'var(--viz-tone-n2)', color: 'var(--viz-tone-n2)' }}
                        title={
                          `Fetching fine but silent for ${duration(o.silent_hours)}` +
                          (o.median_gap_hours
                            ? ` — it normally publishes every ${duration(o.median_gap_hours)}`
                            : '')
                        }
                      >
                        stale
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 pl-3.5 truncate">
                    {o.category ?? '—'} · {LEAN_LABEL[o.lean]}
                  </p>
                </td>

                <td className="px-3 py-2.5 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-14 h-1.5 rounded-full bg-muted overflow-hidden hidden sm:block">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(o.articles / maxArticles) * 100}%`,
                          background: 'var(--viz-magnitude)',
                        }}
                      />
                    </div>
                    <span className="tabular-nums font-medium">{o.articles.toLocaleString()}</span>
                  </div>
                </td>

                <td className="px-3 py-2.5 text-right tabular-nums">
                  {o.articles_window > 0 ? o.articles_window : <span className="text-muted-foreground">—</span>}
                </td>

                {/* The outlet's published AllSides rating — an attribute of the
                    masthead, not a measurement of its articles. The swatch
                    carries sign and strength; the label stays in text ink so it
                    never inherits a series color. */}
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <span
                      className="w-2 h-2 rounded-[2px] shrink-0"
                      style={{ background: divergingVar(o.allsides_score, 2, 'bias') }}
                    />
                    <span className="whitespace-nowrap">
                      {o.allsides_label.replace(/_/g, ' ')}
                    </span>
                  </div>
                </td>

                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-1.5 tabular-nums">
                    {o.mean_tone != null && (
                      <span
                        className="w-2 h-2 rounded-[2px] shrink-0"
                        style={{ background: divergingVar(o.mean_tone, 1, 'tone') }}
                      />
                    )}
                    {signed(o.mean_tone)}
                  </div>
                </td>

                <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                  {o.articles > 0 ? `${Math.round((o.full_text / o.articles) * 100)}%` : '—'}
                </td>

                {/* Relative time depends on "now", which differs between the
                    server render and hydration — the canonical suppressHydration
                    case, not a bug to paper over. */}
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  <span
                    suppressHydrationWarning
                    className={o.stale ? 'font-medium' : 'text-muted-foreground'}
                    style={o.stale ? { color: 'var(--viz-tone-n2)' } : undefined}
                  >
                    {ago(o.latest)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
