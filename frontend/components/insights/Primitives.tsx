import { ReactNode } from 'react'

/** Editorial section header — matches the masthead pattern used app-wide. */
export function SectionHead({
  kicker,
  title,
  blurb,
  aside,
}: {
  kicker: string
  title: string
  blurb?: string
  aside?: ReactNode
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-4">
      <div className="min-w-0">
        <p className="news-section-label">{kicker}</p>
        <h2 className="mt-1 text-xl sm:text-2xl font-bold tracking-tight leading-none">
          {title}
        </h2>
        {blurb && (
          <p className="mt-2 text-[13px] text-muted-foreground leading-relaxed max-w-prose">
            {blurb}
          </p>
        )}
      </div>
      {aside && <div className="shrink-0 text-right">{aside}</div>}
    </div>
  )
}

/**
 * A single headline number. No plot, so per the stat-tile rule it carries no
 * chart chrome — just the figure, its label, and an optional delta.
 */
export function StatTile({
  label,
  value,
  sub,
  delta,
}: {
  label: string
  value: string
  sub?: string
  /** Fractional change, e.g. 0.33 for +33%. */
  delta?: number | null
}) {
  return (
    <div className="news-card px-4 py-3.5">
      <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-[26px] font-bold leading-none tracking-tight">{value}</p>
      <div className="mt-1.5 flex items-baseline gap-1.5 min-h-[16px]">
        {delta != null && Number.isFinite(delta) && (
          <span
            className="text-[11px] font-semibold tabular-nums"
            style={{
              color: delta >= 0 ? 'var(--viz-tone-p2)' : 'var(--viz-tone-n2)',
            }}
          >
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}%
          </span>
        )}
        {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  )
}

/**
 * Horizontal magnitude bar. Length carries the value, so the fill is a single
 * graphite — no ramp, no per-row hue.
 */
export function MagnitudeBar({
  label,
  value,
  max,
  caption,
  color = 'var(--viz-magnitude)',
}: {
  label: string
  value: number
  max: number
  caption: string
  color?: string
}) {
  const w = max > 0 ? Math.max(1.5, (value / max) * 100) : 0
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-3">
      <span className="text-[12px] text-muted-foreground truncate">{label}</span>
      <div className="h-2 rounded-full bg-muted/70 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${w}%`, background: color }} />
      </div>
      <span className="text-[11px] tabular-nums text-muted-foreground w-14 text-right">
        {caption}
      </span>
    </div>
  )
}

/**
 * Left / centre / right outlet split. Same three-segment vocabulary the Same
 * Story page uses, so a spread means the same thing everywhere.
 */
export function SpreadBar({
  left,
  center,
  right,
  className = '',
}: {
  left: number
  center: number
  right: number
  className?: string
}) {
  const total = left + center + right
  if (total === 0) return null
  const seg = (n: number) => `${(n / total) * 100}%`
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="flex h-1.5 rounded-full overflow-hidden bg-muted flex-1 gap-[2px]">
        {left > 0 && (
          <div style={{ width: seg(left), background: 'var(--viz-bias-l3)' }} title={`${left} left`} />
        )}
        {center > 0 && (
          <div style={{ width: seg(center), background: 'var(--viz-mid)' }} title={`${center} centre`} />
        )}
        {right > 0 && (
          <div style={{ width: seg(right), background: 'var(--viz-bias-r3)' }} title={`${right} right`} />
        )}
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {left}L · {center}C · {right}R
      </span>
    </div>
  )
}

/** Small legend swatch + label. Identity is never carried by color alone. */
export function LegendKey({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Caveat line — used where the data is real but easy to misread. */
export function Caveat({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80 border-l-2 border-border pl-2.5">
      {children}
    </p>
  )
}
