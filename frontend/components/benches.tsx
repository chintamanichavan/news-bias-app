'use client'

// The Strategy Lab benches: shared types and the full-fidelity views used
// by the /strategy page (each bench full-width, on its own) and summarized
// on the Signals home.

import { HBarList, Section, TimeSeriesChart } from '@/components/quantviz'

export interface Position {
  symbol: string; qty: number; entry_price: number; entry_at?: string
  entry_composite?: number | null; last: number | null
  market_value: number; unrealized_pnl: number; unrealized_pct: number
}
export interface Trade { at: string; symbol: string; side: string; qty: number; price: number; pnl: number | null; reason: string }
export interface Paper {
  alpha_gate: { cleared: boolean; reason: string; hurdle?: number; t?: number }
  capital: number; equity: number; cash: number; total_return_pct: number
  max_drawdown_pct: number; exposure_pct: number; hit_rate: number | null
  var_1d_95_pct: number; var_1d_95_usd: number
  var_method?: string
  hrp_alternative?: Record<string, number> | null
  class_exposures: Record<string, number>
  positions: Position[]; equity_curve: { taken_at: string; equity: number; cash: number }[]
  recent_trades: Trade[]
  risk_limits: { target_vol: number; max_weight: number; stop_loss: number; kill_switch_drawdown: number; slippage_bps: number; commission: number; price_band?: [number, number] }
}
export interface Sim {
  error?: string
  symbol: string; days_simulated: number; exposure_pct: number; signal_window_days: number
  signal_days_available: number
  strategy: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  buy_and_hold: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  curve: { date: string; strategy: number; hold: number }[]
  note: string
}
export interface Bakeoff {
  error?: string
  labeled_posts: number
  class_balance?: { bullish: number; bearish: number }
  cv_folds?: number
  results: { model: string; accuracy: number | null; kind: string }[]
  note: string
}
export interface Alpha {
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
export interface BacktestFold { fold: number; chosen_window: number; train_sharpe: number; oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null } }
export interface Backtest {
  error?: string
  universe: string[]; common_days: number; cost_per_side_bps: number; top_k: number
  folds: BacktestFold[]
  oos_combined: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
  benchmark_oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
  deflated_sharpe?: { sharpe: number | null; dsr: number | null; sr_benchmark: number | null; trials?: number; skew?: number; kurtosis?: number; n?: number }
  pbo?: { pbo: number | null; combinations?: number }
  caveats?: string[]
  note: string
}
export interface Health {
  overall: string
  components: { component: string; age_min: number | null; status: string }[]
  counts: Record<string, number | null>
  outliers: { entity: string; flag: string }[]
  db_bytes?: number | null
}
export interface Experiment { at: string; kind: string; params: Record<string, unknown>; metrics: Record<string, unknown> }

export function pnlTone(v: number): string {
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

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-lg font-bold tabular-nums ${tone ?? ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground tabular-nums">{sub}</div>}
    </div>
  )
}

// ── Paper book ───────────────────────────────────────────────────────────────

export function PaperCompact({ p }: { p: Paper }) {
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

export function PaperExpanded({ p }: { p: Paper }) {
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
        <Stat label="1-day VaR 95%" value={`$${p.var_1d_95_usd.toLocaleString()}`}
          sub={p.var_method ?? `${p.var_1d_95_pct}% of equity`} />
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
        {p.hrp_alternative && (
          <p className="mt-3 text-[11.5px] text-muted-foreground tabular-nums">
            <span className="uppercase tracking-wider text-[9.5px] font-semibold mr-1.5">HRP alternative</span>
            López de Prado&rsquo;s risk-only allocation over the same book:{' '}
            {Object.entries(p.hrp_alternative).map(([s, w]) => `${s} ${(w * 100).toFixed(0)}%`).join(' · ')}
          </p>
        )}
      </Section>
    </div>
  )
}

// ── Simulation ───────────────────────────────────────────────────────────────

export function SimCurves({ sim, W, H }: { sim: Sim; W: number; H: number }) {
  const all = sim.curve.flatMap(c => [c.strategy, c.hold])
  const s = scale(all, W, H)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <Line points={sim.curve.map((c, i) => ({ x: s.x(i, sim.curve.length), y: s.y(c.hold) }))} cls="stroke-muted-foreground/50" />
      <Line points={sim.curve.map((c, i) => ({ x: s.x(i, sim.curve.length), y: s.y(c.strategy) }))} cls="stroke-emerald-500" />
    </svg>
  )
}

