import { Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { big, pct } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

type Key = 'mkt_cap' | 'pe' | 'roe' | 'margin' | 'growth' | 'yield' | 'exp_return' | 'chg_1y'
interface Row extends Partial<Record<Key, number | null>> { symbol: string; self: boolean; covered: boolean; name?: string }
interface Rv { symbol: string; rows: Row[]; peer_median: Record<Key, number | null>; rank: Record<Key, number | null>; of: number }

const COLUMNS: [Key, string, (v: number | null | undefined) => string][] = [
  ['mkt_cap', 'Mkt cap', v => big(v)], ['pe', 'P/E', v => (v == null ? '—' : v.toFixed(1))],
  ['roe', 'ROE', v => pct(v, false)], ['margin', 'Margin', v => pct(v, false)],
  ['growth', 'Growth', v => pct(v)], ['yield', 'Yield', v => pct(v, false)],
  ['exp_return', 'Exp. return', v => pct(v)], ['chg_1y', '1y', v => pct(v)],
]

export default function Peers({ command, run }: ViewProps) {
  const { data, error, loading } = useResource<Rv>(`/api/terminal/peers/${encodeURIComponent(command.security!.symbol)}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="py-1.5 px-2 text-left">Company</th>
                  {COLUMNS.map(([k, head]) => <th key={k} className="py-1.5 px-2 text-right">{head}</th>)}
                </tr>
              </thead>
              <tbody>
                {d.rows.map(r => (
                  <tr key={r.symbol} onClick={() => !r.self && run(`${r.symbol} RV`)}
                    className={`border-b border-border/40 ${r.self ? 'bg-muted/50 font-semibold' : 'cursor-pointer hover:bg-muted/30'}`}>
                    <td className="py-1.5 px-2"><b>{r.symbol}</b> <span className="text-muted-foreground font-normal">{r.name ?? (r.covered ? '' : 'not in store')}</span></td>
                    {COLUMNS.map(([k, , f]) => <td key={k} className="py-1.5 px-2 text-right">{f(r[k])}</td>)}
                  </tr>
                ))}
                <tr className="text-muted-foreground">
                  <td className="py-1.5 px-2">Peer median</td>
                  {COLUMNS.map(([k, , f]) => <td key={k} className="py-1.5 px-2 text-right">{f(d.peer_median[k])}</td>)}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1.5 px-2">{d.symbol} rank (1 = highest)</td>
                  {COLUMNS.map(([k]) => <td key={k} className="py-1.5 px-2 text-right">{d.rank[k] ? `${d.rank[k]} of ${d.of}` : '—'}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <Note>
            Peers are the companies Yahoo shows as similar, which follows what readers look at together, so they are
            not always in the same industry. Measures come from the EQS table; non-US companies are not in it.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
