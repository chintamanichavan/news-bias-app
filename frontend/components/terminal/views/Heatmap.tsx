import { Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { big, pct } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Name { symbol: string; name: string; change_pct: number | null; market_cap: number | null }
interface Sector { name: string; change_pct: number | null; market_cap: number; names: Name[] }

/** Green for up, red for down; a 3% move is full strength. */
export function heat(change: number | null): string {
  if (change == null) return 'hsl(0 0% 50% / 0.15)'
  const strength = Math.min(Math.abs(change) / 3, 1)
  const hue = change >= 0 ? '145 63% 38%' : '0 72% 50%'
  return `hsl(${hue} / ${(0.12 + 0.78 * strength).toFixed(2)})`
}

export default function Heatmap({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ sectors: Sector[] }>('/api/terminal/heatmap')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          {/* sector width and tile width both follow market cap */}
          <div className="flex flex-wrap gap-1.5">
            {d.sectors.map(s => (
              <div key={s.name} className="min-w-[9rem] rounded-md border border-border p-1"
                style={{ flexGrow: s.market_cap, flexBasis: 0 }}>
                <div className="flex items-baseline justify-between gap-2 px-0.5 pb-1 text-[10.5px]">
                  <span className="font-semibold uppercase tracking-wider">{s.name}</span>
                  <span className="tabular-nums font-semibold">{pct(s.change_pct)}</span>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {s.names.map(n => (
                    <button key={n.symbol} onClick={() => run(`${n.symbol} GIP`)}
                      title={`${n.name} · ${big(n.market_cap)} · ${pct(n.change_pct)}`}
                      className="h-11 min-w-[3.25rem] rounded-sm px-1 text-left hover:ring-1 hover:ring-foreground/40"
                      style={{ flexGrow: n.market_cap ?? 0, flexBasis: 0, background: heat(n.change_pct) }}>
                      <span className="block text-[10.5px] font-bold leading-tight">{n.symbol}</span>
                      <span className="block text-[10px] tabular-nums leading-tight">{pct(n.change_pct)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <Note>The 15 largest US-listed companies in each sector; a sector&rsquo;s move is weighted by market cap.</Note>
        </div>
      )}
    </Fetched>
  )
}
