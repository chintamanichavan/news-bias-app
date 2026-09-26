'use client'

// The step-by-step journey toward compounded returns — the alpha path, not
// the beta path. ETFs buy exposure anyone can have; this platform exists to
// find edge and compound it. The stages are the platform's own gates, and
// the projector prices what validated alpha is worth over a working life:
// the same contributions compounding at market beta vs beta + your edge.

import { useMemo, useState } from 'react'

const STAGES = [
  {
    n: 1, title: 'Bank the signals',
    body: 'The engine snapshots five channels per security every 15 minutes. Time in the data is the moat — every quiet week makes the alpha studies below more decisive. Nothing to do here but keep the pipeline green.',
  },
  {
    n: 2, title: 'Prove alpha exists',
    body: 'The Lab’s rank-IC study is the gate: a signal earns attention only at |t| ≥ 2 with a positive tercile spread. Anything less is beta wearing a costume. Current verdict on the news channel: an honest null — the bar is doing its job.',
  },
  {
    n: 3, title: 'Validate out-of-sample, net of costs',
    body: 'Walk-forward backtests with slippage and commissions, parameters tuned only on pre-fold data, judged as excess over the benchmark — alpha is what survives after the beta anyone could buy is subtracted.',
  },
  {
    n: 4, title: 'Compound on paper',
    body: 'Validated signals run the $100k paper book under full risk management — vol-targeted sizing, stops, class caps, kill-switch. The score that matters is excess return over SPY, compounded, not raw PnL.',
  },
  {
    n: 5, title: 'Deploy small, scale with evidence',
    body: 'Real capital enters at a size where a full stop-out is tuition, not damage — fractional shares make sticker prices irrelevant. Size up only as live alpha confirms paper alpha. The discretionary sleeve follows the same law: watchlist names only in their buy zones with complete theses (ADRs 0002, 0007).',
  },
]

function fmtMoney(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${Math.round(v / 1e3).toLocaleString()}k`
  return `$${Math.round(v)}`
}

export default function CompoundingJourney() {
  const [monthly, setMonthly] = useState(1000)
  const [betaPct, setBetaPct] = useState(7)
  const [alphaPct, setAlphaPct] = useState(3)
  const [years, setYears] = useState(20)

  const proj = useMemo(() => {
    const months = years * 12
    const rBeta = betaPct / 100 / 12
    const rEdge = (betaPct + alphaPct) / 100 / 12
    const series: { y: number; beta: number; edge: number; contrib: number }[] = []
    let beta = 0, edge = 0
    const milestones: { label: string; value: number; year: number | null }[] =
      [100_000, 500_000, 1_000_000].map(v => ({ label: fmtMoney(v), value: v, year: null }))
    let crossover: number | null = null
    for (let m = 1; m <= months; m++) {
      beta = beta * (1 + rBeta) + monthly
      edge = edge * (1 + rEdge) + monthly
      const contrib = monthly * m
      for (const ms of milestones) if (ms.year === null && edge >= ms.value) ms.year = m / 12
      if (crossover === null && edge - contrib >= contrib) crossover = m / 12
      if (m % 3 === 0 || m === months) series.push({ y: m / 12, beta, edge, contrib })
    }
    return {
      series, milestones, crossover,
      finalBeta: beta, finalEdge: edge,
      contributed: monthly * months,
      alphaWorth: edge - beta,
      doubling: Math.round((72 / (betaPct + alphaPct)) * 10) / 10,
    }
  }, [monthly, betaPct, alphaPct, years])

  const W = 560, H = 160
  const maxV = proj.finalEdge || 1
  const px = (y: number) => (y / years) * W
  const py = (v: number) => H - 6 - (v / maxV) * (H - 16)
  const path = (key: 'beta' | 'edge' | 'contrib') =>
    proj.series.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(p.y).toFixed(1)} ${py(p[key]).toFixed(1)}`).join(' ')
  const edgeArea = `${path('edge')} L ${W} ${py(proj.finalBeta).toFixed(1)} ${[...proj.series].reverse().map(p => `L ${px(p.y).toFixed(1)} ${py(p.beta).toFixed(1)}`).join(' ')} Z`

  return (
    <section className="mt-10">
      <div className="flex items-baseline justify-between mb-4">
        <p className="news-section-label">The compounding journey</p>
        <span className="text-[11px] text-muted-foreground">alpha compounds the same way beta does — on top of it</span>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4 items-start">
        {/* Stages — the platform's own gates */}
        <div className="news-card divide-y divide-border/60">
          {STAGES.map(s => (
            <div key={s.n} className="px-5 py-4 flex gap-4">
              <span className="shrink-0 w-7 h-7 rounded-full bg-[hsl(var(--accent-news))] text-white text-[13px] font-bold flex items-center justify-center tabular-nums">{s.n}</span>
              <div>
                <p className="text-sm font-semibold">{s.title}</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground leading-relaxed">{s.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* What the edge is worth */}
        <div className="news-card p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">What validated alpha is worth</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Monthly</span>
              <input type="number" min={0} step={50} value={monthly} id="cj-monthly"
                onChange={e => setMonthly(Math.max(0, Number(e.target.value)))}
                className="w-24 bg-transparent border border-border rounded-md px-2 py-1 tabular-nums" />
            </label>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1">Beta</span>
              {[5, 7, 9].map(r => (
                <button key={r} onClick={() => setBetaPct(r)}
                  className={`px-2 py-0.5 rounded-full text-[12px] tabular-nums ${betaPct === r ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-muted/60'}`}>
                  {r}%
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted-foreground mr-1">+ Alpha</span>
              {[0, 2, 3, 5].map(a => (
                <button key={a} onClick={() => setAlphaPct(a)}
                  className={`px-2 py-0.5 rounded-full text-[12px] tabular-nums ${alphaPct === a ? 'bg-emerald-600 text-white font-semibold' : 'text-muted-foreground hover:bg-muted/60'}`}>
                  {a}%
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 flex-1 min-w-[130px]">
              <span className="text-muted-foreground whitespace-nowrap tabular-nums">{years} yrs</span>
              <input type="range" min={5} max={40} value={years} id="cj-years"
                onChange={e => setYears(Number(e.target.value))} className="w-full accent-[hsl(var(--accent-news))]" />
            </label>
          </div>

          <svg viewBox={`0 0 ${W} ${H}`} className="w-full mt-3">
            {/* the alpha wedge — the whole argument in one shape */}
            <path d={edgeArea} className="fill-emerald-500/20" />
            <path d={path('edge')} fill="none" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth={2} />
            <path d={path('beta')} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} />
            <path d={path('contrib')} fill="none" className="stroke-muted-foreground/60" strokeWidth={1} strokeDasharray="4 3" />
            {proj.crossover != null && proj.crossover <= years && (
              <g>
                <line x1={px(proj.crossover)} x2={px(proj.crossover)} y1={10} y2={H - 6} className="stroke-amber-500" strokeWidth={1} strokeDasharray="3 3" />
                <text x={Math.min(px(proj.crossover) + 4, W - 170)} y={18} fontSize={9.5} className="fill-amber-600 dark:fill-amber-400">
                  yr {proj.crossover.toFixed(1)}: growth overtakes contributions
                </text>
              </g>
            )}
          </svg>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            <span><span className="inline-block w-3 h-[2px] bg-emerald-500 align-middle mr-1" />beta + alpha</span>
            <span><span className="inline-block w-3 h-[2px] bg-muted-foreground align-middle mr-1" />beta alone (what an ETF buys)</span>
            <span><span className="inline-block w-3 h-[2px] bg-muted-foreground/60 align-middle mr-1" />contributions</span>
            <span className="text-emerald-600 dark:text-emerald-400">shaded: the edge&rsquo;s worth</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-3 tabular-nums">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">With edge · {years} yrs</div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(proj.finalEdge)}</div>
              <div className="text-[10px] text-muted-foreground">{fmtMoney(proj.finalBeta)} beta-only · {fmtMoney(proj.contributed)} put in</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">The alpha is worth</div>
              <div className="text-lg font-bold">{fmtMoney(proj.alphaWorth)}</div>
              <div className="text-[10px] text-muted-foreground">at +{alphaPct}% · doubles ~{proj.doubling} yrs</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Milestones</div>
              {proj.milestones.map(m => (
                <div key={m.label} className="text-[11.5px]">
                  <span className="font-semibold">{m.label}</span>{' '}
                  <span className="text-muted-foreground">{m.year != null ? `yr ${m.year.toFixed(1)}` : 'beyond horizon'}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-3 pt-2 border-t border-border/60 text-[10px] text-muted-foreground/80 leading-relaxed">
            Nominal, before tax, constant rates — real edge arrives lumpy and decays; that is why stages 2–4 gate
            deployment. Sustained net alpha of even +2–3% is rare and precious: the shaded wedge is what the whole
            platform is building toward, and every percentage point must first survive the IC bar and walk-forward
            validation above.
          </p>
        </div>
      </div>
    </section>
  )
}
