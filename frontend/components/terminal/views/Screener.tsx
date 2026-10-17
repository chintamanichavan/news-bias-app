import { useState } from 'react'
import { Fail, Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price } from '@/lib/terminal/numbers'
import { applyConditions, FIELDS, parseConditions, sortBy, type ScreenRow } from '@/lib/terminal/screen'
import { useResource } from '@/lib/useResource'

const SHOWN = 100

const COLUMNS: { field: keyof typeof FIELDS; head: string; cell: (r: ScreenRow) => string }[] = [
  { field: 'PRICE', head: 'Price', cell: r => price(r.price) },
  { field: 'CAP', head: 'Mkt cap', cell: r => big(r.mkt_cap) },
  { field: 'PE', head: 'P/E', cell: r => (r.pe == null ? '—' : r.pe.toFixed(1)) },
  { field: 'ROE', head: 'ROE', cell: r => pct(r.roe, false) },
  { field: 'MARGIN', head: 'Margin', cell: r => pct(r.margin, false) },
  { field: 'GROWTH', head: 'Growth', cell: r => pct(r.growth) },
  { field: 'YIELD', head: 'Yield', cell: r => pct(r.yield, false) },
  { field: 'RETURN', head: 'Exp. return', cell: r => pct(r.exp_return) },
  { field: 'CHG', head: '1y', cell: r => pct(r.chg_1y) },
]

export default function Screener({ command, run }: ViewProps) {
  const { data, error, loading } = useResource<{ rows: ScreenRow[]; set_aside: number }>('/api/terminal/screen', { freshMs: 30 * 60_000 })
  const [text, setText] = useState(command.args.join(' '))
  const [applied, setApplied] = useState(command.args.join(' '))
  const [sort, setSort] = useState<{ field: keyof typeof FIELDS; desc: boolean }>({ field: 'RETURN', desc: true })
  const parsed = parseConditions(applied)

  return (
    <div className="space-y-2">
      <form onSubmit={e => { e.preventDefault(); setApplied(text) }}>
        <input value={text} onChange={e => setText(e.target.value)} spellCheck={false}
          placeholder="Conditions, then Enter: PE<15 ROE>20 CAP>10 RETURN>=15"
          className="w-full font-mono text-[12.5px] uppercase placeholder:normal-case bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
      </form>
      {'error' in parsed ? <Fail message={parsed.error} /> : (
        <Fetched data={data} error={error} loading={loading}>
          {d => {
            const matched = sortBy(applyConditions(d.rows, parsed.conditions), FIELDS[sort.field].key, sort.desc)
            return (
              <>
                <p className="text-[11px] text-muted-foreground">
                  {matched.length} of {d.rows.length} companies match{matched.length > SHOWN ? `; showing the first ${SHOWN}` : ''}.
                  Click a heading to sort.{d.set_aside ? ` ${d.set_aside} expected returns above 60% a year were set aside as likely data faults.` : ''}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] tabular-nums">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                        <th className="py-1.5 px-2 text-left">Company</th>
                        {COLUMNS.map(c => (
                          <th key={c.field} className="py-1.5 px-2 text-right">
                            <button onClick={() => setSort(s => ({ field: c.field, desc: s.field === c.field ? !s.desc : true }))}
                              className={sort.field === c.field ? 'text-foreground' : 'hover:text-foreground'}>
                              {c.head}{sort.field === c.field ? (sort.desc ? ' ↓' : ' ↑') : ''}
                            </button>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {matched.slice(0, SHOWN).map(r => (
                        <tr key={r.symbol} onClick={() => run(`${r.symbol} DES`)}
                          className="border-b border-border/40 last:border-0 cursor-pointer hover:bg-muted/40">
                          <td className="py-1.5 px-2 text-left">
                            <b>{r.symbol}</b> <span className="text-muted-foreground truncate inline-block max-w-[12rem] align-bottom">{r.name}</span>
                          </td>
                          {COLUMNS.map(c => <td key={c.field} className="py-1.5 px-2 text-right">{c.cell(r)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )
          }}
        </Fetched>
      )}
      <Note>
        Fields: {Object.entries(FIELDS).map(([k, f]) => `${k} (${f.label})`).join(', ')}. US filers in Artha&rsquo;s
        store, from as-filed SEC numbers. Expected return is the Portfolio page&rsquo;s return rule.
      </Note>
    </div>
  )
}
