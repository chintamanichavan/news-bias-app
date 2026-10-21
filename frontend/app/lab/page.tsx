'use client'

// The Research Lab: deep statistical dossier for any security on the globe —
// equities, FX, futures, commodities, indices, crypto; options where a chain
// exists. Search the registry or type any Yahoo-valid symbol raw.

import { useEffect, useRef, useState } from 'react'
import ArthaLoader from '@/components/ArthaLoader'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { useResource } from '@/lib/useResource'

interface SearchHit { symbol: string; name: string; asset_class: string; region: string }

interface Dossier {
  error?: string
  resolved_from?: string
  symbol: string; name: string | null; asset_class: string | null
  observations: number; span: { from: string; to: string }
  price: { last: number; vs_52w_high_pct: number; vs_52w_low_pct: number; trend: string }
  moments: { ann_return_pct: number; ann_vol_pct: number; skewness: number; excess_kurtosis: number }
  risk_adjusted: { sharpe: number | null; sortino: number | null; max_drawdown_pct: number; drawdown_days: number; calmar: number | null }
  tails: { var_95_pct: number; var_99_pct: number; cvar_95_pct: number; cvar_99_pct: number
           worst_day: { date: string; ret_pct: number }; best_day: { date: string; ret_pct: number } }
  distribution: { jarque_bera: number; jb_p_value: number; normal: boolean; hist: number[]; normal_curve: number[]; bin_edges_pct: number[] }
  dependence: { acf_returns: Record<string, number | null>; acf_abs_returns: Record<string, number | null>; hurst: number | null }
  relative: { benchmark: string; beta: number | null; correlation: number | null }
  rolling_vol_30d: { date: string; vol: number }[]
  profile: {
    identity: { long_name: string | null; exchange: string | null; currency: string | null; quote_type: string | null; sector: string | null; industry: string | null; country: string | null; employees: number | null; summary: string | null }
    valuation: Record<string, number | null>
    dividends: Record<string, number | string | null>
    profitability: Record<string, number | null>
    growth: Record<string, number | null>
    balance: Record<string, number | null>
    analyst: { recommendation: string | null; target_mean: number | null; target_high: number | null; target_low: number | null; analysts: number | null }
    shares: Record<string, number | null>
    calendar: { next_earnings: string | null }
    trading: Record<string, number | null>
  } | null
  options: { atm_iv_pct: number | null; put_call_oi: number | null; contracts: number } | null
  long_term: {
    span_years: number
    cagr: Record<string, number | null>
    worst_drawdown_pct: number
    worst_drawdown_at: string
    monthly_series: { t: string; v: number }[]
  } | null
  fundamentals_history: {
    span_years: number
    fiscal_years: Record<string, number | null>[]
    cagr: Record<string, number | null>
    shares_change_pct: number | null
    society: Record<string, number | null>
  } | null
}

function fmtBig(v: number | null | undefined): string {
  if (v == null) return '—'
  const abs = Math.abs(v)
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  return v.toLocaleString()
}

function num(v: number | null | undefined, suffix = ''): string {
  return v == null ? '—' : `${v}${suffix}`
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  )
}

export default function LabPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Deep links: every card on the platform opens a security as /lab?symbol=X
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get('symbol')
      if (q) setSymbol(q.toUpperCase())
    } catch {}
  }, [])

  const { data: d, loading, error } = useResource<Dossier>(`/api/lab/${encodeURIComponent(symbol)}`)

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current)
    if (query.trim().length < 1) { setHits([]); return }
    debounce.current = setTimeout(() => {
      fetch(`/api/lab/search?q=${encodeURIComponent(query.trim())}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(j => setHits(j.results ?? []))
        .catch(() => setHits([]))
    }, 250)
  }, [query])

  function pick(sym: string) {
    setSymbol(sym.toUpperCase())
    setQuery('')
    setHits([])
  }

  const acf = d?.dependence.acf_returns ?? {}
  const hurst = d?.dependence.hurst
  const p = d?.profile

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <p className="news-section-label">Deep statistics · any instrument</p>
      <h1 className="mt-1 font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-none">Research Lab</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[66ch]">
        One symbol in, a quantitative dossier out — equities, forex, futures, commodities,
        indices, crypto, and the options chain where one trades. Type any Yahoo-style symbol
        (RELIANCE.NS, EURUSD=X, CL=F, BTC-USD) or search the registry.
      </p>

      {/* Search */}
      <div className="relative mt-5 max-w-lg">
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && query.trim()) pick(hits[0]?.symbol ?? query.trim()) }}
          placeholder="Search 10,000+ securities or enter any symbol…"
          className="w-full text-sm bg-card border border-border rounded-full px-5 py-2.5 outline-none focus:border-foreground/40 placeholder:text-muted-foreground/70"
          id="lab-search"
        />
        {hits.length > 0 && (
          <div className="absolute z-30 mt-1 w-full news-card border border-border shadow-lg max-h-80 overflow-y-auto">
            {hits.map(h => (
              <button key={h.symbol} onClick={() => pick(h.symbol)}
                className="w-full text-left px-4 py-2 hover:bg-muted/50 flex items-baseline gap-3 text-[13px]">
                <span className="font-semibold tabular-nums w-24 shrink-0">{h.symbol}</span>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{h.name}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground shrink-0">{h.asset_class} · {h.region}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && !d && <ArthaLoader className="mt-8 h-96" />}
      {d?.error && <p className="mt-8 text-sm text-muted-foreground">{d.error}</p>}
      {error && !d && <p className="mt-8 text-sm text-muted-foreground">Could not load {symbol}: {error}</p>}
      {d?.resolved_from && !d.error && (
        <p className="mt-8 text-[12px] text-muted-foreground">No ticker {d.resolved_from}; showing {d.symbol}, the closest name in the registry.</p>
      )}

      {d && !d.error && (
        <>
          {/* Masthead row */}
          <div className="mt-8 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h2 className="text-2xl font-bold tabular-nums">{d.symbol}</h2>
            <span className="text-sm text-muted-foreground">{p?.identity.long_name ?? d.name ?? ''}</span>
            <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {p?.identity.quote_type ?? d.asset_class ?? 'security'}
            </span>
            <span className="text-lg font-semibold tabular-nums">{d.price.last?.toLocaleString(undefined, { maximumFractionDigits: 4 })}{p?.identity.currency ? ` ${p.identity.currency}` : ''}</span>
            <span className="text-[12px] text-muted-foreground tabular-nums">
              {d.price.trend} · {d.price.vs_52w_high_pct}% vs 52w high · {d.observations} obs ({d.span.from} → {d.span.to})
            </span>
          </div>
          {p?.identity.summary && (
            <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed max-w-[85ch]">{p.identity.summary}</p>
          )}
          {p?.identity.sector && (
            <p className="mt-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              {p.identity.sector} · {p.identity.industry} · {p.identity.country}
              {p.identity.employees ? ` · ${p.identity.employees.toLocaleString()} employees` : ''}
              {p.identity.exchange ? ` · ${p.identity.exchange}` : ''}
            </p>
          )}

          {/* Core statistics */}
          <div className="mt-6 news-card p-5 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-4">
            <Stat label="Ann. return" value={num(d.moments.ann_return_pct, '%')}
              tone={d.moments.ann_return_pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
            <Stat label="Ann. vol" value={num(d.moments.ann_vol_pct, '%')} />
            <Stat label="Sharpe" value={num(d.risk_adjusted.sharpe)} sub={`Sortino ${num(d.risk_adjusted.sortino)}`} />
            <Stat label="Max drawdown" value={num(d.risk_adjusted.max_drawdown_pct, '%')} sub={`${d.risk_adjusted.drawdown_days}d · Calmar ${num(d.risk_adjusted.calmar)}`} />
            <Stat label="Skewness" value={num(d.moments.skewness)} />
            <Stat label="Excess kurtosis" value={num(d.moments.excess_kurtosis)} sub={d.moments.excess_kurtosis > 1 ? 'fat tails' : 'near-normal tails'} />
            <Stat label="Beta / corr" value={`${num(d.relative.beta)} / ${num(d.relative.correlation)}`} sub={`vs ${d.relative.benchmark}`} />
            <Stat label="Hurst" value={num(hurst)}
              sub={hurst == null ? undefined : hurst > 0.55 ? 'trending' : hurst < 0.45 ? 'mean-reverting' : 'near random walk'} />
          </div>

          <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
            {/* Tails + distribution */}
            <div className="news-card p-5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Tails &amp; distribution</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Stat label="VaR 95 / 99 (1d)" value={`${d.tails.var_95_pct}%`} sub={`${d.tails.var_99_pct}% at 99`} />
                <Stat label="CVaR 95 / 99" value={`${d.tails.cvar_95_pct}%`} sub={`${d.tails.cvar_99_pct}% at 99`} />
                <Stat label="Worst day" value={`${d.tails.worst_day.ret_pct}%`} sub={d.tails.worst_day.date} tone="text-red-600 dark:text-red-400" />
                <Stat label="Best day" value={`+${d.tails.best_day.ret_pct}%`} sub={d.tails.best_day.date} tone="text-emerald-600 dark:text-emerald-400" />
              </div>
              {/* Histogram vs normal */}
              <div className="mt-4">
                <div className="flex items-end gap-px h-20">
                  {d.distribution.hist.map((h, i) => {
                    const max = Math.max(...d.distribution.hist, 1)
                    const nc = d.distribution.normal_curve[i] ?? 0
                    return (
                      <div key={i} className="flex-1 relative flex items-end">
                        <div className="w-full bg-foreground/60 rounded-t-[2px]" style={{ height: `${(h / max) * 100}%` }} />
                        <div className="absolute bottom-0 w-full border-t-2 border-amber-500/80" style={{ marginBottom: `${(nc / max) * 100}%` }} />
                      </div>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  Daily returns vs fitted normal (amber). Jarque–Bera {d.distribution.jarque_bera}
                  {' '}(p={d.distribution.jb_p_value}) — {d.distribution.normal ? 'normality not rejected' : 'decisively non-normal'}.
                </p>
              </div>
            </div>

            {/* Dependence + rolling vol */}
            <div className="news-card p-5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Dependence structure</p>
              <div className="flex items-end gap-2 h-16">
                {Object.entries(acf).map(([lag, v]) => (
                  <div key={lag} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className={`w-full rounded-sm ${(v ?? 0) >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                      style={{ height: `${Math.min(56, Math.abs(v ?? 0) * 280) + 2}px` }} />
                    <span className="text-[9px] text-muted-foreground">{lag.replace('lag', 'L')}</span>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Return autocorrelation — near zero is market efficiency. |r| autocorr L1 {num(d.dependence.acf_abs_returns.lag1)} (vol clustering).
              </p>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mt-4 mb-1">Rolling 30d vol</p>
              <svg viewBox="0 0 260 44" className="w-full">
                {d.rolling_vol_30d.length > 2 && (() => {
                  const vols = d.rolling_vol_30d.map(x => x.vol)
                  const lo = Math.min(...vols), hi = Math.max(...vols)
                  const span = hi - lo || 1
                  const path = vols.map((v, i) =>
                    `${i === 0 ? 'M' : 'L'} ${(i / (vols.length - 1)) * 260} ${40 - ((v - lo) / span) * 36}`).join(' ')
                  return <>
                    <path d={path} fill="none" className="stroke-indigo-500" strokeWidth={1.5} />
                    <text x={0} y={10} fontSize={8} className="fill-muted-foreground tabular-nums">{hi}%</text>
                    <text x={0} y={42} fontSize={8} className="fill-muted-foreground tabular-nums">{lo}%</text>
                  </>
                })()}
              </svg>
              {d.options && (
                <p className="mt-3 pt-2 border-t border-border/60 text-[12px] tabular-nums">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-0.5">Options (nearest expiry)</span>
                  ATM IV <span className="font-semibold">{num(d.options.atm_iv_pct, '%')}</span>
                  {' '}· put/call OI <span className="font-semibold">{num(d.options.put_call_oi)}</span>
                  {' '}· {d.options.contracts} contracts
                </p>
              )}
            </div>

            {/* Fundamentals (when the instrument has them) */}
            <div className="news-card p-5">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Fundamentals</p>
              {!p ? <p className="text-[13px] text-muted-foreground">Not applicable for this instrument (or upstream unavailable).</p> : (
                <div className="space-y-1.5 text-[12.5px] tabular-nums">
                  {([
                    ['Market cap', fmtBig(p.valuation.market_cap)],
                    ['P/E (ttm / fwd)', `${num(p.valuation.trailing_pe && +(+p.valuation.trailing_pe).toFixed(1))} / ${num(p.valuation.forward_pe && +(+p.valuation.forward_pe).toFixed(1))}`],
                    ['EV/EBITDA · P/B', `${num(p.valuation.ev_to_ebitda)} · ${num(p.valuation.price_to_book && +(+p.valuation.price_to_book).toFixed(1))}`],
                    ['Margins (gross/op/net)', `${num(p.profitability.gross_margin_pct)}% / ${num(p.profitability.operating_margin_pct)}% / ${num(p.profitability.profit_margin_pct)}%`],
                    ['ROE · ROA', `${num(p.profitability.roe_pct)}% · ${num(p.profitability.roa_pct)}%`],
                    ['Growth (rev/eps)', `${num(p.growth.revenue_growth_pct)}% / ${num(p.growth.earnings_growth_pct)}%`],
                    ['Dividend yield', num(p.dividends.yield_pct as number | null, '%')],
                    ['Debt/equity · current', `${num(p.balance.debt_to_equity)} · ${num(p.balance.current_ratio)}`],
                    ['Free cash flow', fmtBig(p.balance.free_cash_flow)],
                    ['Short % float · inst.', `${num(p.shares.short_pct_of_float)}% · ${num(p.shares.institutions_pct)}%`],
                    ['Analyst', `${p.analyst.recommendation ?? '—'} · target ${num(p.analyst.target_mean)} (${p.analyst.analysts ?? 0})`],
                    ['Next earnings', p.calendar.next_earnings ?? '—'],
                  ] as [string, string][]).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-medium text-right">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* The long-term record — the 7+ year view long-term investing needs */}
          {d.long_term && (
            <div className="mt-4 news-card p-5">
              <div className="flex items-baseline justify-between mb-3">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Long-term record · {d.long_term.span_years} years
                </p>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  worst drawdown {d.long_term.worst_drawdown_pct}% ({d.long_term.worst_drawdown_at})
                </span>
              </div>
              <div className="grid grid-cols-4 gap-3 mb-3">
                {Object.entries(d.long_term.cagr).map(([h, v]) => (
                  <div key={h}>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{h} CAGR</div>
                    <div className={`text-lg font-bold tabular-nums ${v != null && v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : v != null ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                      {v != null ? `${v > 0 ? '+' : ''}${v}%` : '—'}
                    </div>
                  </div>
                ))}
              </div>
              <TimeSeriesChart
                series={[{ label: 'monthly close', points: d.long_term.monthly_series,
                           cls: 'stroke-foreground/70', fill: 'fill-foreground/5' }]}
                H={180} yFmt={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)} />
            </div>
          )}

          {/* The business, year by year — as filed with the SEC */}
          {d.fundamentals_history && (() => {
            const fh = d.fundamentals_history!
            const fy = fh.fiscal_years
            const pts = (key: string) => fy.filter(r => r[key] != null)
              .map(r => ({ t: `${r.fy}-06-30`, v: r[key] as number }))
            const fmtB = (v: number) => Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(0)}B` : `${(v / 1e6).toFixed(0)}M`
            const soc = fh.society
            return (
              <div className="mt-4 news-card p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    The business, year by year · {fh.span_years} fiscal years as filed
                  </p>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    share count {fh.shares_change_pct != null ? `${fh.shares_change_pct > 0 ? '+' : ''}${fh.shares_change_pct}%` : '—'} over the span
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  {Object.entries(fh.cagr).map(([k, v]) => (
                    <div key={k}>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.replace(/_/g, ' ')} CAGR</div>
                      <div className={`text-lg font-bold tabular-nums ${v != null && v >= 0 ? 'text-emerald-600 dark:text-emerald-400' : v != null ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}>
                        {v != null ? `${v > 0 ? '+' : ''}${v}%` : '—'}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  {pts('revenue').length >= 3 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Revenue &amp; net income</p>
                      <TimeSeriesChart
                        series={[
                          { label: 'revenue', points: pts('revenue'), cls: 'stroke-indigo-500', fill: 'fill-indigo-500/10' },
                          { label: 'net income', points: pts('net_income'), cls: 'stroke-emerald-500' },
                        ]} H={150} yFmt={fmtB} />
                      <ChartLegend items={[
                        { label: 'revenue', cls: 'stroke-indigo-500' },
                        { label: 'net income', cls: 'stroke-emerald-500' },
                      ]} />
                    </div>
                  )}
                  {pts('fcf').length >= 3 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Free cash flow &amp; margins</p>
                      <TimeSeriesChart
                        series={[{ label: 'FCF', points: pts('fcf'), cls: 'stroke-emerald-600', fill: 'fill-emerald-500/10' }]}
                        H={110} yFmt={fmtB} zeroLine />
                      <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                        latest: net margin {fy[fy.length - 1].net_margin_pct ?? '—'}% · op margin {fy[fy.length - 1].op_margin_pct ?? '—'}% · ROE {fy[fy.length - 1].roe_pct ?? '—'}%
                      </div>
                    </div>
                  )}
                </div>
                <p className="mt-4 pt-3 border-t border-border/60 text-[11.5px] text-muted-foreground tabular-nums">
                  What it put back over the span:
                  {soc.dividends_total != null && <> dividends <span className="font-semibold text-foreground">{fmtB(soc.dividends_total)}</span> ·</>}
                  {soc.buybacks_total != null && <> buybacks <span className="font-semibold text-foreground">{fmtB(soc.buybacks_total)}</span> ·</>}
                  {soc.taxes_paid_total != null && <> taxes paid <span className="font-semibold text-foreground">{fmtB(soc.taxes_paid_total)}</span> ·</>}
                  {soc.rnd_total != null && <> R&amp;D <span className="font-semibold text-foreground">{fmtB(soc.rnd_total)}</span> ·</>}
                  {' '}from filings with the SEC, as filed.
                </p>
              </div>
            )
          })()}

          <p className="mt-3 text-[10px] text-muted-foreground/80">
            Daily-close statistics over the shown span · VaR/CVaR historical · Hurst via rescaled range ·
            delayed data · research, not financial advice.
          </p>
        </>
      )}
    </div>
  )
}
