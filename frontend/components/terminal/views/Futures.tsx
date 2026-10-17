import { Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { pct, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Contract { symbol: string; month: string; price: number; change_pct: number }
interface Chain { root: string; name: string; contracts: Contract[]; shape: string | null }
interface Group { name: string; roots: Chain[] }

const SHAPE: Record<string, string> = {
  contango: 'later months dearer',
  backwardation: 'later months cheaper',
  flat: 'flat',
}

function price(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: v < 10 ? 4 : 2, minimumFractionDigits: v < 10 ? 4 : 2 })
}

export default function Futures({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ groups: Group[] }>('/api/terminal/futures')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          {d.groups.map(g => (
            <div key={g.name}>
              <p className="news-section-label mb-1">{g.name}</p>
              <table className="w-full text-[12px] tabular-nums">
                <tbody>
                  {g.roots.map(r => (
                    <tr key={r.root} className="border-b border-border/40 last:border-0 align-top">
                      <th className="py-1.5 pr-3 text-left font-normal w-40">
                        <span className="font-semibold">{r.root}</span> <span className="text-muted-foreground">{r.name}</span>
                      </th>
                      {r.contracts.map(c => (
                        <td key={c.symbol} className="py-1.5 px-2 text-right">
                          <button onClick={() => run(`${c.symbol} GP 6M`)} className="text-right hover:underline">
                            <span className="block text-[10px] text-muted-foreground">{c.month}</span>
                            <span className="block">{price(c.price)}</span>
                            <span className={`block text-[10.5px] ${tone(c.change_pct)}`}>{pct(c.change_pct)}</span>
                          </button>
                        </td>
                      ))}
                      {Array.from({ length: 5 - r.contracts.length }, (_, i) => <td key={`gap${i}`} />)}
                      <td className="py-1.5 pl-2 text-right text-[10.5px] text-muted-foreground w-36">{r.shape ? SHAPE[r.shape] : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <Note>
            The next listed delivery months, front first. Expired and untraded months are left out. Click a contract
            for its chart. Prices about 10 minutes late.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
