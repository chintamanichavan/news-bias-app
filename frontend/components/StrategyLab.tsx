'use client'

// Strategy Lab — six benches, each a compact summary card whose expanded
// view carries the full information: complete curves, every position and
// trade, DSR/PBO, fold detail, the experiments log.

import { useState } from 'react'
import ExpandableCard from '@/components/ExpandableCard'
import { ChartLegend, HBarList, Section, TimeSeriesChart } from '@/components/quantviz'
import { useResource } from '@/lib/useResource'

interface Position {
  symbol: string; qty: number; entry_price: number; entry_at?: string
  entry_composite?: number | null; last: number | null
  market_value: number; unrealized_pnl: number; unrealized_pct: number
}
interface Trade { at: string; symbol: string; side: string; qty: number; price: number; pnl: number | null; reason: string }
interface Paper {
  alpha_gate: { cleared: boolean; reason: string; hurdle?: number; t?: number }
  capital: number; equity: number; cash: number; total_return_pct: number
  max_drawdown_pct: number; exposure_pct: number; hit_rate: number | null
  var_1d_95_pct: number; var_1d_95_usd: number
  class_exposures: Record<string, number>
  positions: Position[]; equity_curve: { taken_at: string; equity: number; cash: number }[]
  recent_trades: Trade[]
  risk_limits: { target_vol: number; max_weight: number; stop_loss: number; kill_switch_drawdown: number; slippage_bps: number; commission: number; price_band?: [number, number] }
}
interface Sim {
  error?: string
  symbol: string; days_simulated: number; exposure_pct: number; signal_window_days: number
  signal_days_available: number
  strategy: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  buy_and_hold: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  curve: { date: string; strategy: number; hold: number }[]
  note: string
}
interface Bakeoff {
  error?: string
  labeled_posts: number
  class_balance?: { bullish: number; bearish: number }
  cv_folds?: number
  results: { model: string; accuracy: number | null; kind: string }[]
  note: string
}
interface Alpha {
  error?: string
  symbols_in_panel: string[]
  rank_ic_1d: { mean: number | null; t_stat: number | null; hit_rate?: number; days: number }
  ic_decay: Record<string, number | null>
  tercile_spread_annualized_pct: number | null
  avg_daily_turnover: number | null
  snapshot_study: string
  t_hurdle?: number
  verdict: string
}
interface BacktestFold { fold: number; chosen_window: number; train_sharpe: number; oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null } }
interface Backtest {
  error?: string
  universe: string[]; common_days: number; cost_per_side_bps: number; top_k: number
  folds: BacktestFold[]
  oos_combined: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
  benchmark_oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
  deflated_sharpe?: { sharpe: number | null; dsr: number | null; sr_benchmark: number | null; trials?: number; skew?: number; kurtosis?: number; n?: number }
  pbo?: { pbo: number | null; combinations?: number }
  note: string
}
interface Health {
  overall: string
  components: { component: string; age_min: number | null; status: string }[]
  counts: Record<string, number | null>
  outliers: { entity: string; flag: string }[]
  db_bytes?: number | null
}
interface Experiment { at: string; kind: string; params: Record<string, unknown>; metrics: Record<string, unknown> }

function pnlTone(v: number): string {
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (v < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function Line({ points, cls, dash }: { points: { x: number; y: number }[]; cls: string; dash?: string }) {
  if (points.length < 2) return null
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return <path d={d} fill="none" strokeWidth={1.5} strokeLinecap="round" strokeDasharray={dash} className={cls} />
}

function scale(vals: number[], W: number, H: number) {
  const lo = Math.min(...vals), hi = Math.max(...vals)
  const span = hi - lo || 1
  return {
    lo, hi,
    x: (i: number, n: number) => (i / Math.max(1, n - 1)) * W,
    y: (v: number) => H - 6 - ((v - lo) / span) * (H - 14),
  }
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

// ── Paper book ───────────────────────────────────────────────────────────────

function PaperCompact({ p }: { p: Paper }) {
  const curve = p.equity_curve
  const W = 260, H = 64
  const s = curve.length >= 2 ? scale(curve.map(c => c.equity), W, H) : null
  return (
    <>
      <div className="flex items-baseline justify-between">
        <div className="text-2xl font-bold tabular-nums">${p.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        <span className={`text-sm font-bold tabular-nums ${pnlTone(p.total_return_pct)}`}>
          {p.total_return_pct > 0 ? '+' : ''}{p.total_return_pct.toFixed(2)}%
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-1">
        {s && <Line points={curve.map((c, i) => ({ x: s.x(i, curve.length), y: s.y(c.equity) }))}
          cls={p.total_return_pct >= 0 ? 'stroke-emerald-500' : 'stroke-red-500'} />}
      </svg>
      <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground tabular-nums mt-1">
        <span>exposure {p.exposure_pct}%</span>
        <span>VaR {p.var_1d_95_pct}%</span>
        <span>{p.positions.length} positions</span>
      </div>
      <p className={`mt-2 text-[11px] ${p.alpha_gate.cleared ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
        Gate {p.alpha_gate.cleared ? 'open' : 'closed'} — {p.alpha_gate.reason}
      </p>
    </>
  )
}

function PaperExpanded({ p }: { p: Paper }) {
  const curve = p.equity_curve
  // Drawdown-from-peak series: the risk view of the same history
  let peak = -Infinity
  const dd = curve.map(c => {
    peak = Math.max(peak, c.equity)
    return { t: c.taken_at, v: (c.equity / peak - 1) * 100 }
  })
  const exposure = curve.map(c => ({ t: c.taken_at, v: (1 - c.cash / c.equity) * 100 }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Stat label="Equity" value={`$${p.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          sub={`cash $${p.cash.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          tone={pnlTone(p.total_return_pct)} />
        <Stat label="Return" value={`${p.total_return_pct > 0 ? '+' : ''}${p.total_return_pct.toFixed(2)}%`} tone={pnlTone(p.total_return_pct)} sub={`max DD ${p.max_drawdown_pct}%`} />
        <Stat label="1-day VaR 95%" value={`$${p.var_1d_95_usd.toLocaleString()}`} sub={`${p.var_1d_95_pct}% of equity`} />
        <Stat label="Hit rate" value={p.hit_rate != null ? `${Math.round(p.hit_rate * 100)}%` : '—'} sub="closed trades" />
        <Stat label="Exposure" value={`${p.exposure_pct}%`} sub={`gate ${p.alpha_gate.cleared ? 'open' : 'closed'}`} />
      </div>

      <Section title="Equity · every 15-minute mark">
        {curve.length >= 2 ? (
          <TimeSeriesChart
            series={[{ label: 'equity', points: curve.map(c => ({ t: c.taken_at, v: c.equity })),
                       cls: p.total_return_pct >= 0 ? 'stroke-emerald-500' : 'stroke-red-500',
                       fill: p.total_return_pct >= 0 ? 'fill-emerald-500/10' : 'fill-red-500/10' }]}
            H={190} yFmt={v => `$${(v / 1000).toFixed(1)}k`} />
        ) : <p className="text-[12px] text-muted-foreground">Fresh book — the curve begins with the next engine cycle.</p>}
      </Section>

      {curve.length >= 2 && (
        <div className="grid sm:grid-cols-2 gap-6">
          <Section title="Drawdown from peak">
            <TimeSeriesChart series={[{ label: 'drawdown', points: dd, cls: 'stroke-red-500', fill: 'fill-red-500/10' }]}
              H={110} unit="%" zeroLine />
          </Section>
          <Section title="Capital deployed">
            <TimeSeriesChart series={[{ label: 'exposure', points: exposure, cls: 'stroke-indigo-500', fill: 'fill-indigo-500/10' }]}
              H={110} unit="%" zeroLine />
          </Section>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-8">
        <Section title={`Open positions · ${p.positions.length}`}>
          {p.positions.length === 0
            ? <p className="text-[13px] text-muted-foreground">In cash — {p.alpha_gate.reason}.</p>
            : <HBarList
                max={p.equity}
                items={p.positions.map(pos => ({
                  label: pos.symbol,
                  sub: `${pos.qty} @ $${pos.entry_price.toFixed(2)}${pos.entry_composite != null ? ` · sig ${pos.entry_composite > 0 ? '+' : ''}${pos.entry_composite}` : ''}`,
                  value: Math.round(pos.market_value),
                  href: `/lab?symbol=${pos.symbol}`,
                }))} unit="" />}
          {p.positions.length > 0 && Object.keys(p.class_exposures).length > 0 && (
            <div className="mt-4">
              <div className="flex h-2 rounded-full overflow-hidden bg-muted">
                {Object.entries(p.class_exposures).map(([c, w], i) => (
                  <div key={c} title={`${c} ${(w * 100).toFixed(0)}%`}
                    className={['bg-emerald-600/80', 'bg-indigo-500/70', 'bg-amber-500/70', 'bg-rose-500/60'][i % 4]}
                    style={{ width: `${w * 100}%` }} />
                ))}
              </div>
              <p className="mt-1 text-[10.5px] text-muted-foreground tabular-nums">
                {Object.entries(p.class_exposures).map(([c, w]) => `${c} ${(w * 100).toFixed(0)}%`).join(' · ')} · rest cash
              </p>
            </div>
          )}
        </Section>

        <Section title="Trade log">
          <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
            {p.recent_trades.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] tabular-nums py-0.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.side === 'buy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className="text-muted-foreground w-20 shrink-0">{t.at?.slice(5, 16).replace('T', ' ')}</span>
                <a href={`/lab?symbol=${t.symbol}`} className="w-16 font-semibold hover:underline shrink-0">{t.symbol}</a>
                <span className="flex-1 text-muted-foreground truncate">{t.side} · {t.reason}</span>
                {t.pnl != null && <span className={`font-semibold shrink-0 ${pnlTone(t.pnl)}`}>{t.pnl > 0 ? '+' : ''}{t.pnl}</span>}
              </div>
            ))}
            {p.recent_trades.length === 0 && <p className="text-[13px] text-muted-foreground">No trades under the current policy yet.</p>}
          </div>
        </Section>
      </div>

      <Section title="Policy in force">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 text-[12px] tabular-nums">
          <span><span className="text-muted-foreground">Alpha gate</span> · {p.alpha_gate.cleared ? 'open' : `closed (t=${p.alpha_gate.t ?? '—'} vs ${p.alpha_gate.hurdle ?? '—'})`}</span>
          <span><span className="text-muted-foreground">Price band</span> · ${p.risk_limits.price_band?.[0] ?? 1}–${p.risk_limits.price_band?.[1] ?? 10}</span>
          <span><span className="text-muted-foreground">Vol target</span> · {Math.round(p.risk_limits.target_vol * 100)}% · {Math.round(p.risk_limits.max_weight * 100)}%/name</span>
          <span><span className="text-muted-foreground">Stop</span> · {Math.round(p.risk_limits.stop_loss * 100)}% · kill-switch {Math.round(p.risk_limits.kill_switch_drawdown * 100)}% DD</span>
          <span><span className="text-muted-foreground">Frictions</span> · {p.risk_limits.slippage_bps} bps + ${p.risk_limits.commission}/order</span>
          <span><span className="text-muted-foreground">Capital</span> · $100k paper, delayed quotes</span>
        </div>
      </Section>
    </div>
  )
}

// ── Simulation ───────────────────────────────────────────────────────────────

function SimCurves({ sim, W, H }: { sim: Sim; W: number; H: number }) {
  const all = sim.curve.flatMap(c => [c.strategy, c.hold])
  const s = scale(all, W, H)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <Line points={sim.curve.map((c, i) => ({ x: s.x(i, sim.curve.length), y: s.y(c.hold) }))} cls="stroke-muted-foreground/50" />
      <Line points={sim.curve.map((c, i) => ({ x: s.x(i, sim.curve.length), y: s.y(c.strategy) }))} cls="stroke-emerald-500" />
    </svg>
  )
}

// ── Section ─────────────────────────────────────────────────────────────────

export default function StrategyLab() {
  const { data: paper } = useResource<Paper>('/api/paper')
  const [simSymbol, setSimSymbol] = useState('SPY')
  const { data: sim } = useResource<Sim>(`/api/simulate?symbol=${simSymbol}&days=120`)
  const { data: bake } = useResource<Bakeoff>('/api/research/bakeoff')
  const { data: alphaD } = useResource<Alpha>('/api/alpha?days=120')
  const { data: bt } = useResource<Backtest>('/api/backtest?days=150')
  const { data: health } = useResource<Health>('/api/health/pipeline')
  const { data: exps } = useResource<{ experiments: Experiment[] }>('/api/experiments?limit=15')

  return (
    <section className="mt-12">
      <p className="news-section-label mb-4">Strategy Lab</p>
      <div className="grid lg:grid-cols-3 gap-4 items-start">

        {/* Paper book */}
        <ExpandableCard title="Paper book · PnL" expandedTitle="Paper book — full accounting"
          expanded={paper ? <PaperExpanded p={paper} /> : <p className="text-sm text-muted-foreground">Loading…</p>}>
          {!paper ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p> : <PaperCompact p={paper} />}
        </ExpandableCard>

        {/* Simulation */}
        <ExpandableCard title="Simulation · news signal" expandedTitle={`Simulation — ${simSymbol} vs buy & hold`}
          aside={
            <select value={simSymbol} onChange={e => setSimSymbol(e.target.value)}
              className="text-[11px] bg-transparent text-muted-foreground outline-none" aria-label="Simulation symbol">
              {['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC-USD'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>}
          expanded={!sim || sim.error ? <p className="text-sm text-muted-foreground">{sim?.error ?? 'Loading…'}</p> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Strategy return" value={`${sim.strategy.total_return_pct}%`} tone={pnlTone(sim.strategy.total_return_pct)} sub={`${sim.buy_and_hold.total_return_pct}% hold`} />
                <Stat label="Sharpe" value={`${sim.strategy.sharpe ?? '—'}`} sub={`${sim.buy_and_hold.sharpe ?? '—'} hold`} />
                <Stat label="Max drawdown" value={`${sim.strategy.max_drawdown_pct}%`} sub={`${sim.buy_and_hold.max_drawdown_pct}% hold`} />
                <Stat label="In market" value={`${sim.exposure_pct}%`} sub={`${sim.days_simulated} days · W=${sim.signal_window_days}d`} />
              </div>
              <Section title={`Growth of 1 · ${sim.symbol}`}>
                <TimeSeriesChart
                  series={[
                    { label: 'signal-timed', points: sim.curve.map(c => ({ t: c.date, v: c.strategy })), cls: 'stroke-emerald-500', fill: 'fill-emerald-500/10' },
                    { label: 'buy & hold', points: sim.curve.map(c => ({ t: c.date, v: c.hold })), cls: 'stroke-muted-foreground/70', dash: '4 3' },
                  ]}
                  H={220} yFmt={v => v.toFixed(2)} />
                <ChartLegend items={[
                  { label: 'signal-timed', cls: 'stroke-emerald-500' },
                  { label: 'buy & hold', cls: 'stroke-muted-foreground', dash: true },
                ]} />
              </Section>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{sim.note} Signal history: {sim.signal_days_available} scored days.</p>
            </div>)}>
          {!sim ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            : sim.error ? <p className="mt-2 text-sm text-muted-foreground">{sim.error}</p> : (
            <>
              <SimCurves sim={sim} W={260} H={72} />
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                <span className={pnlTone(sim.strategy.total_return_pct)}>{sim.strategy.total_return_pct}%</span>
                <span>shp {sim.strategy.sharpe ?? '—'}</span>
                <span className="text-muted-foreground">{sim.buy_and_hold.total_return_pct}% hold</span>
              </div>
            </>)}
        </ExpandableCard>

        {/* Bakeoff */}
        <ExpandableCard title="Research · model bakeoff" expandedTitle="Model bakeoff — full comparison"
          expanded={!bake || bake.error ? <p className="text-sm text-muted-foreground">{bake?.error ?? 'Loading…'}</p> : (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Labeled posts" value={`${bake.labeled_posts}`} sub="Stocktwits bull/bear" />
                <Stat label="Class balance" value={bake.class_balance ? `${Math.round(bake.class_balance.bullish * 100)}/${Math.round(bake.class_balance.bearish * 100)}` : '—'} sub="bull / bear" />
                <Stat label="CV folds" value={`${bake.cv_folds ?? '—'}`} />
              </div>
              <div className="space-y-3">
                {bake.results.map(r => (
                  <div key={r.model}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className={r.kind === 'deep' ? 'font-semibold' : ''}>{r.model}</span>
                      <span className="font-semibold tabular-nums">{r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : '—'}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${r.kind === 'deep' ? 'bg-violet-500' : r.kind === 'baseline' ? 'bg-muted-foreground/40' : 'bg-foreground/60'}`}
                        style={{ width: `${(r.accuracy ?? 0) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{bake.note}</p>
            </div>)}>
          {!bake ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
            : bake.error ? <p className="mt-2 text-sm text-muted-foreground">{bake.error}</p> : (
            <div className="mt-1 space-y-2">
              {bake.results.map(r => (
                <div key={r.model} className="flex items-baseline justify-between text-[12px]">
                  <span className={`truncate ${r.kind === 'deep' ? 'font-semibold' : ''}`}>{r.model}</span>
                  <span className="font-semibold tabular-nums ml-2">{r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : '—'}</span>
                </div>
              ))}
            </div>)}
        </ExpandableCard>

        {/* Alpha discovery */}
        <ExpandableCard title="Alpha discovery · rank IC" expandedTitle="Alpha discovery — full study"
          expanded={!alphaD || alphaD.error ? <p className="text-sm text-muted-foreground">{alphaD?.error ?? 'Studying…'}</p> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Mean IC (1d)" value={alphaD.rank_ic_1d.mean != null ? alphaD.rank_ic_1d.mean.toFixed(3) : '—'}
                  sub={`hit ${alphaD.rank_ic_1d.hit_rate != null ? Math.round(alphaD.rank_ic_1d.hit_rate * 100) + '%' : '—'} · ${alphaD.rank_ic_1d.days} days`} />
                <Stat label="t-stat" value={`${alphaD.rank_ic_1d.t_stat ?? '—'}`} sub={`hurdle ${alphaD.t_hurdle ?? '2.0'} (trials-adjusted)`} />
                <Stat label="Tercile spread" value={alphaD.tercile_spread_annualized_pct != null ? `${alphaD.tercile_spread_annualized_pct}% p.a.` : '—'} />
                <Stat label="Turnover" value={alphaD.avg_daily_turnover != null ? `${Math.round(alphaD.avg_daily_turnover * 100)}%/d` : '—'} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">IC by horizon</p>
                <div className="flex items-end gap-3 h-24">
                  {Object.entries(alphaD.ic_decay).map(([h, v]) => (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-[10px] tabular-nums">{v != null ? v.toFixed(3) : '—'}</span>
                      <div className={`w-full rounded-sm ${(v ?? 0) >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                        style={{ height: `${Math.min(70, Math.abs(v ?? 0) * 600) + 2}px` }} />
                      <span className="text-[10px] text-muted-foreground">{h}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Panel · {alphaD.symbols_in_panel.length} names</p>
                <div className="flex flex-wrap gap-1.5">
                  {alphaD.symbols_in_panel.map(s => (
                    <a key={s} href={`/lab?symbol=${s}`}
                      className="text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground">{s}</a>
                  ))}
                </div>
              </div>
              <p className="text-[13px] font-medium">{alphaD.verdict}</p>
              <p className="text-[11px] text-muted-foreground">{alphaD.snapshot_study}</p>
            </div>)}>
          {!alphaD ? <p className="mt-2 text-sm text-muted-foreground">Studying…</p>
            : alphaD.error ? <p className="mt-2 text-sm text-muted-foreground">{alphaD.error}</p> : (
            <>
              <div className="mt-1 flex items-baseline gap-4 tabular-nums">
                <div>
                  <div className="text-2xl font-bold">{alphaD.rank_ic_1d.mean != null ? alphaD.rank_ic_1d.mean.toFixed(3) : '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">mean IC</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{alphaD.rank_ic_1d.t_stat ?? '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">t · hurdle {alphaD.t_hurdle ?? 2}</div>
                </div>
              </div>
              <p className="mt-2 text-[11.5px] leading-snug font-medium">{alphaD.verdict}</p>
            </>)}
        </ExpandableCard>

        {/* Walk-forward backtest */}
        <ExpandableCard title="Portfolio backtest · walk-forward" expandedTitle="Walk-forward backtest — validation detail"
          expanded={!bt || bt.error ? <p className="text-sm text-muted-foreground">{bt?.error ?? 'Running…'}</p> : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="OOS return" value={`${bt.oos_combined.total_return_pct ?? '—'}%`} tone={pnlTone(bt.oos_combined.total_return_pct ?? 0)} sub={`${bt.benchmark_oos.total_return_pct ?? '—'}% benchmark`} />
                <Stat label="OOS Sharpe" value={`${bt.oos_combined.sharpe ?? '—'}`} sub={`${bt.benchmark_oos.sharpe ?? '—'} benchmark`} />
                <Stat label="Deflated Sharpe" value={bt.deflated_sharpe?.dsr != null ? bt.deflated_sharpe.dsr.toFixed(2) : '—'}
                  sub={`P(true SR>0) after ${bt.deflated_sharpe?.trials ?? '—'} trials`} />
                <Stat label="PBO" value={bt.pbo?.pbo != null ? bt.pbo.pbo.toFixed(2) : '—'} sub={`CSCV · ${bt.pbo?.combinations ?? 0} splits`} />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Folds — window chosen only on prior data</p>
                {bt.folds.map(f => (
                  <div key={f.fold} className="flex items-baseline justify-between text-[12.5px] tabular-nums py-1 border-b border-border/40 last:border-0">
                    <span>fold {f.fold} · W={f.chosen_window}d · train Sharpe {f.train_sharpe}</span>
                    <span className="font-semibold">{f.oos.total_return_pct ?? '—'}% · shp {f.oos.sharpe ?? '—'} · DD {f.oos.max_drawdown_pct ?? '—'}%</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Universe · {bt.universe.length} names · {bt.cost_per_side_bps} bps/side</p>
                <div className="flex flex-wrap gap-1.5">
                  {bt.universe.map(s => (
                    <a key={s} href={`/lab?symbol=${s}`}
                      className="text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-muted text-muted-foreground hover:text-foreground">{s}</a>
                  ))}
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed">{bt.note}</p>
            </div>)}>
          {!bt ? <p className="mt-2 text-sm text-muted-foreground">Running…</p>
            : bt.error ? <p className="mt-2 text-sm text-muted-foreground">{bt.error}</p> : (
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] tabular-nums">
              <span>OOS <span className={`font-semibold ${pnlTone(bt.oos_combined.total_return_pct ?? 0)}`}>{bt.oos_combined.total_return_pct ?? '—'}%</span></span>
              <span>bench {bt.benchmark_oos.total_return_pct ?? '—'}%</span>
              <span>DSR <span className="font-semibold">{bt.deflated_sharpe?.dsr?.toFixed(2) ?? '—'}</span></span>
              <span>PBO <span className="font-semibold">{bt.pbo?.pbo?.toFixed(2) ?? '—'}</span></span>
            </div>)}
        </ExpandableCard>

        {/* Pipeline health */}
        <ExpandableCard title="Pipeline health" expandedTitle="Pipeline health — components, counts, experiments"
          aside={health && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
              health.overall === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : health.overall === 'stale' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
              : 'bg-red-500/15 text-red-700 dark:text-red-300'}`}>{health.overall}</span>)}
          expanded={!health ? <p className="text-sm text-muted-foreground">Checking…</p> : (
            <div className="space-y-5">
              <div className="space-y-1.5">
                {health.components.map(c => (
                  <div key={c.component} className="flex items-center gap-2 text-[13px]">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'ok' ? 'bg-emerald-500' : c.status === 'stale' ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="flex-1">{c.component}</span>
                    <span className="text-muted-foreground tabular-nums">{c.age_min != null ? `${Math.round(c.age_min)}m ago` : 'never'}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(health.counts).map(([k, v]) => (
                  <Stat key={k} label={k.replace(/_/g, ' ')} value={v != null ? v.toLocaleString() : '—'} />
                ))}
              </div>
              {health.outliers.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Signal outliers (24h)</p>
                  {health.outliers.map(o => (
                    <p key={o.entity} className="text-[12px] tabular-nums">{o.entity}: {o.flag}</p>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Experiments log — every study is a trial</p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                  {(exps?.experiments ?? []).map((e, i) => (
                    <div key={i} className="text-[12px] tabular-nums flex gap-2">
                      <span className="text-muted-foreground w-24 shrink-0">{e.at?.slice(5, 16)}</span>
                      <span className="w-24 font-semibold shrink-0">{e.kind}</span>
                      <span className="flex-1 text-muted-foreground truncate">{JSON.stringify(e.metrics)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>)}>
          {!health ? <p className="mt-2 text-sm text-muted-foreground">Checking…</p> : (
            <>
              <div className="mt-1 space-y-1">
                {health.components.map(c => (
                  <div key={c.component} className="flex items-center gap-2 text-[12px]">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'ok' ? 'bg-emerald-500' : c.status === 'stale' ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="flex-1">{c.component}</span>
                    <span className="text-muted-foreground tabular-nums">{c.age_min != null ? `${Math.round(c.age_min)}m` : '—'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {health.counts.snapshots} snapshots · {health.counts.experiments} experiments
              </p>
            </>)}
        </ExpandableCard>
      </div>
    </section>
  )
}
