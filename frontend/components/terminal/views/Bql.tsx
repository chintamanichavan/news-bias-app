import { useState } from 'react'
import { Fail, Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { FIELDS, parseBql, run as runQuery, type Result } from '@/lib/terminal/bql'
import type { ScreenRow } from '@/lib/terminal/screen'
import { useResource } from '@/lib/useResource'

const EXAMPLES = [
  'SELECT symbol, name, pe, roe, return WHERE roe > 20 AND pe < 15 ORDER BY return DESC LIMIT 20',
  'SELECT symbol, yield, growth WHERE yield >= 3 AND growth > 5 ORDER BY yield DESC',
  'SELECT COUNT(*), MEDIAN(pe), AVG(roe) WHERE cap > 100',
  'SELECT symbol, chg, high WHERE high < -40 AND return >= 15',
]

const SHOWN = 200

function cell(v: string | number | null): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Math.abs(v) >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(Math.round(v * 100) / 100)
  return v
}

export default function Bql({ command }: ViewProps) {
  const { data, error, loading } = useResource<{ rows: ScreenRow[] }>('/api/terminal/screen', { freshMs: 30 * 60_000 })
  const [text, setText] = useState(command.args.join(' ') || EXAMPLES[0])
  const [query, setQuery] = useState(text)

  let result: Result | null = null
  let problem: string | null = null
  if (data) {
    try {
      result = runQuery(parseBql(query), data.rows)
    } catch (e) {
      problem = (e as Error).message
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); setQuery(text) }}>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} spellCheck={false}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setQuery(text) } }}
          className="w-full font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
        <div className="flex items-center gap-3 mt-1">
          <button className="text-[12px] px-3 py-1 rounded-md bg-foreground text-background">Run</button>
          <span className="text-[11px] text-muted-foreground">Ctrl-Enter runs it too.</span>
        </div>
      </form>
      <Fetched data={data} error={error} loading={loading}>
        {() => problem ? <Fail message={problem} /> : result && (
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">
              {result.matched} companies match{result.rows.length > SHOWN ? `; showing the first ${SHOWN}` : ''}.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    {result.columns.map(c => <th key={c} className="py-1.5 px-2 text-right first:text-left">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, SHOWN).map((r, i) => (
                    <tr key={i} className="border-b border-border/40 last:border-0">
                      {r.map((v, j) => <td key={j} className="py-1.5 px-2 text-right first:text-left">{cell(v)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Fetched>
      <div>
        <p className="news-section-label mb-1">Examples</p>
        <ul className="space-y-0.5">
          {EXAMPLES.map(ex => (
            <li key={ex}><button onClick={() => { setText(ex); setQuery(ex) }} className="font-mono text-[11.5px] text-left hover:underline">{ex}</button></li>
          ))}
        </ul>
      </div>
      <Note>
        SELECT fields or totals (COUNT, AVG, MEDIAN, MIN, MAX, SUM), then optional WHERE with AND, OR and brackets,
        ORDER BY … DESC and LIMIT. Fields: {Object.entries(FIELDS).map(([k, f]) => `${k.toLowerCase()} (${f.label})`).join(', ')}.
        Market cap is in billions. It runs over the EQS table of US filers.
      </Note>
    </div>
  )
}
