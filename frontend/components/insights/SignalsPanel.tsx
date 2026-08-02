import { Analytics, Signal, ago, compact } from '@/lib/analytics'

/** Probability meter — the bar *is* the probability, so no ramp is needed. */
function ProbabilityRow({ s, showVolume }: { s: Signal; showVolume?: boolean }) {
  const p = Math.max(0, Math.min(1, s.yes_price))
  const chg = s.yes_change_24h
  const up = (chg ?? 0) >= 0

  return (
    <a
      href={s.url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block px-5 py-3 hover:bg-muted/30 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] leading-snug font-medium line-clamp-2 min-w-0">{s.question}</p>
        <span className="text-[17px] font-bold tabular-nums leading-none shrink-0 pt-0.5">
          {Math.round(p * 100)}%
        </span>
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <div className="h-1.5 rounded-full bg-muted flex-1 overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${p * 100}%`, background: 'var(--viz-magnitude)' }}
          />
        </div>
        {chg != null && chg !== 0 && (
          <span
            className="text-[11px] font-semibold tabular-nums shrink-0"
            style={{ color: up ? 'var(--viz-tone-p2)' : 'var(--viz-tone-n2)' }}
            title="Change in implied probability over the last 24 hours"
          >
            {up ? '▲' : '▼'} {Math.abs(chg * 100).toFixed(0)}pp
          </span>
        )}
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
        {s.category ?? 'market'}
        {showVolume && s.volume_24h != null && ` · $${compact(Math.round(s.volume_24h))} 24h volume`}
        {s.end_date && ` · resolves ${new Date(s.end_date).toLocaleDateString([], { month: 'short', day: 'numeric' })}`}
      </p>
    </a>
  )
}

export default function SignalsPanel({ signals }: { signals: Analytics['signals'] }) {
  const cats = Object.entries(signals.categories).sort((a, b) => b[1] - a[1])
  const maxCat = Math.max(1, ...cats.map(c => c[1]))

  if (signals.count === 0) {
    return (
      <div className="news-card p-8 text-center">
        <p className="font-semibold">No market signals loaded</p>
        <p className="text-sm text-muted-foreground mt-1.5">
          The Polymarket refresh has not run yet.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="news-card overflow-hidden lg:col-span-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground px-5 pt-5 pb-3">
          Biggest 24h moves
        </p>
        <div className="divide-y divide-border/60">
          {signals.movers.slice(0, 6).map(s => (
            <ProbabilityRow key={s.id} s={s} />
          ))}
        </div>
      </div>

      <div className="news-card overflow-hidden lg:col-span-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground px-5 pt-5 pb-3">
          Most traded
        </p>
        <div className="divide-y divide-border/60">
          {signals.by_volume.slice(0, 6).map(s => (
            <ProbabilityRow key={s.id} s={s} showVolume />
          ))}
        </div>
      </div>

      <div className="news-card p-5 lg:col-span-1">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-4">
          Markets tracked
        </p>
        <div className="space-y-2.5">
          {cats.map(([name, n]) => (
            <div key={name} className="grid grid-cols-[86px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-[12px] text-muted-foreground capitalize truncate">{name}</span>
              <div className="h-2 rounded-full bg-muted/70 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${(n / maxCat) * 100}%`, background: 'var(--viz-magnitude)' }}
                />
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground w-8 text-right">{n}</span>
            </div>
          ))}
        </div>
        <p className="mt-5 pt-4 border-t border-border/60 text-[12px] text-muted-foreground leading-relaxed">
          <strong className="font-semibold text-foreground tabular-nums">{signals.count}</strong>{' '}
          live Polymarket contracts, refreshed {ago(signals.last_updated)}. Prices are the
          market&rsquo;s implied probability, not a forecast from this app.
        </p>
      </div>
    </div>
  )
}
