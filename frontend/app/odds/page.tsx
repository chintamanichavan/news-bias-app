'use client'

import { useEffect, useState } from 'react'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Horizon {
  years: number
  percentiles: Record<'5' | '25' | '50' | '75' | '95', number>
  p_goal: Record<string, number>
  p_loss: number
  history_share: Record<string, number | null>
}

interface Priced {
  label: string
  record: { cagr: number; vol: number; max_drawdown: number; worst_12m: number; worst_12m_ending: string }
  horizons: Horizon[]
  bad_year: { one_in_20: number; one_in_100: number }
  drawdown: { median: number; one_in_20: number; p_beyond_50: number; p_beyond_75: number }
}

interface Odds {
  since: string
  through: string
  months: number
  fees: number
  goals: number[]
  plan: Priced
  benchmarks: Priced[]
  choices: string[]
  sleeves: { key: string; region: string; factor: string; weight: number; proxy: string; cagr: number; vol: number; risk_share: number }[]
}

const REGION: Record<string, string> = {
  'us-developed': 'US',
  'international-developed': 'International',
  emerging: 'Emerging',
  global: 'Global',
}

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`
const signed = (x: number, digits = 0) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
const odds = (p: number) => (p < 0.005 ? 'under 1%' : pct(p))
const share = (p: number | null) => (p === null ? '—' : pct(p))
const sleeveName = (key: string) => {
  const [region, factor] = key.split('/')
  return `${REGION[region] ?? region} ${factor.replace('-', ' ')}`
}

/** The range of yearly growth: whiskers 5–95, box 25–75, a tick at the middle. */
function RangeBar({ h, lo, hi, goals }: { h: Horizon; lo: number; hi: number; goals: number[] }) {
  const x = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`
  const p = h.percentiles
  return (
    <div className="relative h-6">
      <div className="absolute inset-y-0 border-l border-dashed border-muted-foreground/40" style={{ left: x(0) }} />
      {goals.map(g => (
        <div key={g} className="absolute inset-y-0 border-l border-emerald-500/60" style={{ left: x(g) }} />
      ))}
      <div className="absolute top-1/2 h-px bg-foreground/40" style={{ left: x(p['5']), right: `calc(100% - ${x(p['95'])})` }} />
      <div className="absolute top-1 bottom-1 rounded-sm bg-foreground/15 border border-foreground/30"
        style={{ left: x(p['25']), right: `calc(100% - ${x(p['75'])})` }} />
      <div className="absolute top-0.5 bottom-0.5 w-0.5 bg-foreground" style={{ left: x(p['50']) }} />
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="news-card p-4">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  )
}

/** Percent per sleeve, whole numbers, for every sleeve the backend can price. */
function planWeights(data: Odds): Record<string, number> {
  const w = Object.fromEntries(data.choices.map(k => [k, 0]))
  for (const s of data.sleeves) w[s.key] = Math.round(s.weight * 100)
  return w
}

function WhatIf({ data, years }: { data: Odds; years: number }) {
  const plan = planWeights(data)
  const [weights, setWeights] = useState(plan)
  const [result, setResult] = useState<Odds | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const total = Object.values(weights).reduce((a, b) => a + b, 0)
  const changed = data.choices.some(k => weights[k] !== plan[k])
  const body = JSON.stringify({ weights })

  useEffect(() => {
    if (!changed || total === 0) return
    const ctl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch('/api/odds/whatif', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body, signal: ctl.signal,
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.detail ?? `HTTP ${res.status}`)
        setResult(json)
        setFailed(null)
      } catch (e) {
        if (!ctl.signal.aborted) setFailed(e instanceof Error ? e.message : String(e))
      }
    }, 300)
    return () => { clearTimeout(t); ctl.abort() }
  }, [body, changed, total])

  const shown = changed && total > 0 ? result : null
  const [floor, target] = data.goals.map(g => g.toFixed(2))
  const base = data.plan
  const alt = shown?.plan
  const h0 = base.horizons.find(h => h.years === years)!
  const h1 = alt?.horizons.find(h => h.years === years)
  // [label, plan, what if, higher is better, format]
  const lines: [string, number | null, number | null | undefined, boolean, (x: number) => string][] = [
    ['Middle outcome a year', h0.percentiles['50'], h1?.percentiles['50'], true, x => pct(x, 1)],
    [`Odds of ${pct(data.goals[0])}+ a year`, h0.p_goal[floor], h1?.p_goal[floor], true, odds],
    [`Odds of ${pct(data.goals[1])}+ a year`, h0.p_goal[target], h1?.p_goal[target], true, odds],
    ['Odds of losing money', h0.p_loss, h1?.p_loss, false, odds],
    [`Real ${years}-year stretches at ${pct(data.goals[0])}+`, h0.history_share[floor], h1?.history_share[floor], true, pct],
    ['A 1-in-20 year', base.bad_year.one_in_20, alt?.bad_year.one_in_20, true, x => signed(x)],
    ['Chance of a fall past 50%', base.drawdown.p_beyond_50, alt?.drawdown.p_beyond_50, false, odds],
    ['Deepest real fall', base.record.max_drawdown, alt?.record.max_drawdown, true, x => signed(x)],
    [`Grew a year since ${data.since.slice(0, 4)}`, base.record.cagr, alt?.record.cagr, true, x => pct(x, 1)],
  ]

  return (
    <section className="mb-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 px-1">
        <h2 className="news-section-label">What if</h2>
        <div className="flex gap-1.5">
          <button
            onClick={() => setWeights({
              ...Object.fromEntries(data.choices.map(k => [k, 0])),
              'us-developed/buybacks': 50, 'us-developed/most-profitable': 50,
            })}
            title="Half in companies whose share count fell, half in the most profitable fifth: the two rules sixty years of data favour"
            className="text-[13px] px-3 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground">
            Buybacks + profitable
          </button>
          <button onClick={() => { setWeights(plan); setResult(null) }} disabled={!changed}
            className="text-[13px] px-3 py-1 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground disabled:opacity-40">
            Back to the plan
          </button>
        </div>
      </div>
      <div className="grid lg:grid-cols-2 gap-3">
        <div className="news-card p-4">
          <div className="space-y-2.5">
            {data.choices.map(k => (
              <label key={k} className="grid grid-cols-[1fr_auto] gap-x-3 items-center text-[13px]">
                <span className="flex justify-between">
                  <span>{sleeveName(k)}</span>
                  <span className="tabular-nums text-muted-foreground text-[11px]">plan {plan[k]}%</span>
                </span>
                <span className={`tabular-nums w-10 text-right ${weights[k] !== plan[k] ? 'font-semibold' : ''}`}>{weights[k]}%</span>
                <input type="range" min={0} max={50} step={1} value={weights[k]}
                  onChange={e => setWeights({ ...weights, [k]: Number(e.target.value) })}
                  className="col-span-2 w-full accent-foreground h-4" />
              </label>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 tabular-nums">
            Adds up to {total}%.{total !== 100 && total > 0 && ' Priced as if scaled to 100%.'}
            {total === 0 && ' Give at least one sleeve some money.'}
          </p>
        </div>
        <div className="news-card p-4 self-start">
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2">Over {years} years</th>
                <th className="font-normal pb-2 text-right">Plan</th>
                <th className="font-normal pb-2 text-right">What if</th>
              </tr>
            </thead>
            <tbody>
              {lines.map(([label, a, b, up, fmt]) => {
                // Colour only a difference that shows once rounded.
                const moved = a !== null && b != null && fmt(a) !== fmt(b)
                const better = moved && (b > a) === up
                const worse = moved && (b > a) !== up
                return (
                  <tr key={label} className="border-t border-border/60">
                    <td className="py-2 pr-3">{label}</td>
                    <td className="py-2 text-right">{a === null ? '—' : fmt(a)}</td>
                    <td className={`py-2 text-right font-semibold ${better ? 'text-emerald-600 dark:text-emerald-400' : worse ? 'text-red-600 dark:text-red-400' : ''}`}>
                      {b == null ? '—' : fmt(b)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">
            {failed ? `Could not price this mix: ${failed}`
              : !changed ? 'Move a slider to price a different mix on the same 10,000 futures.'
              : !shown ? 'Pricing…'
              : 'Green is better than the plan, red is worse. Same months, same draws, same fees.'}
          </p>
        </div>
      </div>
    </section>
  )
}

export default function OddsPage() {
  const { data, loading, refreshing, error, reload } = useResource<Odds>('/api/odds')
  const [years, setYears] = useState(10)

  if (error && !data) return <LoadError message={error} onRetry={reload} retrying={refreshing || loading} />
  if (!data) return <div className="px-4 py-16 text-center text-sm text-muted-foreground">Pricing your plan…</div>

  const [floor, target] = data.goals.map(g => g.toFixed(2))
  const rows = [data.plan, ...data.benchmarks]
  const at = (p: Priced) => p.horizons.find(h => h.years === years)!
  const plan = at(data.plan)
  const lo = Math.min(0, ...rows.map(r => at(r).percentiles['5'])) - 0.02
  const hi = Math.max(...data.goals, ...rows.map(r => at(r).percentiles['95'])) + 0.02
  const firstYear = data.since.slice(0, 4)
  const dd = data.plan.drawdown

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8 max-w-5xl">
      <header className="mb-7">
        <p className="news-section-label">Your plan, priced</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">The odds</h1>
        <p className="text-[15px] mt-4 max-w-2xl leading-relaxed">
          Over {years} years your plan has a <b>{odds(plan.p_goal[floor])}</b> chance of growing {pct(data.goals[0])} a
          year, and <b>{odds(plan.p_goal[target])}</b> of {pct(data.goals[1])}. The middle outcome
          is <b>{pct(plan.percentiles['50'], 1)}</b> a year. In the real record since {firstYear},{' '}
          {share(plan.history_share[floor])} of {years}-year stretches reached {pct(data.goals[0])}.
        </p>
      </header>

      <section className="mb-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3 px-1">
          <h2 className="news-section-label">Yearly growth over</h2>
          <div className="flex gap-1">
            {data.plan.horizons.map(h => (
              <button key={h.years} onClick={() => setYears(h.years)}
                className={`whitespace-nowrap text-[13px] px-3 py-1 rounded-full transition-colors ${h.years === years ? 'bg-foreground text-background' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>
                {h.years} years
              </button>
            ))}
          </div>
        </div>
        <div className="news-card p-4 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[640px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2 w-44"></th>
                <th className="font-normal pb-2">Range: 1 in 20 low · middle half · 1 in 20 high</th>
                <th className="font-normal pb-2 text-right">Middle</th>
                <th className="font-normal pb-2 text-right">{pct(data.goals[0])}+</th>
                <th className="font-normal pb-2 text-right">{pct(data.goals[1])}+</th>
                <th className="font-normal pb-2 text-right">Lose money</th>
                <th className="font-normal pb-2 text-right" title={`Share of real ${years}-year stretches since ${firstYear}`}>Real record {pct(data.goals[0])}+</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const h = at(r)
                return (
                  <tr key={r.label} className={`border-t border-border/60 ${i === 0 ? 'font-semibold' : ''}`}>
                    <td className="py-2.5 pr-3">{r.label}</td>
                    <td className="py-2.5 pr-4 min-w-48"><RangeBar h={h} lo={lo} hi={hi} goals={data.goals} /></td>
                    <td className="py-2.5 text-right">{pct(h.percentiles['50'], 1)}</td>
                    <td className="py-2.5 text-right">{odds(h.p_goal[floor])}</td>
                    <td className="py-2.5 text-right">{odds(h.p_goal[target])}</td>
                    <td className="py-2.5 text-right">{odds(h.p_loss)}</td>
                    <td className="py-2.5 text-right">{share(h.history_share[floor])}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">
            Range runs {pct(lo)} to {pct(hi)} a year. Green lines mark {pct(data.goals[0])} and {pct(data.goals[1])};
            the dashed line is zero. The simulated odds and the real record can disagree: the record holds only
            about {Math.floor(data.months / 12 / years)} separate {years}-year stretches.
          </p>
        </div>
      </section>

      <WhatIf data={data} years={years} />

      <section className="mb-10">
        <h2 className="news-section-label mb-3 px-1">The bad year and the deep fall</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="A 1-in-20 year" value={signed(data.plan.bad_year.one_in_20)}
            sub={`1 in 100: ${signed(data.plan.bad_year.one_in_100)}`} />
          <Stat label="Worst real 12 months" value={signed(data.plan.record.worst_12m)}
            sub={`ending ${data.plan.record.worst_12m_ending}`} />
          <Stat label="Deepest fall in 15 years, typical" value={signed(dd.median)}
            sub={`1 in 20: ${signed(dd.one_in_20)}`} />
          <Stat label="Chance of a fall past 50%" value={odds(dd.p_beyond_50)}
            sub={`past 75%, your stated limit: ${odds(dd.p_beyond_75)}`} />
        </div>
        <div className="news-card p-4 mt-3 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[520px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2"></th>
                <th className="font-normal pb-2 text-right">Grew a year since {firstYear}</th>
                <th className="font-normal pb-2 text-right">Swings a year</th>
                <th className="font-normal pb-2 text-right">Deepest real fall</th>
                <th className="font-normal pb-2 text-right">Fall past 50% in 15 years</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.label} className={`border-t border-border/60 ${i === 0 ? 'font-semibold' : ''}`}>
                  <td className="py-2 pr-3">{r.label}</td>
                  <td className="py-2 text-right">{pct(r.record.cagr, 1)}</td>
                  <td className="py-2 text-right">{pct(r.record.vol, 1)}</td>
                  <td className="py-2 text-right">{signed(r.record.max_drawdown)}</td>
                  <td className="py-2 text-right">{odds(r.drawdown.p_beyond_50)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="news-section-label mb-3 px-1">What drives it</h2>
        <div className="news-card p-4 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[560px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2">Sleeve</th>
                <th className="font-normal pb-2 w-[38%]">Share of money · share of the swings</th>
                <th className="font-normal pb-2 text-right">Grew a year</th>
                <th className="font-normal pb-2 text-right">Swings a year</th>
              </tr>
            </thead>
            <tbody>
              {data.sleeves.map(s => (
                <tr key={`${s.region}-${s.factor}`} className="border-t border-border/60" title={`Stand-in: ${s.proxy}`}>
                  <td className="py-2 pr-3">{sleeveName(s.key)}</td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 space-y-1">
                        <div className="h-1.5 rounded-full bg-foreground/50" style={{ width: `${s.weight * 400}%`, maxWidth: '100%' }} />
                        <div className="h-1.5 rounded-full bg-amber-500/80" style={{ width: `${s.risk_share * 400}%`, maxWidth: '100%' }} />
                      </div>
                      <span className="text-[11px] text-muted-foreground w-16 text-right">{pct(s.weight)} · {pct(s.risk_share)}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right">{pct(s.cagr, 1)}</td>
                  <td className="py-2 text-right">{pct(s.vol, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground mt-3">
            Grey is the share of money, amber the share of the plan&apos;s swings. A sleeve whose amber bar is
            longer adds more risk than its size suggests. Hover a row for its stand-in.
          </p>
        </div>
      </section>

      <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
        Your Core target allocation, in percentages. Each sleeve is stood in for by a Ken French research
        portfolio with the same tilt, {data.since} to {data.through} ({data.months} months), in US dollars.
        10,000 futures are drawn by resampling 12-month blocks of real months, all sleeves together.
        The odds assume the next 15 years look like the last 35. Less {pct(data.fees, 1)} a year for fund
        costs; nothing for taxes. Not financial advice.
      </p>
    </div>
  )
}
