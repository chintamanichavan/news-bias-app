'use client'

import { useState } from 'react'
import { Bin, Bucket, Quantiles, divergingVar } from '@/lib/analytics'
import { Caveat, LegendKey } from './Primitives'

interface Props {
  /** Named ranges — "how many articles lean left". */
  buckets: Bucket[]
  /** Equal-width bins over the observed range — "what shape is the output". */
  bins: Bin[]
  quantiles: Quantiles | null
  nominalMin: number
  nominalMax: number
  /** Observed range ÷ nominal range. */
  scaleUsed: number
  scored: number
  scale: 'bias' | 'tone'
  negLabel: string
  posLabel: string
}

export default function DistributionChart({
  buckets,
  bins,
  quantiles,
  nominalMin,
  nominalMax,
  scaleUsed,
  scored,
  scale,
  negLabel,
  posLabel,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const maxBucket = Math.max(1, ...buckets.map(b => b.count))
  const maxBin = Math.max(1, ...bins.map(b => b.count))

  // The fine histogram and the quantile strip share one x-domain: the observed
  // range. Mapping them onto the nominal scale instead would squash a narrow
  // distribution into a single invisible pixel column.
  const obsLo = bins.length ? bins[0].lo : nominalMin
  const obsHi = bins.length ? bins[bins.length - 1].hi : nominalMax
  const obsSpan = obsHi - obsLo || 1
  const toPct = (v: number) => ((v - obsLo) / obsSpan) * 100

  const W = 800
  const H = 96
  const binW = bins.length ? W / bins.length : W

  const negPole = `var(--viz-${scale === 'bias' ? 'bias-l3' : 'tone-n3'})`
  const posPole = `var(--viz-${scale === 'bias' ? 'bias-r3' : 'tone-p3'})`

  // A distribution that never crosses zero means half the nominal scale is
  // unreachable — a far more serious caveat than a merely narrow range, and one
  // that would otherwise read as "no left-leaning coverage exists".
  const oneSided =
    scored > 0 && nominalMin < 0 && (obsLo >= 0 || obsHi <= 0) && bins.length > 0

  return (
    <div>
      {/* ── Named buckets ── */}
      <div className="flex items-end gap-[2px] h-36">
        {buckets.map(b => {
          const mid = (b.lo + b.hi) / 2
          const h = (b.count / maxBucket) * 100
          return (
            <div key={b.key} className="flex-1 flex flex-col justify-end items-center h-full min-w-0">
              <span className="text-[11px] tabular-nums font-medium mb-1 leading-none">
                {b.count > 0 ? b.count.toLocaleString() : ''}
              </span>
              <div
                className="w-full rounded-t-[4px]"
                style={{
                  height: `${Math.max(b.count > 0 ? 3 : 0.8, h)}%`,
                  background: b.count > 0 ? divergingVar(mid, nominalMax, scale) : 'var(--viz-grid)',
                }}
                title={`${b.label}: ${b.count.toLocaleString()} articles (${b.lo} to ${b.hi})`}
              />
            </div>
          )
        })}
      </div>
      <div className="flex gap-[2px] mt-1.5 border-t border-border pt-1.5">
        {buckets.map(b => (
          <span
            key={b.key}
            className="flex-1 text-[9px] sm:text-[10px] text-muted-foreground text-center leading-tight min-w-0 px-0.5"
          >
            {b.label}
          </span>
        ))}
      </div>

      {/* ── Observed shape ── */}
      <div className="mt-7">
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Observed shape
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {obsLo.toFixed(2)} → {obsHi.toFixed(2)}
          </p>
        </div>

        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto block"
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            {bins.map((b, i) => {
              const h = (b.count / maxBin) * (H - 4)
              const mid = (b.lo + b.hi) / 2
              return (
                <rect
                  key={i}
                  x={i * binW + 1}
                  y={H - h}
                  width={Math.max(1, binW - 2)}
                  height={Math.max(b.count > 0 ? 1.5 : 0, h)}
                  rx={2}
                  fill={divergingVar(mid, nominalMax, scale)}
                  opacity={hover == null || hover === i ? 1 : 0.45}
                  onMouseEnter={() => setHover(i)}
                />
              )
            })}
          </svg>

          {hover != null && bins[hover] && (
            <div className="absolute top-0 right-0 text-[11px] bg-background/95 border border-border rounded-md px-2 py-1 shadow-sm tabular-nums pointer-events-none">
              <span className="font-semibold">{bins[hover].count.toLocaleString()}</span>
              <span className="text-muted-foreground">
                {' '}in {bins[hover].lo.toFixed(3)}–{bins[hover].hi.toFixed(3)}
              </span>
            </div>
          )}
        </div>

        {/* Quantile strip, same x-domain as the bins above */}
        {quantiles && (
          <div className="mt-2.5">
            <div className="relative h-5">
              <div
                className="absolute top-1/2 -translate-y-1/2 h-[2px] bg-muted-foreground/30"
                style={{ left: `${toPct(quantiles.min)}%`, right: `${100 - toPct(quantiles.max)}%` }}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3 rounded-[3px] bg-muted-foreground/25"
                style={{ left: `${toPct(quantiles.p25)}%`, right: `${100 - toPct(quantiles.p75)}%` }}
                title={`Interquartile range ${quantiles.p25} → ${quantiles.p75}`}
              />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-[2px] h-4 bg-foreground rounded-full"
                style={{ left: `${toPct(quantiles.median)}%` }}
                title={`Median ${quantiles.median}`}
              />
            </div>
            <dl className="mt-1.5 grid grid-cols-3 sm:grid-cols-5 gap-y-1.5 gap-x-3 text-[11px]">
              {(
                [
                  ['Median', quantiles.median],
                  ['Mean', quantiles.mean],
                  ['Std dev', quantiles.stdev],
                  ['p10', quantiles.p10],
                  ['p90', quantiles.p90],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline gap-1.5 min-w-0">
                  <dt className="text-muted-foreground truncate">{k}</dt>
                  <dd className="tabular-nums font-medium">{v.toFixed(3)}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <LegendKey
          items={[
            { color: negPole, label: negLabel },
            { color: 'var(--viz-mid)', label: 'Neutral' },
            { color: posPole, label: posLabel },
          ]}
        />
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {scored.toLocaleString()} scored
        </span>
      </div>

      {oneSided ? (
        <Caveat>
          <strong className="font-semibold">
            Every score this model produced is {obsLo >= 0 ? 'positive' : 'negative'}
          </strong>{' '}
          ({obsLo.toFixed(2)} to {obsHi.toFixed(2)} across {scored.toLocaleString()} articles), so
          the {obsLo >= 0 ? negLabel.toLowerCase() : posLabel.toLowerCase()} half of the{' '}
          {nominalMin} to {nominalMax} scale is unreachable — those buckets read empty because the
          model cannot output them, not because no such coverage exists. Treat this as a{' '}
          {obsLo >= 0 ? posLabel.toLowerCase() : negLabel.toLowerCase()}-ness ranking rather than a
          two-sided scale until it is retrained.
        </Caveat>
      ) : scaleUsed < 0.25 ? (
        <Caveat>
          The model only spans <strong className="font-semibold">{(scaleUsed * 100).toFixed(1)}%</strong>{' '}
          of its nominal {nominalMin} to {nominalMax} range on this corpus, so nearly everything
          lands in one named bucket. The observed-shape histogram above is rescaled to the range
          the model actually produces — read the structure there, not the flat bar chart.
        </Caveat>
      ) : null}
    </div>
  )
}
