import { Fetched, Note, Table } from '../kit'
import { day } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'
import { useWidth } from '@/lib/terminal/useWidth'

interface CurveData {
  tenors: { label: string; years: number }[]
  curves: { label: string; date: string; yields: Record<string, number> }[]
  spreads: Record<string, number | null>
}

const LINE = ['stroke-foreground', 'stroke-sky-500', 'stroke-amber-500', 'stroke-muted-foreground']
const H = 220
const PAD = { l: 44, r: 12, t: 10, b: 24 }

/** Tenors sit evenly across the width, as on a printed curve. */
function CurveChart({ data }: { data: CurveData }) {
  const { ref, width: W } = useWidth<HTMLDivElement>()
  const all = data.curves.flatMap(c => Object.values(c.yields))
  const lo = Math.floor(Math.min(...all) * 4) / 4
  const hi = Math.ceil(Math.max(...all) * 4) / 4
  const x = (i: number) => PAD.l + (i * (W - PAD.l - PAD.r)) / (data.tenors.length - 1)
  const y = (v: number) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo || 1)
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <div ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Treasury yield curve">
        {ticks.map(t => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-border" strokeDasharray="2 4" />
            <text x={4} y={y(t) + 3} className="fill-muted-foreground text-[10px]">{t.toFixed(2)}%</text>
          </g>
        ))}
        {data.tenors.map((t, i) => (
          <text key={t.label} x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[10px]">{t.label}</text>
        ))}
        {[...data.curves].reverse().map(c => {
          const k = data.curves.indexOf(c)
          const pts = data.tenors.map((t, i) => (c.yields[t.label] == null ? null : `${x(i)},${y(c.yields[t.label])}`))
            .filter(Boolean).join(' ')
          return <polyline key={c.label} points={pts} fill="none" strokeWidth={k === 0 ? 2.25 : 1.25}
            className={LINE[k]} strokeDasharray={k === 3 ? '4 3' : undefined} />
        })}
      </svg>
    </div>
  )
}

export default function Curve() {
  const { data, error, loading } = useResource<CurveData>('/api/terminal/curve')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        if (d.curves.length === 0) return <Note>No Treasury curve was published.</Note>
        const [now, ...before] = d.curves
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
              {d.curves.map((c, i) => (
                <span key={c.label} className="inline-flex items-center gap-1.5">
                  <svg width="18" height="6"><line x1="0" x2="18" y1="3" y2="3" strokeWidth="2" className={LINE[i]}
                    strokeDasharray={i === 3 ? '4 3' : undefined} /></svg>
                  {c.label} · {day(c.date)}
                </span>
              ))}
            </div>
            <CurveChart data={d} />
            <Table
              rows={d.tenors.filter(t => now.yields[t.label] != null)}
              rowKey={t => t.label}
              columns={[
                { head: 'Tenor', align: 'left', cell: t => t.label },
                ...d.curves.map(c => ({ head: c.label, cell: (t: { label: string }) => c.yields[t.label]?.toFixed(2) ?? '—' })),
                ...before.map(c => ({
                  head: `Δ vs ${c.label.replace(' ago', '')} (bp)`,
                  cell: (t: { label: string }) => {
                    const a = now.yields[t.label], b = c.yields[t.label]
                    return a == null || b == null ? '—' : `${a - b > 0 ? '+' : ''}${Math.round((a - b) * 100)}`
                  },
                })),
              ]}
            />
            <Note>
              Spreads: 3M–10Y {d.spreads['3M10Y_bp']} bp, 2Y–10Y {d.spreads['2Y10Y_bp']} bp, 5Y–30Y {d.spreads['5Y30Y_bp']} bp.
              US Treasury par yields, published after each trading day.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
