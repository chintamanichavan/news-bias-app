'use client'

// The Strategy Lab as its own segment: six benches, each full-width with the
// complete information — curves with axes, every position and trade, DSR and
// PBO, fold detail, the experiments log. The Signals home carries only a
// summary strip pointing here.

import { useState } from 'react'
import {
  type Alpha, type Backtest, type Bakeoff, type Experiment, type Health,
  type Paper, type Sim, PaperExpanded, Stat, pnlTone,
} from '@/components/benches'
import MandateStrip from '@/components/MandateStrip'
import { ChartLegend, HBarList, Section, TimeSeriesChart } from '@/components/quantviz'
import { useResource } from '@/lib/useResource'

function Bench({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="news-card p-6 sm:p-8 scroll-mt-20">
      <p className="news-section-label mb-5">{title}</p>
      {children}
    </section>
  )
}

export default function StrategyPage() {
  const { data: paper } = useResource<Paper>('/api/paper')
  const [simSymbol, setSimSymbol] = useState('SPY')
  const { data: sim } = useResource<Sim>(`/api/simulate?symbol=${simSymbol}&days=120`)
  const { data: bake } = useResource<Bakeoff>('/api/research/bakeoff')
  const { data: alphaD } = useResource<Alpha>('/api/alpha?days=120')
  const { data: bt } = useResource<Backtest>('/api/backtest?days=150')
  const { data: health } = useResource<Health>('/api/health/pipeline')
  const { data: exps } = useResource<{ experiments: Experiment[] }>('/api/experiments?limit=20')

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <p className="news-section-label">Rich tier · short horizon · where signals face consequences</p>
      <h1 className="mt-1 font-serif text-4xl sm:text-5xl font-bold tracking-tight leading-none">Strategy Lab</h1>
      <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-[66ch]">
        Six benches: the paper book under full risk policy, single-asset simulation,
        alpha discovery with its trials-adjusted bar, the walk-forward backtest with its
        overfitting guards, the model bakeoff, and the pipeline watching itself.
      </p>

      <MandateStrip active="rich" />

      {/* Section anchors */}
      <nav className="mt-5 mb-8 flex flex-wrap gap-1.5">
        {[['book', 'Paper book'], ['simulation', 'Simulation'], ['alpha', 'Alpha discovery'],
          ['backtest', 'Backtest'], ['bakeoff', 'Model bakeoff'], ['health', 'Pipeline']].map(([id, label]) => (
          <a key={id} href={`#${id}`}
            className="text-[13px] px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            {label}
          </a>
        ))}
      </nav>

      <div className="space-y-6">
        {/* ── Paper book ── */}
        <Bench id="book" title="Paper book — the signals under full risk policy">
          {!paper ? <p className="text-sm text-muted-foreground">Loading…</p> : <PaperExpanded p={paper} />}
        </Bench>

        {/* ── Simulation ── */}
        <Bench id="simulation" title="Simulation — the news signal vs buy & hold">
          {!sim ? <p className="text-sm text-muted-foreground">Loading…</p>
            : sim.error ? <p className="text-sm text-muted-foreground">{sim.error}</p> : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                {['SPY', 'QQQ', 'TLT', 'GLD', 'USO', 'BTC-USD'].map(s => (
                  <button key={s} onClick={() => setSimSymbol(s)}
                    className={`text-[12px] px-3 py-1 rounded-full tabular-nums transition-colors ${
                      simSymbol === s ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
                    {s}
                  </button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Strategy return" value={`${sim.strategy.total_return_pct}%`} tone={pnlTone(sim.strategy.total_return_pct)} sub={`${sim.buy_and_hold.total_return_pct}% hold`} />
                <Stat label="Sharpe" value={`${sim.strategy.sharpe ?? '—'}`} sub={`${sim.buy_and_hold.sharpe ?? '—'} hold`} />
                <Stat label="Max drawdown" value={`${sim.strategy.max_drawdown_pct}%`} sub={`${sim.buy_and_hold.max_drawdown_pct}% hold`} />
                <Stat label="In market" value={`${sim.exposure_pct}%`} sub={`${sim.days_simulated} days · W=${sim.signal_window_days}d`} />
              </div>
              <div>
                <TimeSeriesChart
                  series={[
                    { label: 'signal-timed', points: sim.curve.map(c => ({ t: c.date, v: c.strategy })), cls: 'stroke-emerald-500', fill: 'fill-emerald-500/10' },
                    { label: 'buy & hold', points: sim.curve.map(c => ({ t: c.date, v: c.hold })), cls: 'stroke-muted-foreground/70', dash: '4 3' },
                  ]}
                  H={260} yFmt={v => v.toFixed(2)} />
                <ChartLegend items={[
                  { label: 'signal-timed', cls: 'stroke-emerald-500' },
                  { label: 'buy & hold', cls: 'stroke-muted-foreground', dash: true },
                ]} />
              </div>
              <p className="text-[12px] text-muted-foreground leading-relaxed max-w-[90ch]">{sim.note} Signal history: {sim.signal_days_available} scored days.</p>
            </div>)}
        </Bench>

        {/* ── Alpha discovery ── */}
        <Bench id="alpha" title="Alpha discovery — does the signal predict returns?">
          {!alphaD ? <p className="text-sm text-muted-foreground">Studying…</p>
            : alphaD.error ? <p className="text-sm text-muted-foreground">{alphaD.error}</p> : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Stat label="Mean rank IC (1d)" value={alphaD.rank_ic_1d.mean != null ? alphaD.rank_ic_1d.mean.toFixed(3) : '—'}
                  sub={`hit ${alphaD.rank_ic_1d.hit_rate != null ? Math.round(alphaD.rank_ic_1d.hit_rate * 100) + '%' : '—'} · ${alphaD.rank_ic_1d.days} days`} />
                <Stat label="t-stat" value={`${alphaD.rank_ic_1d.t_stat ?? '—'}`} sub={`hurdle ${alphaD.t_hurdle ?? '2.0'} · rises with trials`} />
                <Stat label="Tercile spread" value={alphaD.tercile_spread_annualized_pct != null ? `${alphaD.tercile_spread_annualized_pct}% p.a.` : '—'} sub="top third minus bottom" />
                <Stat label="Turnover" value={alphaD.avg_daily_turnover != null ? `${Math.round(alphaD.avg_daily_turnover * 100)}%/d` : '—'} sub="top-tercile membership" />
              </div>
              <div className="grid md:grid-cols-2 gap-8">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold mb-3">IC by forward horizon</p>
                  <div className="flex items-end gap-4 h-32 max-w-md">
                    {Object.entries(alphaD.ic_decay).map(([h, v]) => (
                      <div key={h} className="flex-1 flex flex-col items-center gap-1">
                        <span className="text-[11px] tabular-nums font-semibold">{v != null ? v.toFixed(3) : '—'}</span>
                        <div className={`w-full rounded-sm ${(v ?? 0) >= 0 ? 'bg-emerald-500/70' : 'bg-red-500/70'}`}
                          style={{ height: `${Math.min(96, Math.abs(v ?? 0) * 800) + 3}px` }} />
                        <span className="text-[11px] text-muted-foreground">{h}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold mb-3">
                    Panel · {alphaD.symbols_in_panel.length} names — each opens its dossier
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {alphaD.symbols_in_panel.map(s => (
                      <a key={s} href={`/lab?symbol=${s}`}
                        className="text-[12px] tabular-nums px-2.5 py-1 rounded-full bg-muted text-muted-foreground hover:text-foreground">{s}</a>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[14px] font-medium max-w-[90ch]">{alphaD.verdict}</p>
              <p className="text-[12px] text-muted-foreground">{alphaD.snapshot_study}</p>
            </div>)}
        </Bench>

        {/* ── Backtest ── */}
        <Bench id="backtest" title="Walk-forward backtest — with its overfitting guards">
          {!bt ? <p className="text-sm text-muted-foreground">Running…</p>
            : bt.error ? <p className="text-sm text-muted-foreground">{bt.error}</p> : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                <Stat label="OOS return" value={`${bt.oos_combined.total_return_pct ?? '—'}%`} tone={pnlTone(bt.oos_combined.total_return_pct ?? 0)} sub={`${bt.benchmark_oos.total_return_pct ?? '—'}% benchmark`} />
                <Stat label="OOS Sharpe" value={`${bt.oos_combined.sharpe ?? '—'}`} sub={`${bt.benchmark_oos.sharpe ?? '—'} benchmark`} />
                <Stat label="OOS max DD" value={`${bt.oos_combined.max_drawdown_pct ?? '—'}%`} sub={`${bt.benchmark_oos.max_drawdown_pct ?? '—'}% benchmark`} />
                <Stat label="Deflated Sharpe" value={bt.deflated_sharpe?.dsr != null ? bt.deflated_sharpe.dsr.toFixed(2) : '—'}
                  sub={`P(true SR>0) · ${bt.deflated_sharpe?.trials ?? '—'} trials`} />
                <Stat label="PBO" value={bt.pbo?.pbo != null ? bt.pbo.pbo.toFixed(2) : '—'} sub={`CSCV · ${bt.pbo?.combinations ?? 0} splits`} />
              </div>
              <Section title="Folds — the window is chosen only on pre-fold data">
                <div className="max-w-2xl">
                  {bt.folds.map(f => (
                    <div key={f.fold} className="flex items-baseline justify-between text-[13px] tabular-nums py-1.5 border-b border-border/40 last:border-0">
                      <span>fold {f.fold} · W={f.chosen_window}d · train Sharpe {f.train_sharpe}</span>
                      <span className="font-semibold">{f.oos.total_return_pct ?? '—'}% · shp {f.oos.sharpe ?? '—'} · DD {f.oos.max_drawdown_pct ?? '—'}%</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title={`Universe · ${bt.universe.length} names · ${bt.cost_per_side_bps} bps per side`}>
                <div className="flex flex-wrap gap-1.5">
                  {bt.universe.map(s => (
                    <a key={s} href={`/lab?symbol=${s}`}
                      className="text-[12px] tabular-nums px-2.5 py-1 rounded-full bg-muted text-muted-foreground hover:text-foreground">{s}</a>
                  ))}
                </div>
              </Section>
              <p className="text-[12px] text-muted-foreground leading-relaxed max-w-[90ch]">{bt.note}</p>
              {(bt.caveats ?? []).map((c, i) => (
                <p key={i} className="mt-1.5 text-[11.5px] leading-relaxed max-w-[90ch] text-amber-700 dark:text-amber-400">⚠ {c}</p>
              ))}
            </div>)}
        </Bench>

        {/* ── Bakeoff ── */}
        <Bench id="bakeoff" title="Model bakeoff — on Stocktwits' own labels">
          {!bake ? <p className="text-sm text-muted-foreground">Loading…</p>
            : bake.error ? <p className="text-sm text-muted-foreground">{bake.error}</p> : (
            <div className="space-y-6 max-w-3xl">
              <div className="grid grid-cols-3 gap-4">
                <Stat label="Labeled posts" value={`${bake.labeled_posts}`} sub="Stocktwits bull/bear · grows every 15 min" />
                <Stat label="Class balance" value={bake.class_balance ? `${Math.round(bake.class_balance.bullish * 100)} / ${Math.round(bake.class_balance.bearish * 100)}` : '—'} sub="bull / bear" />
                <Stat label="CV folds" value={`${bake.cv_folds ?? '—'}`} sub="same features, same folds" />
              </div>
              <HBarList max={1}
                items={bake.results.map(r => ({
                  label: r.model, value: Math.round((r.accuracy ?? 0) * 1000) / 10,
                  sub: r.kind,
                }))} unit="%" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">{bake.note}</p>
            </div>)}
        </Bench>

        {/* ── Pipeline health ── */}
        <Bench id="health" title="Pipeline health — the platform watching itself">
          {!health ? <p className="text-sm text-muted-foreground">Checking…</p> : (
            <div className="grid md:grid-cols-2 gap-8">
              <div className="space-y-6">
                <Section title={`Components · overall ${health.overall}`}>
                  <div className="space-y-2">
                    {health.components.map(c => (
                      <div key={c.component} className="flex items-center gap-2.5 text-[13.5px]">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'ok' ? 'bg-emerald-500' : c.status === 'stale' ? 'bg-amber-500' : 'bg-red-500'}`} />
                        <span className="flex-1">{c.component}</span>
                        <span className="text-muted-foreground tabular-nums">{c.age_min != null ? `${Math.round(c.age_min)}m ago` : 'never'}</span>
                      </div>
                    ))}
                  </div>
                </Section>
                <Section title="Corpus">
                  <div className="grid grid-cols-2 gap-3">
                    {Object.entries(health.counts).map(([k, v]) => (
                      <Stat key={k} label={k.replace(/_/g, ' ')} value={v != null ? v.toLocaleString() : '—'} />
                    ))}
                  </div>
                </Section>
                {health.outliers.length > 0 && (
                  <Section title="Signal outliers · 24h">
                    {health.outliers.map(o => (
                      <p key={o.entity} className="text-[12.5px] tabular-nums">{o.entity}: {o.flag}</p>
                    ))}
                  </Section>
                )}
              </div>
              <Section title="Experiments log — every study counts as a trial">
                <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                  {(exps?.experiments ?? []).map((e, i) => (
                    <div key={i} className="text-[12.5px] tabular-nums flex gap-2">
                      <span className="text-muted-foreground w-24 shrink-0">{e.at?.slice(5, 16)}</span>
                      <span className="w-24 font-semibold shrink-0">{e.kind}</span>
                      <span className="flex-1 text-muted-foreground truncate">{JSON.stringify(e.metrics)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            </div>)}
        </Bench>
      </div>
    </div>
  )
}
