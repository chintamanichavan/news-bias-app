'use client'

// The Signals home carries only this summary strip — one headline number per
// bench, each linking into the full-width bench on /strategy.

import {
  type Alpha, type Backtest, type Bakeoff, type Health, type Paper, type Sim,
  pnlTone,
} from '@/components/benches'
import { useResource } from '@/lib/useResource'

function Cell({ href, label, value, sub, tone }: {
  href: string; label: string; value: string; sub: string; tone?: string
}) {
  return (
    <a href={href} className="block px-4 py-3 hover:bg-muted/40 transition-colors">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${tone ?? ''}`}>{value}</div>
      <div className="text-[10.5px] text-muted-foreground tabular-nums truncate">{sub}</div>
    </a>
  )
}

export default function StrategyLab() {
  const { data: paper } = useResource<Paper>('/api/paper')
  const { data: sim } = useResource<Sim>('/api/simulate?symbol=SPY&days=120')
  const { data: bake } = useResource<Bakeoff>('/api/research/bakeoff')
  const { data: alphaD } = useResource<Alpha>('/api/alpha?days=120')
  const { data: bt } = useResource<Backtest>('/api/backtest?days=150')
  const { data: health } = useResource<Health>('/api/health/pipeline')

  const bestModel = bake?.results?.length
    ? [...bake.results].filter(r => r.kind !== 'baseline').sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0))[0]
    : null

  return (
    <section className="mt-12">
      <div className="flex items-baseline justify-between mb-3 px-1">
        <p className="news-section-label">Strategy Lab</p>
        <a href="/strategy" className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
          Open the lab →
        </a>
      </div>
      <div className="news-card grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-y sm:divide-y-0 divide-border/50 overflow-hidden">
        <Cell href="/strategy#book" label="Paper book"
          value={paper ? `$${(paper.equity / 1000).toFixed(1)}k` : '…'}
          sub={paper ? (paper.alpha_gate.cleared ? `${paper.positions.length} positions` : 'gate closed · in cash') : ''}
          tone={paper ? pnlTone(paper.total_return_pct) : undefined} />
        <Cell href="/strategy#simulation" label="Simulation · SPY"
          value={sim && !sim.error ? `${sim.strategy.total_return_pct}%` : '…'}
          sub={sim && !sim.error ? `vs ${sim.buy_and_hold.total_return_pct}% hold` : ''}
          tone={sim && !sim.error ? pnlTone(sim.strategy.total_return_pct) : undefined} />
        <Cell href="/strategy#alpha" label="Alpha · rank IC"
          value={alphaD && !alphaD.error && alphaD.rank_ic_1d.mean != null ? alphaD.rank_ic_1d.mean.toFixed(3) : '…'}
          sub={alphaD && !alphaD.error ? `t ${alphaD.rank_ic_1d.t_stat ?? '—'} vs hurdle ${alphaD.t_hurdle ?? 2}` : ''} />
        <Cell href="/strategy#backtest" label="Backtest · OOS"
          value={bt && !bt.error ? `${bt.oos_combined.total_return_pct ?? '—'}%` : '…'}
          sub={bt && !bt.error ? `DSR ${bt.deflated_sharpe?.dsr?.toFixed(2) ?? '—'} · PBO ${bt.pbo?.pbo?.toFixed(2) ?? '—'}` : ''}
          tone={bt && !bt.error ? pnlTone(bt.oos_combined.total_return_pct ?? 0) : undefined} />
        <Cell href="/strategy#bakeoff" label="Best model"
          value={bestModel?.accuracy != null ? `${(bestModel.accuracy * 100).toFixed(1)}%` : '…'}
          sub={bestModel ? bestModel.model.split(' (')[0].split(' — ')[0] : ''} />
        <Cell href="/strategy#health" label="Pipeline"
          value={health ? health.overall.toUpperCase() : '…'}
          sub={health ? `${health.counts.snapshots ?? 0} snapshots · ${health.counts.experiments ?? 0} trials` : ''}
          tone={health?.overall === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
            : health?.overall === 'stale' ? 'text-amber-600 dark:text-amber-400'
            : health ? 'text-red-600 dark:text-red-400' : undefined} />
      </div>
    </section>
  )
}
