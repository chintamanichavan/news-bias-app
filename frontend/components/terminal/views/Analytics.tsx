import { useEffect, useState } from 'react'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Loading, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, tone } from '@/lib/terminal/numbers'
import { argSymbol } from '@/lib/terminal/parse'
import { send } from '@/lib/terminal/send'
import { parseTrades } from '@/lib/terminal/trades'
import { invalidate, useResource } from '@/lib/useResource'

// LRSK, PSD, PSH, HEFF, UNCL and FTST.

const Empty = () => <Note>Your book is empty. Add holdings with PRTU first.</Note>

interface Liq { participation: number; rows: { symbol: string; name: string | null; quantity: number; value: number | null; weight: number | null; avg_volume: number | null; pct_of_adv: number | null; days: number | null }[]; days_to_exit: number; liquid_1d_pct: number; liquid_5d_pct: number }

export function Liquidity({ command, run }: ViewProps) {
  const part = Number(command.args[0]) > 0 && Number(command.args[0]) <= 100 ? Number(command.args[0]) / 100 : 0.2
  const { data, error, loading } = useResource<Liq>(`/api/terminal/analytics/liquidity?participation=${part}`, { freshMs: 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Empty /> : (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">Selling at {Math.round(d.participation * 100)}% of each stock&apos;s average daily volume, the whole book is out in <b>{d.days_to_exit < 1 ? 'under a day' : `${d.days_to_exit.toFixed(1)} days`}</b>; {d.liquid_1d_pct.toFixed(0)}% of it within a day, {d.liquid_5d_pct.toFixed(0)}% within five.</p>
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} AVGV`)} columns={[
            { head: 'Holding', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
            { head: 'Shares', cell: r => r.quantity.toLocaleString('en-US') },
            { head: 'Value', cell: r => big(r.value) },
            { head: 'Average daily volume', cell: r => big(r.avg_volume) },
            { head: '% of a day', cell: r => (r.pct_of_adv == null ? '—' : r.pct_of_adv.toFixed(3)) },
            { head: 'Days to sell', cell: r => (r.days == null ? '—' : r.days < 0.01 ? '<0.01' : r.days.toFixed(2)), className: r => ((r.days ?? 0) > 1 ? 'font-semibold text-amber-600 dark:text-amber-400' : '') },
          ]} />
          <Note>Days to sell = shares ÷ (participation × three-month average daily volume). Change the participation: LRSK 10 for 10%. Selling more than a fifth of a day&apos;s volume usually moves the price.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Psd { measures: Record<string, { label: string; value: number | null; coverage: number }>; weighted_median_cap: number | null; rows: { symbol: string; weight: number; pe: number | null; forward_pe: number | null; price_to_book: number | null; dividend_yield: number | null; market_cap: number | null }[] }

export function BookFundamentals({ run }: ViewProps) {
  const { data, error, loading } = useResource<Psd>('/api/terminal/analytics/fundamentals', { freshMs: 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Empty /> : (
        <div className="space-y-3">
          <Table rows={Object.values(d.measures)} rowKey={m => m.label} columns={[
            { head: 'Your book', align: 'left', cell: m => m.label },
            { head: '', cell: m => (m.value == null ? '—' : m.value.toFixed(2)) },
            { head: 'Weight covered', cell: m => pct(m.coverage * 100, false) },
          ]} />
          <p className="text-[13px]">Weighted median market value: <b>{big(d.weighted_median_cap)}</b></p>
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)} columns={[
            { head: 'Holding', align: 'left', cell: r => <b>{r.symbol}</b> },
            { head: 'Weight', cell: r => pct(r.weight * 100, false) },
            { head: 'P/E', cell: r => r.pe?.toFixed(1) ?? '—' },
            { head: 'Forward P/E', cell: r => r.forward_pe?.toFixed(1) ?? '—' },
            { head: 'Price/book', cell: r => r.price_to_book?.toFixed(2) ?? '—' },
            { head: 'Yield', cell: r => (r.dividend_yield == null ? '—' : `${r.dividend_yield.toFixed(2)}%`) },
          ]} />
          <Note>Ratios are averaged through their inverses (earnings yield, book yield), as index providers do, so one stock on a huge multiple cannot dominate. Coverage is the share of the book that has the figure.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Stats { volatility?: number | null; beta?: number | null; var_95?: [number, number] | null; max_drawdown?: number | null; value: number }
interface WhatIf { before: Stats; after: Stats; weights: { symbol: string; before: number | null; after: number | null }[] }

export function TradeImpact({ command }: ViewProps) {
  const parsed = parseTrades(command.args)
  const [state, setState] = useState<{ data: WhatIf | null; error: string | null }>({ data: null, error: null })
  const key = JSON.stringify(parsed)
  useEffect(() => {
    if (!('trades' in parsed)) return
    let alive = true
    send<WhatIf>('POST', '/api/terminal/analytics/what-if', { trades: parsed.trades })
      .then(d => alive && setState({ data: d, error: null })).catch(e => alive && setState({ data: null, error: (e as Error).message }))
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  if ('error' in parsed) return <Note>{parsed.error} Prices are today&apos;s; nothing is traded.</Note>
  if (state.error) return <Fail message={state.error} />
  if (!state.data) return <Loading />
  const d = state.data
  const row = (label: string, f: (s: Stats) => string) => ({ label, before: f(d.before), after: f(d.after) })
  const p = (v: number | null | undefined) => (v == null ? '—' : pct(v * 100, false))
  return (
    <div className="space-y-3">
      <Table rows={[
        row('Value', s => big(s.value)), row('Volatility, a year', s => p(s.volatility)), row('Beta to S&P 500', s => s.beta?.toFixed(2) ?? '—'),
        row('One-day loss, 1 in 20', s => p(s.var_95?.[0])), row('Worst fall in the year', s => p(s.max_drawdown)),
      ]} rowKey={r => r.label} columns={[
        { head: '', align: 'left', cell: r => r.label }, { head: 'Now', cell: r => r.before }, { head: 'After the trades', cell: r => <b>{r.after}</b> },
      ]} />
      <Table rows={d.weights} rowKey={w => w.symbol} columns={[
        { head: 'Holding', align: 'left', cell: w => <b>{w.symbol}</b> },
        { head: 'Weight now', cell: w => (w.before == null ? '—' : pct(w.before * 100, false)) },
        { head: 'After', cell: w => (w.after == null ? '—' : pct(w.after * 100, false)) },
        { head: 'Change', cell: w => pct(((w.after ?? 0) - (w.before ?? 0)) * 100), className: w => tone((w.after ?? 0) - (w.before ?? 0)) },
      ]} />
      <Note>The book before and after the trades at today&apos;s prices, risk measured over the last year as if today&apos;s weights had been held. Nothing is traded and the book is unchanged.</Note>
    </div>
  )
}

interface Hedge { symbol: string; hedge: string; quantity: number; days: number; optimal_hedge_units: number; hedge_units: number; r2: number | null; slope: number; dollar_offset: number | null; risk_unhedged: number; risk_hedged: number; variance_reduction: number | null; effective: boolean }

export function HedgeEffect({ command }: ViewProps) {
  const sec = command.security
  const hedge = command.args[0] ? argSymbol(command.args[0]) : null
  const qty = Number(command.args[1]) || 100
  const { data, error, loading } = useResource<Hedge>(sec && hedge ? `/api/terminal/analytics/hedge?symbol=${encodeURIComponent(sec.symbol)}&hedge=${encodeURIComponent(hedge)}&quantity=${qty}` : null)
  if (!sec || !hedge) return <Note>Name the position and the hedge: AAPL HEFF QQQ 100 (100 shares of Apple hedged with QQQ).</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">To hedge {d.quantity} {d.symbol}, short <b>{Math.abs(d.optimal_hedge_units).toFixed(2)} {d.hedge}</b> (the least-squares ratio over {d.days} days). The hedge is <b className={d.effective ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{d.effective ? 'effective' : 'not effective'}</b> by the usual test.</p>
          <Table rows={[
            ['R² of the regression', d.r2?.toFixed(3) ?? '—', 'at least 0.80'],
            ['Slope (hedge on position)', d.slope.toFixed(3), 'between −0.80 and −1.25'],
            ['Dollar offset', d.dollar_offset?.toFixed(3) ?? '—', 'between −0.80 and −1.25'],
            ['Daily risk, unhedged', `$${d.risk_unhedged.toFixed(2)}`, ''],
            ['Daily risk, hedged', `$${d.risk_hedged.toFixed(2)}`, ''],
            ['Variance removed', d.variance_reduction == null ? '—' : pct(d.variance_reduction * 100, false), ''],
          ]} rowKey={r => r[0]} columns={[
            { head: 'Test', align: 'left', cell: r => r[0] }, { head: '', cell: r => <b>{r[1]}</b> }, { head: 'Effective if', align: 'left', cell: r => <span className="text-muted-foreground">{r[2]}</span> },
          ]} />
          <Note>Daily dollar changes over the last year. The 80–125% range is the accounting standards&apos; old bright line for hedge accounting (ASC 815, IAS 39). Give your own hedge size: a third number fixes the hedge units.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Tags { groups: { tag: string; weight: number; value: number; symbols: string[] }[]; tags: Record<string, string[]> }

export function Classifications() {
  const url = '/api/terminal/analytics/tags'
  const { data, error, loading, reload } = useResource<Tags>(url, { freshMs: 0 })
  const [form, setForm] = useState({ symbol: '', tag: '' })
  const [problem, setProblem] = useState<string | null>(null)
  async function change(fn: () => Promise<unknown>) {
    try { setProblem(null); await fn(); invalidate(url); reload() } catch (e) { setProblem((e as Error).message) }
  }
  const input = 'font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <div className="space-y-3">
      <form className="flex flex-wrap gap-2 text-[12px]" onSubmit={e => { e.preventDefault(); if (form.symbol && form.tag) void change(() => send('POST', url, form)).then(() => setForm({ symbol: '', tag: '' })) }}>
        <input value={form.symbol} onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} placeholder="Security" className={`${input} w-28`} />
        <input value={form.tag} onChange={e => setForm({ ...form, tag: e.target.value })} placeholder="Tag, e.g. Core, AI theme, Income" className={`${input} flex-1 min-w-[12rem]`} />
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Tag it</button>
      </form>
      {problem && <Fail message={problem} />}
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <>
            {d.groups.length === 0 ? <Empty /> : (
              <Table rows={d.groups} rowKey={g => g.tag} columns={[
                { head: 'Tag', align: 'left', cell: g => <b>{g.tag}</b> },
                { head: 'Weight', cell: g => pct(g.weight * 100, false) },
                { head: 'Value', cell: g => big(g.value) },
                { head: 'Holdings', align: 'left', cell: g => g.symbols.join(', ') },
              ]} />
            )}
            {Object.keys(d.tags).length > 0 && (
              <p className="text-[12px] flex flex-wrap gap-1.5">
                {Object.entries(d.tags).flatMap(([s, ts]) => ts.map(t => (
                  <span key={`${s}${t}`} className="px-2 py-0.5 rounded-full bg-muted">{s}: {t} <button aria-label="Remove tag" className="text-muted-foreground hover:text-red-600" onClick={() => void change(() => send('DELETE', `${url}/${encodeURIComponent(s)}/${encodeURIComponent(t)}`))}>×</button></span>
                )))}
              </p>
            )}
          </>
        )}
      </Fetched>
      <Note>Your own groups for the book, beside the standard sectors: a holding can carry several tags, and its weight counts in each. Kept on this machine.</Note>
    </div>
  )
}

interface Factors {
  from: string; to: string
  record: { factor: string; name: string; months: number; annual_mean: number; annual_vol: number; sharpe: number | null; t: number | null; cumulative: number; path: { t: string; v: number }[] }[]
  loadings?: { symbol: string; months: number; r2: number | null; alpha_annual: number; alpha_t: number | null; factors: { factor: string; name: string; loading: number; t: number | null }[] }
}

const FCOL = ['stroke-foreground', 'stroke-indigo-500', 'stroke-amber-500', 'stroke-emerald-500', 'stroke-rose-500', 'stroke-sky-500']

export function FactorView({ command, run }: ViewProps) {
  const years = Number(command.args.find(a => /^\d+Y$/i.test(a))?.slice(0, -1)) || 10
  const sym = command.security?.symbol
  const { data, error, loading } = useResource<Factors>(`/api/terminal/analytics/factors?years=${years}${sym ? `&symbol=${encodeURIComponent(sym)}` : ''}`, { freshMs: 6 * 60 * 60_000 })
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {[5, 10, 20, 30].map(y => (
          <button key={y} onClick={() => run(`${command.security ? `${command.security.label} ` : ''}FTST ${y}Y`)} className={`text-[11px] px-2 py-0.5 rounded-full ${y === years ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{y}Y</button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <>
            <ChartLegend items={d.record.map((r, i) => ({ label: r.factor, cls: FCOL[i % FCOL.length] }))} />
            <TimeSeriesChart H={220} series={d.record.map((r, i) => ({ label: r.factor, cls: FCOL[i % FCOL.length], points: r.path }))} yFmt={v => v.toFixed(0)} />
            <Table rows={d.record} rowKey={r => r.factor} columns={[
              { head: 'Factor', align: 'left', cell: r => <span><b>{r.factor}</b> <span className="text-muted-foreground">{r.name}</span></span> },
              { head: 'A year', cell: r => pct(r.annual_mean * 100), className: r => tone(r.annual_mean) },
              { head: 'Volatility', cell: r => pct(r.annual_vol * 100, false) },
              { head: 'Sharpe', cell: r => r.sharpe?.toFixed(2) ?? '—' },
              { head: 't', cell: r => r.t?.toFixed(1) ?? '—', className: r => (Math.abs(r.t ?? 0) >= 2 ? 'font-semibold' : '') },
              { head: 'In all', cell: r => pct(r.cumulative * 100), className: r => tone(r.cumulative) },
            ]} />
            {d.loadings && (
              <>
                <p className="news-section-label">{d.loadings.symbol}&apos;s exposures, {d.loadings.months} months</p>
                <Table rows={d.loadings.factors} rowKey={f => f.factor} columns={[
                  { head: 'Factor', align: 'left', cell: f => <span><b>{f.factor}</b> <span className="text-muted-foreground">{f.name}</span></span> },
                  { head: 'Loading', cell: f => f.loading.toFixed(2), className: f => tone(f.loading) },
                  { head: 't', cell: f => f.t?.toFixed(1) ?? '—', className: f => (Math.abs(f.t ?? 0) >= 2 ? 'font-semibold' : 'text-muted-foreground') },
                ]} />
                <p className="text-[13px] tabular-nums">Alpha {pct(d.loadings.alpha_annual * 100)} a year (t {d.loadings.alpha_t?.toFixed(1)}); the factors explain {((d.loadings.r2 ?? 0) * 100).toFixed(0)}% of its monthly returns.</p>
              </>
            )}
            <Note>Fama and French&apos;s five factors and momentum, from Kenneth French&apos;s data library at Dartmouth, monthly, {d.from} to {d.to}; each line is a long-short portfolio grown from 100. A t above 2 is the usual bar for a real effect. Put a security first for its loadings: AAPL FTST.</Note>
          </>
        )}
      </Fetched>
    </div>
  )
}
