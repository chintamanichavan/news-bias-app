'use client'

// Research surfaces for the Portfolio page: the historical replay of the
// return rule, every name that clears it today, and the best ten-year
// records. None of this is a buy list — the queue above is, and it admits
// only names the watchlist rates as wide-moat.

import { useState } from 'react'
import { useResource } from '@/lib/useResource'

export interface ResearchRow {
  ticker: string; price: number
  expected_return_pct: number | null
  tier: 'target' | 'minimum' | null
  buy_below: number | null; target_below: number | null
  growth_pct: number | null; exit_pe: number | null
  vs_52w_high_pct: number
  ten_year_return_pct: number | null
  roe_pct: number | null; rev_cagr_pct: number | null
  quality: boolean
  moat: string | null
}

interface Outcome {
  n: number; median: number | null; mean: number | null
  reached_floor_pct: number | null; lost_money_pct: number | null
}
interface Selection extends Outcome {
  key: string; label: string
  median_lead: number | null; beat_their_year_pct: number | null
  years_tested: number; years_ahead: number; mean_yearly_lead: number | null
  by_year: { year: number; n: number; median: number | null; lead: number | null }[]
}
interface Horizon {
  horizon_years: number
  groups: (Outcome & { expected: string })[]
  all: Outcome & { by_year: { year: number; companies: number; median: number }[] }
  selections: Selection[]
}
interface Replay {
  error?: string
  ran_at: string; first_year: number; observations: number
  rule: { floor_pct: number }
  verdict: { reliable_edge: boolean; headline: string; detail: string }
  horizons: Horizon[]
  caveats: string[]
}
interface Plan {
  key: string; label: string
  median_end: number; beat_steady_pct: number
  median_vs_steady_pct: number; worst_vs_steady_pct: number; best_vs_steady_pct: number
  mostly_cash_at_end_pct: number
}
interface Timing {
  error?: string
  ran_at: string; from: string; to: string; monthly: number
  verdict: { waiting_pays: boolean; headline: string; detail: string }
  windows: { years: number; windows: number; paid_in: number; strategies: Plan[] }[]
  caveats: string[]
}

const GOOD = 'text-emerald-600 dark:text-emerald-400'
const BAD = 'text-red-600 dark:text-red-400'
const TH = 'px-3 py-2 font-semibold text-right'
const TD = 'px-3 py-2.5 text-right tabular-nums'
const HEAD_ROW = 'text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border'
const BODY_ROW = 'border-b border-border/50 last:border-0'

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)
const usd = (v: number | null | undefined) => (v == null ? '—' : `$${v.toLocaleString()}`)
const openLab = (ticker: string) => { window.location.href = `/lab?symbol=${encodeURIComponent(ticker)}` }

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
        on ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:text-foreground'}`}>
      {children}
    </button>
  )
}

// ── Did the rule work? ───────────────────────────────────────────────────────

const signed = (v: number | null | undefined, unit: string) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v}${unit}`
const leadTone = (v: number | null | undefined) => (v == null || v === 0 ? '' : v > 0 ? GOOD : BAD)

function Caveats({ items }: { items: string[] }) {
  return (
    <div className="px-4 py-3 border-t border-border">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Read this with care</p>
      <ul className="mt-1 text-[11.5px] text-muted-foreground leading-relaxed list-disc pl-4">
        {items.map(c => <li key={c}>{c}</li>)}
      </ul>
    </div>
  )
}

export function RuleReplay() {
  const { data } = useResource<Replay>('/api/replay')
  const [years, setYears] = useState(5)
  if (!data || data.error) return null
  const h = data.horizons.find(x => x.horizon_years === years) ?? data.horizons[data.horizons.length - 1]
  const floor = data.rule.floor_pct

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3">
        <p className="news-section-label">Did the rule work? · replay from {data.first_year}</p>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {data.observations.toLocaleString()} company-years · run {data.ran_at.slice(0, 10)}
        </span>
      </div>
      <div className="news-card overflow-x-auto">
        <div className="px-4 pt-4 pb-3">
          <p className={`text-[15px] font-semibold ${data.verdict.reliable_edge ? GOOD : BAD}`}>{data.verdict.headline}</p>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed max-w-[86ch]">{data.verdict.detail}</p>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Held for</span>
            {data.horizons.map(x => (
              <Chip key={x.horizon_years} on={x.horizon_years === h.horizon_years} onClick={() => setYears(x.horizon_years)}>
                {x.horizon_years} {x.horizon_years === 1 ? 'year' : 'years'}
              </Chip>
            ))}
          </div>
        </div>

        <table className="w-full text-[13px]">
          <thead>
            <tr className={HEAD_ROW}>
              <th className="px-4 py-2 font-semibold">The rule said</th>
              <th className={TH}>Company-years</th>
              <th className={TH}>Median earned / yr</th>
              <th className={TH}>Reached {floor}% / yr</th>
              <th className={`${TH} pr-4`}>Lost money</th>
            </tr>
          </thead>
          <tbody>
            {h.groups.map(g => (
              <tr key={g.expected} className={BODY_ROW}>
                <td className="px-4 py-2.5 font-medium">{g.expected} a year</td>
                <td className={`${TD} text-muted-foreground`}>{g.n.toLocaleString()}</td>
                <td className={`${TD} font-semibold`}>{pct(g.median)}</td>
                <td className={TD}>{pct(g.reached_floor_pct)}</td>
                <td className={`${TD} pr-4`}>{pct(g.lost_money_pct)}</td>
              </tr>
            ))}
            <tr className="bg-muted/30">
              <td className="px-4 py-2.5 font-medium">All companies</td>
              <td className={`${TD} text-muted-foreground`}>{h.all.n.toLocaleString()}</td>
              <td className={`${TD} font-semibold`}>{pct(h.all.median)}</td>
              <td className={TD}>{pct(h.all.reached_floor_pct)}</td>
              <td className={`${TD} pr-4`}>{pct(h.all.lost_money_pct)}</td>
            </tr>
          </tbody>
        </table>

        <p className="px-4 pt-4 pb-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
          Three ways to choose, each against the typical company bought the same day
        </p>
        <table className="w-full text-[13px]">
          <thead>
            <tr className={HEAD_ROW}>
              <th className="px-4 py-2 font-semibold">Chosen by</th>
              <th className={TH}>Company-years</th>
              <th className={TH}>Median earned / yr</th>
              <th className={TH}>Reached {floor}% / yr</th>
              <th className={TH}>Typical lead</th>
              <th className={TH}>Beat their year</th>
              <th className={`${TH} pr-4`}>Years ahead</th>
            </tr>
          </thead>
          <tbody>
            {h.selections.map(x => (
              <tr key={x.key} className={BODY_ROW}>
                <td className="px-4 py-2.5 font-medium">{x.label}</td>
                <td className={`${TD} text-muted-foreground`}>{x.n.toLocaleString()}</td>
                <td className={`${TD} font-semibold`}>{pct(x.median)}</td>
                <td className={TD}>{pct(x.reached_floor_pct)}</td>
                <td className={`${TD} font-semibold ${leadTone(x.median_lead)}`}>{signed(x.median_lead, ' pts')}</td>
                <td className={TD}>{pct(x.beat_their_year_pct)}</td>
                <td className={`${TD} pr-4`}>{x.years_ahead} of {x.years_tested}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <details className="border-t border-border">
          <summary className="px-4 py-2.5 text-[12px] text-muted-foreground cursor-pointer select-none">
            Year by year: how far each choice led the typical company bought the same 30 June
          </summary>
          <table className="w-full text-[13px]">
            <thead>
              <tr className={HEAD_ROW}>
                <th className="px-4 py-2 font-semibold">Bought</th>
                <th className={TH}>All, median / yr</th>
                {h.selections.map(x => <th key={x.key} className={TH}>{x.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {h.all.by_year.map((y, i) => (
                <tr key={y.year} className={BODY_ROW}>
                  <td className="px-4 py-2 tabular-nums font-medium">{y.year}</td>
                  <td className={TD}>{pct(y.median)} <span className="text-muted-foreground">· {y.companies}</span></td>
                  {h.selections.map(x => {
                    const cell = x.by_year[i]
                    return (
                      <td key={x.key} className={`${TD} font-semibold ${leadTone(cell?.lead)}`}>
                        {signed(cell?.lead, ' pts')}
                        <span className="font-normal text-muted-foreground"> · {cell?.n ?? 0}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[10.5px] text-muted-foreground">The small number after each figure is how many companies it rests on. A lead built on a handful is noise.</p>
        </details>
        <Caveats items={data.caveats} />
      </div>
    </section>
  )
}

// ── Does waiting for a fall pay? ─────────────────────────────────────────────

export function TimingTest() {
  const { data } = useResource<Timing>('/api/timing')
  const [years, setYears] = useState(20)
  if (!data || data.error) return null
  const w = data.windows.find(x => x.years === years) ?? data.windows[data.windows.length - 1]

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3">
        <p className="news-section-label">Does waiting for a fall pay? · ${data.monthly.toLocaleString()} a month</p>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          S&amp;P 500 with dividends, {data.from} to {data.to} · run {data.ran_at.slice(0, 10)}
        </span>
      </div>
      <div className="news-card overflow-x-auto">
        <div className="px-4 pt-4 pb-3">
          <p className={`text-[15px] font-semibold ${data.verdict.waiting_pays ? GOOD : BAD}`}>{data.verdict.headline}</p>
          <p className="mt-1 text-[13px] text-muted-foreground leading-relaxed max-w-[86ch]">{data.verdict.detail}</p>
          <div className="mt-3 flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Invested for</span>
            {data.windows.map(x => (
              <Chip key={x.years} on={x.years === w.years} onClick={() => setYears(x.years)}>{x.years} years</Chip>
            ))}
            <span className="ml-2 text-[11px] text-muted-foreground tabular-nums">
              {w.windows} periods tested · ${w.paid_in.toLocaleString()} paid in
            </span>
          </div>
        </div>
        <table className="w-full text-[13px]">
          <thead>
            <tr className={HEAD_ROW}>
              <th className="px-4 py-2 font-semibold">Plan</th>
              <th className={TH}>Median end value</th>
              <th className={TH}>Beat steady</th>
              <th className={TH}>Typical result</th>
              <th className={TH}>Worst</th>
              <th className={`${TH} pr-4`}>Best</th>
            </tr>
          </thead>
          <tbody>
            {w.strategies.map(p => {
              const steady = p.key === 'steady'
              return (
                <tr key={p.key} className={steady ? 'bg-muted/30' : BODY_ROW}>
                  <td className="px-4 py-2.5 font-medium">{p.label}</td>
                  <td className={`${TD} font-semibold`}>${p.median_end.toLocaleString()}</td>
                  <td className={TD}>{steady ? '—' : `${p.beat_steady_pct}% of periods`}</td>
                  <td className={`${TD} font-semibold ${steady ? '' : leadTone(p.median_vs_steady_pct)}`}>
                    {steady ? '—' : signed(p.median_vs_steady_pct, '%')}
                  </td>
                  <td className={`${TD} ${steady ? '' : BAD}`}>{steady ? '—' : signed(p.worst_vs_steady_pct, '%')}</td>
                  <td className={`${TD} pr-4`}>{steady ? '—' : signed(p.best_vs_steady_pct, '%')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="px-4 py-2.5 border-t border-border text-[10.5px] text-muted-foreground leading-relaxed">
          Typical, worst and best are measured against investing every month over the same period. A fall is
          counted from the highest month-end the index has reached. Cash that waits earns the federal funds rate.
        </p>
        <Caveats items={data.caveats} />
      </div>
    </section>
  )
}

// ── Everything that clears the rule today ────────────────────────────────────

const PRICE_CAPS = [null, 100, 50] as const

export function ResearchList({ rows, floorPct, requiredMoat, footnote }: {
  rows: ResearchRow[]; floorPct: number; requiredMoat: string; footnote: React.ReactNode
}) {
  const [cap, setCap] = useState<number | null>(null)
  const [qualityOnly, setQualityOnly] = useState(false)
  const shown = rows.filter(r => (cap == null || r.price <= cap) && (!qualityOnly || r.quality))

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3">
        <p className="news-section-label">Research · every name that clears {floorPct}% a year</p>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {shown.length} of {rows.length} · ranked by expected return · not a buy list
        </span>
      </div>
      <div className="news-card">
        <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mr-1">Share price</span>
          {PRICE_CAPS.map(c => (
            <Chip key={c ?? 'any'} on={cap === c} onClick={() => setCap(c)}>{c == null ? 'Any' : `Under $${c}`}</Chip>
          ))}
          <span className="w-3" />
          <Chip on={qualityOnly} onClick={() => setQualityOnly(q => !q)}>Passed quality screen</Chip>
        </div>
        <div className="overflow-auto max-h-[640px]">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-card">
              <tr className={HEAD_ROW}>
                <th className="px-4 py-2 font-semibold">Ticker</th>
                <th className="px-3 py-2 font-semibold">Moat</th>
                <th className={TH}>Price</th>
                <th className={TH}>Expected / yr</th>
                <th className={TH}>{floorPct}% price</th>
                <th className={TH}>20% price</th>
                <th className={TH}>vs 52w high</th>
                <th className={TH}>Last 10 yrs / yr</th>
                <th className={TH}>ROE</th>
                <th className={`${TH} pr-4`}>Rev growth</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.ticker} className={`${BODY_ROW} hover:bg-muted/30 cursor-pointer`}
                  onClick={() => openLab(r.ticker)} title={`Open ${r.ticker} in the Research Lab`}>
                  <td className="px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap">
                    {r.ticker}
                    {r.quality && <span className="ml-2 text-[9.5px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300">quality</span>}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">
                    {r.moat ?? 'not rated'}
                  </td>
                  <td className={TD}>{usd(r.price)}</td>
                  <td className={`${TD} font-semibold ${GOOD}`}>{pct(r.expected_return_pct)}</td>
                  <td className={`${TD} text-muted-foreground`}>{usd(r.buy_below)}</td>
                  <td className={`${TD} text-muted-foreground`}>{usd(r.target_below)}</td>
                  <td className={`${TD} ${r.vs_52w_high_pct < -40 ? BAD : 'text-muted-foreground'}`}>{r.vs_52w_high_pct}%</td>
                  <td className={TD}>{pct(r.ten_year_return_pct)}</td>
                  <td className={TD}>{pct(r.roe_pct)}</td>
                  <td className={`${TD} pr-4`}>{pct(r.rev_cagr_pct)}</td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-6 text-center text-muted-foreground">No names match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2.5 border-t border-border text-[10.5px] text-muted-foreground leading-relaxed">
          Only names rated {requiredMoat} on the watchlist can enter the buy-zone queue; the rest are here to study.
          A fall of more than 40% from the 52-week high is marked red: find out why before anything else. {footnote}
        </p>
      </div>
    </section>
  )
}

// ── The best ten-year records ────────────────────────────────────────────────

export function LongTermWinners({ rows, floorPct }: { rows: ResearchRow[]; floorPct: number }) {
  const [open, setOpen] = useState(false)
  const shown = open ? rows : rows.slice(0, 15)
  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-3">
        <p className="news-section-label">Long-term winners · best ten-year records</p>
        <span className="text-[11px] text-muted-foreground">what happened, not what will · price change plus dividends</span>
      </div>
      <div className="news-card overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className={HEAD_ROW}>
              <th className="px-4 py-2 font-semibold">Ticker</th>
              <th className="px-3 py-2 font-semibold">Moat</th>
              <th className={TH}>Last 10 yrs / yr</th>
              <th className={TH}>$1,000 became</th>
              <th className={TH}>Price</th>
              <th className={TH}>Expected / yr now</th>
              <th className={`${TH} pr-4`}>{floorPct}% price</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => (
              <tr key={r.ticker} className={`${BODY_ROW} hover:bg-muted/30 cursor-pointer`}
                onClick={() => openLab(r.ticker)} title={`Open ${r.ticker} in the Research Lab`}>
                <td className="px-4 py-2.5 font-semibold tabular-nums whitespace-nowrap">
                  {r.ticker}
                  {r.quality && <span className="ml-2 text-[9.5px] uppercase tracking-wider font-semibold text-emerald-700 dark:text-emerald-300">quality</span>}
                </td>
                <td className="px-3 py-2.5 text-[11px] text-muted-foreground whitespace-nowrap">{r.moat ?? 'not rated'}</td>
                <td className={`${TD} font-semibold`}>{pct(r.ten_year_return_pct)}</td>
                <td className={TD}>
                  {r.ten_year_return_pct == null ? '—'
                    : `$${Math.round(1000 * (1 + r.ten_year_return_pct / 100) ** 10).toLocaleString()}`}
                </td>
                <td className={TD}>{usd(r.price)}</td>
                <td className={`${TD} font-semibold ${
                  r.expected_return_pct == null ? 'text-muted-foreground' : r.expected_return_pct >= floorPct ? GOOD : ''}`}>
                  {pct(r.expected_return_pct)}
                </td>
                <td className={`${TD} pr-4 text-muted-foreground`}>{usd(r.buy_below)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="px-4 py-2.5 border-t border-border flex items-center justify-between gap-4">
          <p className="text-[10.5px] text-muted-foreground leading-relaxed">
            These are the companies that compounded fastest over the last ten years. It is hindsight: a great
            decade is usually already in the price, which is why few of them clear {floorPct}% now.
          </p>
          {rows.length > 15 && (
            <button type="button" onClick={() => setOpen(o => !o)}
              className="shrink-0 text-[11px] underline decoration-dotted text-muted-foreground hover:text-foreground">
              {open ? 'Show top 15' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
