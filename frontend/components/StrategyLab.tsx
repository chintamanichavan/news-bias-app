'use client'

// Strategy Lab — where the signals face consequences. Three benches:
// 1. Paper book: live PnL with risk management (stops, caps, kill-switch)
// 2. Simulation: the news signal backtested on real price history
// 3. Research: deep-learning bakeoff on labeled social data

import { useState } from 'react'
import { useResource } from '@/lib/useResource'

interface Position {
  symbol: string; qty: number; entry_price: number; last: number | null
  market_value: number; unrealized_pnl: number; unrealized_pct: number
}
interface Trade { at: string; symbol: string; side: string; qty: number; price: number; pnl: number | null; reason: string }
interface Paper {
  capital: number; equity: number; cash: number; total_return_pct: number
  max_drawdown_pct: number; exposure_pct: number; hit_rate: number | null
  var_1d_95_pct: number; var_1d_95_usd: number
  class_exposures: Record<string, number>
  positions: Position[]; equity_curve: { taken_at: string; equity: number }[]
  recent_trades: Trade[]
  risk_limits: { target_vol: number; max_weight: number; stop_loss: number; kill_switch_drawdown: number; slippage_bps: number; commission: number }
}

interface Alpha {
  error?: string
  symbols_in_panel: string[]
  rank_ic_1d: { mean: number | null; t_stat: number | null; hit_rate?: number; days: number }
  ic_decay: Record<string, number | null>
  tercile_spread_annualized_pct: number | null
  avg_daily_turnover: number | null
  snapshot_study: string
  verdict: string
}

interface BacktestFold { fold: number; chosen_window: number; train_sharpe: number; oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null } }
interface Backtest {
  error?: string
  universe: string[]; common_days: number; cost_per_side_bps: number; top_k: number
  folds: BacktestFold[]
  oos_combined: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
  benchmark_oos: { total_return_pct: number | null; sharpe: number | null; max_drawdown_pct: number | null }
}

interface Health {
  overall: string
  components: { component: string; age_min: number | null; status: string }[]
  counts: Record<string, number | null>
  outliers: { entity: string; flag: string }[]
}
interface Sim {
  error?: string
  symbol: string; days_simulated: number; exposure_pct: number
  strategy: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  buy_and_hold: { total_return_pct: number; sharpe: number | null; max_drawdown_pct: number }
  curve: { date: string; strategy: number; hold: number }[]
  note: string
}
interface Bakeoff {
  error?: string
  labeled_posts: number
  results: { model: string; accuracy: number | null; kind: string }[]
  note: string
}

function pnlTone(v: number): string {
  if (v > 0) return 'text-emerald-600 dark:text-emerald-400'
  if (v < 0) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function Line({ points, cls }: { points: { x: number; y: number }[]; cls: string }) {
  if (points.length < 2) return null
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return <path d={d} fill="none" strokeWidth={1.5} strokeLinecap="round" className={cls} />
}

export default function StrategyLab() {
  const { data: paper } = useResource<Paper>('/api/paper')
  const [simSymbol, setSimSymbol] = useState('SPY')
  const { data: sim } = useResource<Sim>(`/api/simulate?symbol=${simSymbol}&days=120`)
  const { data: bake } = useResource<Bakeoff>('/api/research/bakeoff')
  const { data: alphaD } = useResource<Alpha>('/api/alpha?days=120')
  const { data: bt } = useResource<Backtest>('/api/backtest?days=150')
  const { data: health } = useResource<Health>('/api/health/pipeline')

  const W = 260, H = 64

  // Paper equity curve scaled to its own min/max
  const curve = paper?.equity_curve ?? []
  let paperPts: { x: number; y: number }[] = []
  if (curve.length >= 2) {
    const vals = curve.map(c => c.equity)
    const lo = Math.min(...vals), hi = Math.max(...vals)
    const span = hi - lo || 1
    paperPts = curve.map((c, i) => ({
      x: (i / (curve.length - 1)) * W,
      y: H - 4 - ((c.equity - lo) / span) * (H - 8),
    }))
  }

  // Simulation: strategy vs hold, common scale
  const simCurve = sim?.curve ?? []
  let stratPts: { x: number; y: number }[] = []
  let holdPts: { x: number; y: number }[] = []
  if (simCurve.length >= 2) {
    const all = simCurve.flatMap(c => [c.strategy, c.hold])
    const lo = Math.min(...all), hi = Math.max(...all)
    const span = hi - lo || 1
    const px = (i: number) => (i / (simCurve.length - 1)) * W
    const py = (v: number) => H - 4 - ((v - lo) / span) * (H - 8)
    stratPts = simCurve.map((c, i) => ({ x: px(i), y: py(c.strategy) }))
    holdPts = simCurve.map((c, i) => ({ x: px(i), y: py(c.hold) }))
  }

  return (
    <section className="mt-12">
      <p className="news-section-label mb-4">Strategy Lab</p>
      <div className="grid lg:grid-cols-3 gap-4 items-start">

        {/* ── PnL: the paper book ─────────────────────────────────────── */}
        <div className="news-card p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Paper book · PnL</p>
            {paper && (
              <span className={`text-sm font-bold tabular-nums ${pnlTone(paper.total_return_pct)}`}>
                {paper.total_return_pct > 0 ? '+' : ''}{paper.total_return_pct.toFixed(2)}%
              </span>
            )}
          </div>
          {!paper ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p> : (
            <>
              <div className="mt-1 text-2xl font-bold tabular-nums">
                ${paper.equity.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-1">
                <Line points={paperPts} cls={paper.total_return_pct >= 0 ? 'stroke-emerald-500' : 'stroke-red-500'} />
              </svg>
              <div className="grid grid-cols-3 gap-2 text-[11px] text-muted-foreground tabular-nums mt-1">
                <span>exposure {paper.exposure_pct}%</span>
                <span>max DD {paper.max_drawdown_pct}%</span>
                <span>hit rate {paper.hit_rate != null ? `${Math.round(paper.hit_rate * 100)}%` : '—'}</span>
              </div>
              {paper.positions.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {paper.positions.map(p => (
                    <div key={p.symbol} className="flex items-center gap-2 text-[12px] tabular-nums">
                      <span className="w-12 font-semibold">{p.symbol}</span>
                      <span className="flex-1 text-muted-foreground">{p.qty} @ ${p.entry_price.toFixed(2)}</span>
                      <span className={`font-semibold ${pnlTone(p.unrealized_pnl)}`}>
                        {p.unrealized_pnl >= 0 ? '+' : ''}{p.unrealized_pnl.toFixed(0)} ({p.unrealized_pct >= 0 ? '+' : ''}{p.unrealized_pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-[12px] text-muted-foreground">In cash — waiting for entry signals.</p>
              )}
              <div className="mt-3 pt-2 border-t border-border/60 text-[11px] text-muted-foreground tabular-nums">
                1-day VaR (95%): <span className="font-semibold text-foreground">${paper.var_1d_95_usd.toLocaleString()} ({paper.var_1d_95_pct}%)</span>
                {Object.keys(paper.class_exposures).length > 0 && (
                  <> · {Object.entries(paper.class_exposures).map(([c, w]) => `${c} ${(w * 100).toFixed(0)}%`).join(' · ')}</>
                )}
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground/80 leading-relaxed">
                Sizing: signal/vol weights, {Math.round(paper.risk_limits.target_vol * 100)}% vol target, {Math.round(paper.risk_limits.max_weight * 100)}%/name cap, class caps ·{' '}
                {Math.round(paper.risk_limits.stop_loss * 100)}% stop · kill-switch at {Math.round(paper.risk_limits.kill_switch_drawdown * 100)}% DD ·
                fills via paper broker ({paper.risk_limits.slippage_bps} bps slip + ${paper.risk_limits.commission}/order).
              </p>
            </>
          )}
        </div>

        {/* ── Simulation ──────────────────────────────────────────────── */}
        <div className="news-card p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Simulation · news signal</p>
            <select value={simSymbol} onChange={e => setSimSymbol(e.target.value)}
              className="text-[11px] bg-transparent text-muted-foreground outline-none" aria-label="Simulation symbol">
              {['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC-USD'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {!sim ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            : sim.error ? <p className="mt-3 text-sm text-muted-foreground">{sim.error}</p> : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-2">
                <Line points={holdPts} cls="stroke-muted-foreground/50" />
                <Line points={stratPts} cls="stroke-emerald-500" />
              </svg>
              <div className="flex gap-4 text-[10px] text-muted-foreground mt-0.5">
                <span><span className="inline-block w-3 h-[2px] bg-emerald-500 align-middle mr-1" />signal-timed</span>
                <span><span className="inline-block w-3 h-[2px] bg-muted-foreground/50 align-middle mr-1" />buy &amp; hold</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                <div><div className="text-muted-foreground">return</div>
                  <div className={`font-semibold ${pnlTone(sim.strategy.total_return_pct)}`}>{sim.strategy.total_return_pct}%</div>
                  <div className="text-muted-foreground/70">{sim.buy_and_hold.total_return_pct}% hold</div></div>
                <div><div className="text-muted-foreground">sharpe</div>
                  <div className="font-semibold">{sim.strategy.sharpe ?? '—'}</div>
                  <div className="text-muted-foreground/70">{sim.buy_and_hold.sharpe ?? '—'} hold</div></div>
                <div><div className="text-muted-foreground">max DD</div>
                  <div className="font-semibold">{sim.strategy.max_drawdown_pct}%</div>
                  <div className="text-muted-foreground/70">{sim.buy_and_hold.max_drawdown_pct}% hold</div></div>
              </div>
              <p className="mt-3 pt-2 border-t border-border/60 text-[10px] text-muted-foreground/80 leading-relaxed">
                {sim.days_simulated} trading days · in market {sim.exposure_pct}% of days · day-t signal trades day t+1 (no lookahead).
              </p>
            </>
          )}
        </div>

        {/* ── Research bench ──────────────────────────────────────────── */}
        <div className="news-card p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Research · model bakeoff</p>
          {!bake ? <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
            : bake.error ? <p className="mt-3 text-sm text-muted-foreground">{bake.error}</p> : (
            <>
              <p className="mt-1 text-[12px] text-muted-foreground tabular-nums">
                {bake.labeled_posts} Stocktwits-labeled posts · cross-validated
              </p>
              <div className="mt-3 space-y-2">
                {bake.results.map(r => (
                  <div key={r.model}>
                    <div className="flex items-baseline justify-between text-[12px]">
                      <span className={r.kind === 'deep' ? 'font-semibold' : ''}>{r.model}</span>
                      <span className="font-semibold tabular-nums">{r.accuracy != null ? `${(r.accuracy * 100).toFixed(1)}%` : '—'}</span>
                    </div>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div className={`h-full ${r.kind === 'deep' ? 'bg-violet-500' : r.kind === 'baseline' ? 'bg-muted-foreground/40' : 'bg-foreground/60'}`}
                        style={{ width: `${(r.accuracy ?? 0) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-3 pt-2 border-t border-border/60 text-[10px] text-muted-foreground/80 leading-relaxed">{bake.note}</p>
            </>
          )}
        </div>
      </div>

      {/* Row 2: alpha discovery · walk-forward backtest · pipeline health */}
      <div className="grid lg:grid-cols-3 gap-4 items-start mt-4">

        {/* ── Alpha discovery ─────────────────────────────────────────── */}
        <div className="news-card p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Alpha discovery · rank IC</p>
          {!alphaD ? <p className="mt-3 text-sm text-muted-foreground">Studying…</p>
            : alphaD.error ? <p className="mt-3 text-sm text-muted-foreground">{alphaD.error}</p> : (
            <>
              <div className="mt-2 flex items-baseline gap-4 tabular-nums">
                <div>
                  <div className="text-2xl font-bold">{alphaD.rank_ic_1d.mean != null ? alphaD.rank_ic_1d.mean.toFixed(3) : '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">mean IC (1d)</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{alphaD.rank_ic_1d.t_stat ?? '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">t-stat · {alphaD.rank_ic_1d.days}d</div>
                </div>
                <div>
                  <div className="text-lg font-semibold">{alphaD.tercile_spread_annualized_pct != null ? `${alphaD.tercile_spread_annualized_pct}%` : '—'}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">tercile spread p.a.</div>
                </div>
              </div>
              <div className="mt-3">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">IC decay by horizon</p>
                <div className="flex items-end gap-2 h-12">
                  {Object.entries(alphaD.ic_decay).map(([h, v]) => (
                    <div key={h} className="flex-1 flex flex-col items-center gap-0.5">
                      <div className={`w-full rounded-sm ${(v ?? 0) >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                        style={{ height: `${Math.min(40, Math.abs(v ?? 0) * 400) + 2}px` }} />
                      <span className="text-[9px] text-muted-foreground tabular-nums">{h}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground tabular-nums">
                {alphaD.symbols_in_panel.length}-name panel · turnover {alphaD.avg_daily_turnover != null ? `${Math.round(alphaD.avg_daily_turnover * 100)}%/d` : '—'}
              </p>
              <p className="mt-2 pt-2 border-t border-border/60 text-[11px] leading-relaxed font-medium">{alphaD.verdict}</p>
              <p className="mt-1 text-[10px] text-muted-foreground/80">{alphaD.snapshot_study}</p>
            </>
          )}
        </div>

        {/* ── Walk-forward backtest ───────────────────────────────────── */}
        <div className="news-card p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Portfolio backtest · walk-forward</p>
          {!bt ? <p className="mt-3 text-sm text-muted-foreground">Running…</p>
            : bt.error ? <p className="mt-3 text-sm text-muted-foreground">{bt.error}</p> : (
            <>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] tabular-nums">
                <div><div className="text-muted-foreground">OOS return</div>
                  <div className={`font-semibold text-sm ${pnlTone(bt.oos_combined.total_return_pct ?? 0)}`}>{bt.oos_combined.total_return_pct ?? '—'}%</div>
                  <div className="text-muted-foreground/70">{bt.benchmark_oos.total_return_pct ?? '—'}% bench</div></div>
                <div><div className="text-muted-foreground">OOS sharpe</div>
                  <div className="font-semibold text-sm">{bt.oos_combined.sharpe ?? '—'}</div>
                  <div className="text-muted-foreground/70">{bt.benchmark_oos.sharpe ?? '—'} bench</div></div>
                <div><div className="text-muted-foreground">OOS max DD</div>
                  <div className="font-semibold text-sm">{bt.oos_combined.max_drawdown_pct ?? '—'}%</div>
                  <div className="text-muted-foreground/70">{bt.benchmark_oos.max_drawdown_pct ?? '—'}% bench</div></div>
              </div>
              <div className="mt-3 space-y-1">
                {bt.folds.map(f => (
                  <div key={f.fold} className="flex items-baseline justify-between text-[11px] tabular-nums">
                    <span className="text-muted-foreground">fold {f.fold} · W={f.chosen_window}d chosen on prior data</span>
                    <span className="font-semibold">{f.oos.total_return_pct ?? '—'}% · shp {f.oos.sharpe ?? '—'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 pt-2 border-t border-border/60 text-[10px] text-muted-foreground/80 leading-relaxed">
                Top-{bt.top_k} by trailing news signal over {bt.universe.length} names, {bt.common_days} common days,
                {' '}{bt.cost_per_side_bps} bps/side costs. Window tuned only on pre-fold data.
              </p>
            </>
          )}
        </div>

        {/* ── Pipeline health ─────────────────────────────────────────── */}
        <div className="news-card p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Pipeline health</p>
            {health && (
              <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                health.overall === 'ok' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                : health.overall === 'stale' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                : 'bg-red-500/15 text-red-700 dark:text-red-300'}`}>
                {health.overall}
              </span>
            )}
          </div>
          {!health ? <p className="mt-3 text-sm text-muted-foreground">Checking…</p> : (
            <>
              <div className="mt-3 space-y-1.5">
                {health.components.map(c => (
                  <div key={c.component} className="flex items-center gap-2 text-[12px]">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      c.status === 'ok' ? 'bg-emerald-500' : c.status === 'stale' ? 'bg-amber-500' : 'bg-red-500'}`} />
                    <span className="flex-1">{c.component}</span>
                    <span className="text-muted-foreground tabular-nums">{c.age_min != null ? `${Math.round(c.age_min)}m ago` : 'never'}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground tabular-nums">
                {health.counts.articles?.toLocaleString()} articles · {health.counts.social_posts_24h} posts/24h ·{' '}
                {health.counts.snapshots} snapshots · {health.counts.experiments} experiments logged
              </p>
              {health.outliers.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Signal outliers</p>
                  {health.outliers.slice(0, 3).map(o => (
                    <p key={o.entity} className="text-[11px] text-muted-foreground tabular-nums">{o.entity}: {o.flag}</p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
