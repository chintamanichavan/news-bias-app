'use client'

// The portfolio-research workspace, merged into the platform and rendered in
// Artha's own design language. Long-horizon quality businesses with their
// buy-below levels against live prices, the factor-tilt target allocation,
// and the ADR decision log — joined with the signal engine's short-horizon
// read where one exists. Research workspace, not holdings.

import CompoundingJourney from '@/components/CompoundingJourney'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Name {
  ticker: string
  name: string
  sector: string | null
  moat_type: string | null
  moat_strength: string | null
  status: string | null
  one_liner: string | null
  buy_below: number | null
  intrinsic_value: number | null
  price: number | null
  composite: number | null
  to_buy_zone_pct?: number
  in_buy_zone?: boolean
  upside_pct?: number
  last_reviewed: string | null
}

interface Allocation { asset_class: string; region?: string; factor?: string; weight: number }

interface QueueItem {
  ticker: string; name: string; to_buy_zone_pct: number; in_buy_zone: boolean
  price: number | null; buy_below: number | null; one_liner: string | null
}
interface Screened {
  ticker: string; price: number; vs_52w_high_pct: number
  roe_pct: number; rev_cagr_pct: number; fcf: number; dilution_pct: number | null
}

interface PortfolioData {
  available: boolean
  workspace: string
  ips_excerpt: string | null
  targets: { base_currency: string; allocations: Allocation[] }
  watchlist: Name[]
  in_buy_zone: string[]
  analysis_queue: { queue: QueueItem[]; screened: Screened[] }
  decisions: { file: string; title: string; status: string | null }[]
}

const REGION_LABEL: Record<string, string> = {
  'us-developed': 'US', 'international-developed': 'Intl developed',
  emerging: 'Emerging', global: 'Global',
}

function tone(v: number | null | undefined): string {
  if (v == null) return 'text-muted-foreground'
  if (v > 0.1) return 'text-emerald-600 dark:text-emerald-400'
  if (v < -0.1) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

export default function PortfolioPage() {
  const { data, loading, error, reload } = useResource<PortfolioData>('/api/portfolio')

  const regions = new Map<string, Allocation[]>()
  for (const a of data?.targets.allocations ?? []) {
    const key = a.region ?? a.asset_class
    regions.set(key, [...(regions.get(key) ?? []), a])
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <p className="news-section-label">Long horizon · 5+ years</p>
      <h1 className="mt-1 font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-none">
        Portfolio Research
      </h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[68ch]">
        The quality-business watchlist and factor allocation from the research workspace,
        joined with live prices and the engine&rsquo;s short-horizon signal. The thesis work
        lives in the workspace; the platform watches the prices.
      </p>
      {data?.ips_excerpt && (
        <blockquote className="mt-4 border-l-2 border-[hsl(var(--accent-news))] pl-4 text-[13px] text-muted-foreground leading-relaxed max-w-[72ch] italic">
          {data.ips_excerpt}
          <span className="not-italic block mt-1 text-[11px] uppercase tracking-wider">— Investment Policy Statement</span>
        </blockquote>
      )}

      {error && !data && <div className="mt-8"><LoadError message={error} onRetry={reload} /></div>}
      {loading && !data && <div className="mt-8 skeleton h-96 rounded-2xl" />}
      {data && !data.available && (
        <p className="mt-8 text-sm text-muted-foreground">
          Workspace not found at <code className="text-[12px]">{data.workspace}</code> — set{' '}
          <code className="text-[12px]">PORTFOLIO_RESEARCH_DIR</code> for the ML service.
        </p>
      )}

      {data && data.available && (
        <>
          {/* The analysis queue — never fewer than five things to study */}
          {data.analysis_queue && (
            <section className="mt-8">
              <div className="flex items-baseline justify-between mb-3">
                <p className="news-section-label">Analysis queue</p>
                <span className="text-[11px] text-muted-foreground">
                  in-zone + nearest to zone · each opens its Lab dossier
                </span>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {data.analysis_queue.queue.map(q => (
                  <a key={q.ticker} href={`/lab?symbol=${encodeURIComponent(q.ticker)}`}
                    className={`news-card p-4 block hover:-translate-y-0.5 transition-transform border ${
                      q.in_buy_zone ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-border'}`}>
                    <div className="flex items-baseline justify-between">
                      <span className="font-bold tabular-nums">{q.ticker}</span>
                      <span className={`text-[11px] font-semibold tabular-nums ${
                        q.in_buy_zone ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                        {q.in_buy_zone ? 'IN ZONE' : `+${q.to_buy_zone_pct}%`}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                      ${q.price?.toLocaleString()} vs ${q.buy_below?.toLocaleString()} buy-below
                    </div>
                    {q.one_liner && (
                      <p className="mt-1.5 text-[11px] text-muted-foreground leading-snug line-clamp-2">{q.one_liner}</p>
                    )}
                  </a>
                ))}
              </div>
              {data.in_buy_zone.length > 0 && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Re-read the thesis doc before acting on an in-zone name, per the IPS.
                </p>
              )}

              {data.analysis_queue.screened.length > 0 && (
                <div className="mt-5 news-card overflow-x-auto">
                  <div className="px-4 pt-3 pb-1 flex items-baseline justify-between">
                    <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
                      Screened candidates — quality compounders marked down, not yet on the watchlist
                    </p>
                    <span className="text-[10px] text-muted-foreground">no thesis yet · research before any verdict (ADR 0007)</span>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="px-4 py-2 font-semibold">Ticker</th>
                        <th className="px-3 py-2 font-semibold text-right">Price</th>
                        <th className="px-3 py-2 font-semibold text-right">vs 52w high</th>
                        <th className="px-3 py-2 font-semibold text-right">ROE</th>
                        <th className="px-3 py-2 font-semibold text-right">Rev CAGR</th>
                        <th className="px-3 py-2 font-semibold text-right">FCF</th>
                        <th className="px-4 py-2 font-semibold text-right">Share change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.analysis_queue.screened.map(s => (
                        <tr key={s.ticker}
                          className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer"
                          onClick={() => { window.location.href = `/lab?symbol=${encodeURIComponent(s.ticker)}` }}>
                          <td className="px-4 py-2.5 font-semibold tabular-nums">{s.ticker}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">${s.price.toLocaleString()}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">{s.vs_52w_high_pct}%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.roe_pct}%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{s.rev_cagr_pct}%</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{Math.abs(s.fcf) >= 1e9 ? `$${(s.fcf / 1e9).toFixed(1)}B` : `$${(s.fcf / 1e6).toFixed(0)}M`}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{s.dilution_pct != null ? `${s.dilution_pct > 0 ? '+' : ''}${s.dilution_pct}%` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="px-4 py-2 text-[10.5px] text-muted-foreground">
                    Screen: ROE &gt; 15%, positive FCF, revenue CAGR &gt; 5%, share count not inflating — from as-filed
                    fundamentals in the PIT store, ranked by markdown from the 52-week high.
                  </p>
                </div>
              )}
            </section>
          )}

          {/* The alpha path to compounded wealth */}
          <CompoundingJourney />

          {/* Watchlist — the discretionary alpha sleeve */}
          <section className="mt-10">
            <div className="flex items-baseline justify-between mb-4">
              <p className="news-section-label">Quality-business watchlist</p>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {data.watchlist.length} names · sorted by distance to buy zone
              </span>
            </div>
            <div className="news-card overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="px-4 py-2.5 font-semibold">Business</th>
                    <th className="px-3 py-2.5 font-semibold">Moat</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Price</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Buy below</th>
                    <th className="px-3 py-2.5 font-semibold text-right">To zone</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Est. upside</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Signal</th>
                    <th className="px-4 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.watchlist.map(n => (
                    <tr key={n.ticker}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => { window.location.href = `/lab?symbol=${encodeURIComponent(n.ticker)}` }}
                      title={`Open ${n.ticker} in the Research Lab`}>
                      <td className="px-4 py-3">
                        <div className="font-semibold tabular-nums">{n.ticker}
                          <span className="ml-2 font-normal text-muted-foreground">{n.name}</span>
                        </div>
                        {n.one_liner && <div className="text-[12px] text-muted-foreground mt-0.5 max-w-[38ch]">{n.one_liner}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap ${
                          n.moat_strength === 'wide' ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300' : 'bg-muted text-muted-foreground'}`}>
                          {n.moat_strength ?? '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-medium">
                        {n.price != null ? `$${n.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {n.buy_below != null ? `$${n.buy_below.toLocaleString()}` : '—'}
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums font-semibold ${
                        n.in_buy_zone ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                        {n.to_buy_zone_pct != null ? (n.in_buy_zone ? 'IN ZONE' : `+${n.to_buy_zone_pct}%`) : '—'}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {n.upside_pct != null ? `${n.upside_pct > 0 ? '+' : ''}${n.upside_pct}%` : '—'}
                      </td>
                      <td className={`px-3 py-3 text-right tabular-nums font-semibold ${tone(n.composite)}`}>
                        {n.composite != null ? `${n.composite > 0 ? '+' : ''}${n.composite.toFixed(2)}` : '·'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px] text-muted-foreground">{n.status ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Buy-below and intrinsic-value estimates come from the workspace&rsquo;s own methodology
              (decisions 0002, 0007). Signal is the engine&rsquo;s short-horizon composite where one exists —
              context, never a trigger. Quotes delayed 15+ min.
            </p>
          </section>

          <div className="mt-12 grid lg:grid-cols-2 gap-8 items-start">
            {/* Target allocation */}
            <section>
              <p className="news-section-label mb-4">Target allocation · {data.targets.base_currency}</p>
              <div className="news-card p-5 space-y-5">
                {Array.from(regions.entries()).map(([region, allocs]) => {
                  const total = allocs.reduce((s, a) => s + a.weight, 0)
                  return (
                    <div key={region}>
                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-sm font-semibold">{REGION_LABEL[region] ?? region}</span>
                        <span className="text-sm font-bold tabular-nums">{total}%</span>
                      </div>
                      <div className="flex h-2.5 rounded-full overflow-hidden bg-muted">
                        {allocs.map((a, i) => (
                          <div key={i} title={`${a.factor ?? a.asset_class} ${a.weight}%`}
                            className={['bg-emerald-600/80', 'bg-emerald-500/60', 'bg-emerald-400/50', 'bg-emerald-300/40'][i % 4]}
                            style={{ width: `${(a.weight / total) * 100}%` }} />
                        ))}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {allocs.map((a, i) => (
                          <span key={i} className="text-[11px] text-muted-foreground tabular-nums">
                            {a.factor ?? a.asset_class} {a.weight}%
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Decision log */}
            <section>
              <p className="news-section-label mb-4">Decision log</p>
              <div className="news-card divide-y divide-border/60">
                {data.decisions.map(d => (
                  <div key={d.file} className="px-5 py-3 flex items-baseline gap-3">
                    <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{d.file.slice(0, 4)}</span>
                    <span className="flex-1 text-[13px] leading-snug">{d.title.replace(/^\d+\s*[—-]\s*/, '')}</span>
                    {d.status && (
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground whitespace-nowrap">{d.status.replace(/\(.*\)/, '').trim()}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Append-only ADRs from <code className="text-[10px]">decisions/</code> — the reasoning trail behind every allocation change.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
