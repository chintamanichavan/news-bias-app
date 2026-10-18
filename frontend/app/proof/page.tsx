'use client'

import Link from 'next/link'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Stats {
  n: number
  mean_a_year?: number
  t?: number | null
  hit_rate?: number
  sharpe_a_year?: number | null
  deflated_sharpe?: number | null
}

interface Portfolio {
  vs_spy_monthly: Stats
  vs_universe_monthly: Stats | null
  vs_spy_yearly: Stats
  growth_a_year: number
  vs_universe_by_year: { years_ahead: number; years: number; median: number; mean_without_best_year: number }
}

interface Year {
  date: string
  members: number
  non_financial: number
  priced: number
  market_implied: number
  wide: number
  spy: number
  ic: number | null
  moat_top: number
  moat_all: number
  top_fifth: number
  bottom_fifth: number
  universe: number
  moat_top_names: string[]
}

interface Horizon {
  dates: { date: string; companies: number; rank_corr: number; slope: number; implied_mean: number; realised_mean: number; spy: number | null }[]
  rank_corr_mean: number
  rank_corr_positive: number
  slope: number
  intercept: number
  fifths: { fifth: number; implied: number; realised: number }[]
  wide_vs_rest: { wide: number; rest: number }
}

interface Proof {
  run_at: string
  long_horizon: Record<string, Horizon>
  dates: string[]
  top: number
  trials: number
  hurdle_t: number
  spy_growth_a_year: number
  portfolios: Record<string, Portfolio>
  spread_top_minus_bottom: Stats
  ic: { mean: number | null; t: number | null; years: number }
  survivor_bias_estimate: number | null
  years: Year[]
  caveat: string
}

const NAMES: Record<string, { label: string; sub: string }> = {
  moat_top: { label: 'Your strategy', sub: 'the 20 wide-moat companies with the highest implied return' },
  moat_top_momentum: { label: '…rising prices only', sub: 'your strategy, skipping names whose price fell over the past year' },
  moat_top_growing: { label: '…growing sales only', sub: 'your strategy, skipping names whose sales are shrinking' },
  moat_all: { label: 'Every wide moat', sub: 'does the moat alone pay?' },
  top_fifth: { label: 'Best-priced fifth', sub: 'of all companies, by implied return' },
  bottom_fifth: { label: 'Worst-priced fifth', sub: 'the dearest companies' },
  universe: { label: 'The control', sub: 'every company priced: same survivor bias' },
}
const ORDER = ['moat_top', 'moat_top_momentum', 'moat_top_growing', 'moat_all', 'top_fifth', 'bottom_fifth', 'universe']

const pct = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${(x * 100).toFixed(d)}%`)
const signed = (x: number | null | undefined, d = 1) => (x == null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`)
const tone = (x: number | null | undefined) =>
  x == null ? '' : x > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'

function verdict(p: Portfolio, hurdle: number): string {
  const v = p.vs_universe_monthly
  if (!v?.t) return 'not enough data'
  if (v.t >= hurdle) return 'beat the control beyond luck'
  if (v.t <= -hurdle) return 'lost to the control beyond luck'
  return 'not distinguishable from luck'
}

interface Forecast {
  run_at: string
  trials: number
  hurdle_t: number
  payoffs: Record<string, { mean: number; t: number | null }>
  horizons: Record<string, { dates: number; slope: number; rank_corr_mean: number; rank_corr_positive: number;
    fifths: { fifth: number; forecast: number; realised: number }[] }>
  portfolios: Record<string, { growth_a_year: number; vs_spy: Stats; vs_universe: Stats | null }>
}

const TRAITS: Record<string, string> = {
  roic: 'Return on capital', moat_years: 'Years of high return (moat)', gross_margin: 'Gross margin',
  margin_swing: 'Margin swing', sales_growth: 'Sales growth', issuance: 'Share issuance',
  reinvestment: 'Reinvestment', altman_z: 'Altman Z', implied: 'Implied return (cheapness)',
  momentum: 'Past year’s return', size: 'Size',
}

function ForecastSection({ f }: { f: Forecast }) {
  const payoffs = Object.entries(f.payoffs).sort((a, b) => Math.abs(b[1].t ?? 0) - Math.abs(a[1].t ?? 0))
  return (
    <section className="mb-10">
      <h2 className="news-section-label mb-3 px-1">A forecast learned from history</h2>
      <p className="text-[13px] mb-3 px-1 max-w-3xl leading-relaxed">
        Each year, how much every trait of a company paid over the next twelve months; each later year forecast from
        the average of the years before it only (Fama-MacBeth; Lewellen 2015). Judged on the 1, 3 and 5 years that
        followed.
      </p>
      <div className="grid lg:grid-cols-3 gap-3 mb-3">
        {Object.entries(f.horizons).map(([h, v]) => (
          <div key={h} className="news-card p-4">
            <p className="text-[13px] mb-2">
              <b>{h} year{h === '1' ? '' : 's'}</b>, {v.dates} forecasts: slope <b>{v.slope.toFixed(2)}</b>, rank
              correlation {v.rank_corr_mean.toFixed(2)} (positive {v.rank_corr_positive} of {v.dates})
            </p>
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-right">
                  <th className="font-normal pb-1 text-left">Fifth</th>
                  <th className="font-normal pb-1">Forecast</th>
                  <th className="font-normal pb-1">Realised</th>
                </tr>
              </thead>
              <tbody>
                {v.fifths.map(q => (
                  <tr key={q.fifth} className="border-t border-border/60 text-right">
                    <td className="py-1 text-left">{q.fifth === 5 ? '5 · best' : q.fifth}</td>
                    <td className="py-1">{pct(q.forecast)}</td>
                    <td className="py-1 font-semibold">{pct(q.realised)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="news-card p-4">
          <p className="text-[11px] text-muted-foreground mb-2">
            What each trait paid a year, top-ranked company against bottom-ranked, 2014–2025. Luck is ruled out at a t of {f.hurdle_t}.
          </p>
          <table className="w-full text-[13px] tabular-nums">
            <tbody>
              {payoffs.map(([k, v]) => (
                <tr key={k} className="border-t border-border/60 first:border-0">
                  <td className="py-1.5">{TRAITS[k] ?? k}</td>
                  <td className={`py-1.5 text-right ${tone(v.mean)}`}>{signed(v.mean)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">t {v.t == null ? '—' : v.t.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="news-card p-4">
          <p className="text-[11px] text-muted-foreground mb-2">Held a year at a time, 2015–2026</p>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-right">
                <th className="font-normal pb-1"></th>
                <th className="font-normal pb-1">Grew a year</th>
                <th className="font-normal pb-1">vs control</th>
                <th className="font-normal pb-1">t</th>
              </tr>
            </thead>
            <tbody>
              {(['moat_top', 'top_fifth', 'universe'] as const).map(k => {
                const p = f.portfolios[k]
                return (
                  <tr key={k} className="border-t border-border/60 text-right">
                    <td className="py-1.5 text-left">{k === 'moat_top' ? '20 wide moats, best forecast' : k === 'top_fifth' ? 'Best-forecast fifth' : 'The control'}</td>
                    <td className="py-1.5">{pct(p.growth_a_year)}</td>
                    <td className={`py-1.5 ${tone(p.vs_universe?.mean_a_year)}`}>{p.vs_universe ? signed(p.vs_universe.mean_a_year) : '—'}</td>
                    <td className="py-1.5">{p.vs_universe?.t == null ? '—' : p.vs_universe.t.toFixed(2)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default function ProofPage() {
  const { data, loading, refreshing, error, reload } = useResource<Proof>('/api/proof')
  const fc = useResource<Forecast>('/api/forecast')
  if (error && !data) return <LoadError message={error} onRetry={reload} retrying={refreshing || loading} />
  if (!data) return <div className="px-4 py-16 text-center text-sm text-muted-foreground">Loading the replay…</div>

  const mine = data.portfolios.moat_top
  const first = data.dates[0].slice(0, 4)
  const last = String(Number(data.dates[data.dates.length - 1].slice(0, 4)) + 1)

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8 max-w-6xl">
      <header className="mb-7">
        <Link href="/companies" className="news-section-label hover:opacity-75">← Companies</Link>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">Has it worked?</h1>
        <p className="text-[15px] mt-4 max-w-3xl leading-relaxed">
          Each 30 June from {first}, the pricer was rerun using only the filings known that day, and its picks were
          held for a year. Your strategy grew <b>{pct(mine.growth_a_year)}</b> a year against SPY&apos;s{' '}
          <b>{pct(data.spy_growth_a_year)}</b>, and was ahead of the control in{' '}
          <b>{mine.vs_universe_by_year.years_ahead} of {mine.vs_universe_by_year.years}</b> years: {verdict(mine, data.hurdle_t)}.
        </p>
      </header>

      {Object.keys(data.long_horizon).length > 0 && (
        <section className="mb-10">
          <h2 className="news-section-label mb-3 px-1">Did the implied return come true?</h2>
          <div className="grid lg:grid-cols-2 gap-3">
            {Object.entries(data.long_horizon).map(([h, v]) => (
              <div key={h} className="news-card p-4">
                <p className="text-[13px] mb-3">
                  Over the next <b>{h} years</b>, from {v.dates.length} starting dates: each point of implied return
                  came with <b>{v.slope.toFixed(2)}</b> of a point of realised return (1 would be right on average,
                  0 means it said nothing). Rank correlation {v.rank_corr_mean.toFixed(2)}, positive
                  in {v.rank_corr_positive} of {v.dates.length} dates.
                </p>
                <table className="w-full text-[13px] tabular-nums">
                  <thead>
                    <tr className="text-[11px] text-muted-foreground text-right">
                      <th className="font-normal pb-2 text-left">Fifth by implied return</th>
                      <th className="font-normal pb-2">Implied</th>
                      <th className="font-normal pb-2">Realised a year</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.fifths.map(f => (
                      <tr key={f.fifth} className="border-t border-border/60 text-right">
                        <td className="py-1.5 text-left">{f.fifth === 1 ? '1 · dearest' : f.fifth === 5 ? '5 · cheapest' : f.fifth}</td>
                        <td className="py-1.5">{pct(f.implied)}</td>
                        <td className="py-1.5 font-semibold">{pct(f.realised)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[12px] mt-3">
                  Wide moats delivered <b>{pct(v.wide_vs_rest.wide)}</b> a year; every other company{' '}
                  <b>{pct(v.wide_vs_rest.rest)}</b>.
                </p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 px-1">
            Windows starting a year apart overlap, so the dates are not independent tests. The test follows Easton &amp;
            Monahan (2005) and Lee, So &amp; Wang (2021).
          </p>
        </section>
      )}

      {fc.data && <ForecastSection f={fc.data} />}

      <section className="mb-10">
        <h2 className="news-section-label mb-3 px-1">{first}–{last}, a year at a time, dividends in</h2>
        <div className="news-card p-4 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[860px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2"></th>
                <th className="font-normal pb-2 text-right">Grew a year</th>
                <th className="font-normal pb-2 text-right">vs SPY</th>
                <th className="font-normal pb-2 text-right" title="Every priced company: the same survivor bias, so the fair yardstick">vs control</th>
                <th className="font-normal pb-2 text-right" title={`t-statistic of the monthly difference; luck is ruled out at ${data.hurdle_t} after ${data.trials} tries`}>t</th>
                <th className="font-normal pb-2 text-right">Years ahead</th>
                <th className="font-normal pb-2 text-right" title="Mean yearly lead over the control once its single best year is dropped">Without best year</th>
                <th className="font-normal pb-2 text-right" title="Probability the edge is real after the number of tries (Bailey & López de Prado 2014)">Deflated Sharpe</th>
              </tr>
            </thead>
            <tbody>
              {ORDER.map(k => {
                const p = data.portfolios[k]
                const u = p.vs_universe_monthly
                return (
                  <tr key={k} className={`border-t border-border/60 ${k === 'moat_top' ? 'font-semibold' : ''}`}>
                    <td className="py-2.5 pr-3">
                      {NAMES[k].label}
                      <div className="text-[11px] text-muted-foreground font-normal">{NAMES[k].sub}</div>
                    </td>
                    <td className="py-2.5 text-right">{pct(p.growth_a_year)}</td>
                    <td className={`py-2.5 text-right ${tone(p.vs_spy_monthly.mean_a_year)}`}>{signed(p.vs_spy_monthly.mean_a_year)}</td>
                    <td className={`py-2.5 text-right ${tone(u?.mean_a_year)}`}>{u ? signed(u.mean_a_year) : '—'}</td>
                    <td className="py-2.5 text-right">{u?.t == null ? '—' : u.t.toFixed(2)}</td>
                    <td className="py-2.5 text-right">{k === 'universe' ? '—' : `${p.vs_universe_by_year.years_ahead} of ${p.vs_universe_by_year.years}`}</td>
                    <td className={`py-2.5 text-right ${tone(k === 'universe' ? null : p.vs_universe_by_year.mean_without_best_year)}`}>
                      {k === 'universe' ? '—' : signed(p.vs_universe_by_year.mean_without_best_year)}
                    </td>
                    <td className="py-2.5 text-right">{u?.deflated_sharpe == null ? '—' : pct(u.deflated_sharpe, 0)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
            Luck is ruled out at a t of {data.hurdle_t} after {data.trials} portfolios tried (Harvey &amp; Liu). The pricer&apos;s
            rank correlation with the next year&apos;s return averaged {data.ic.mean == null ? '—' : data.ic.mean.toFixed(3)}{' '}
            over {data.ic.years} years (t {data.ic.t == null ? '—' : data.ic.t.toFixed(2)}): across the whole list it did not
            order companies by what came next.
          </p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="news-section-label mb-3 px-1">Year by year</h2>
        <div className="news-card p-4 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[900px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-right">
                <th className="font-normal pb-2 text-left">Formed</th>
                <th className="font-normal pb-2" title="Non-financial members the pricer could price, of those in the index">Priced</th>
                <th className="font-normal pb-2" title="The market's implied return that day">Market implied</th>
                <th className="font-normal pb-2">SPY</th>
                <th className="font-normal pb-2">Control</th>
                <th className="font-normal pb-2">Your strategy</th>
                <th className="font-normal pb-2">Every wide moat</th>
                <th className="font-normal pb-2">Best fifth</th>
                <th className="font-normal pb-2">Worst fifth</th>
                <th className="font-normal pb-2">Rank corr.</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map(y => (
                <tr key={y.date} className="border-t border-border/60 text-right">
                  <td className="py-2 text-left">{y.date.slice(0, 4)}</td>
                  <td className="py-2">{y.priced} <span className="text-[10px] text-muted-foreground">of {y.non_financial}</span></td>
                  <td className="py-2">{pct(y.market_implied)}</td>
                  <td className="py-2">{signed(y.spy)}</td>
                  <td className="py-2">{signed(y.universe)}</td>
                  <td className={`py-2 font-semibold ${tone(y.moat_top - y.universe)}`} title={y.moat_top_names.join(', ')}>{signed(y.moat_top)}</td>
                  <td className={`py-2 ${tone(y.moat_all - y.universe)}`}>{signed(y.moat_all)}</td>
                  <td className={`py-2 ${tone(y.top_fifth - y.universe)}`}>{signed(y.top_fifth)}</td>
                  <td className={`py-2 ${tone(y.bottom_fifth - y.universe)}`}>{signed(y.bottom_fifth)}</td>
                  <td className="py-2">{y.ic == null ? '—' : y.ic.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">
            Green and red compare each portfolio with the control that year. Hover your strategy&apos;s figure to see what it held.
          </p>
        </div>
      </section>

      <section className="news-card p-4 mb-8 max-w-3xl">
        <h2 className="news-section-label mb-2">What this cannot see</h2>
        <p className="text-[13px] leading-relaxed">
          Only companies that still trade today have prices here. The control&apos;s lead over SPY,{' '}
          {signed(data.survivor_bias_estimate)} a year, is a rough measure of how much that flatters every portfolio, and
          each is compared with the control rather than with SPY alone for that reason. The flattery is largest where failures are
          likeliest: among cheap, troubled companies, which is where the best-priced fifth draws from. Early years price
          barely half the index. {data.caveat}
        </p>
        <p className="text-[11px] text-muted-foreground mt-2">Replayed {data.run_at}.</p>
      </section>
    </div>
  )
}
