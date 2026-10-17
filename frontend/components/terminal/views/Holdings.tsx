import { useState } from 'react'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { parseHoldings } from '@/lib/terminal/holdings'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

interface Position {
  symbol: string; name?: string; quantity: number; price: number | null; value: number | null
  gain: number | null; weight: number | null; change_pct?: number | null
}

const URL = '/api/terminal/holdings'

export default function Holdings({ run }: ViewProps) {
  const { data, error, loading, reload } = useResource<{ positions: Position[]; value: number }>(URL)
  const [text, setText] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [saved, setSaved] = useState<string | null>(null)

  async function save(mode: 'replace' | 'add') {
    const { rows, errors } = parseHoldings(text)
    setProblems(errors)
    setSaved(null)
    if (rows.length === 0) return setProblems(p => (p.length ? p : ['Nothing to save: paste lines like AAPL,10,150.']))
    try {
      if (mode === 'replace') await send('PUT', URL, { holdings: rows })
      else for (const r of rows) await send('POST', URL, r)
      setSaved(`${mode === 'replace' ? 'Replaced the book with' : 'Added'} ${rows.length} line${rows.length === 1 ? '' : 's'}.`)
      setText('')
      invalidate(URL)
      reload()
    } catch (e) {
      setProblems([(e as Error).message])
    }
  }

  async function load(file: File) {
    setText(await file.text())
  }

  return (
    <div className="space-y-3">
      <textarea value={text} onChange={e => setText(e.target.value)} rows={4} spellCheck={false}
        placeholder={'Paste holdings, one per line: symbol, quantity, cost per share, date bought\nAAPL,10,150,2024-01-02\nKO 40 60'}
        className="w-full font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <button onClick={() => void save('replace')} className="px-3 py-1 rounded-md bg-foreground text-background">Replace the book</button>
        <button onClick={() => void save('add')} className="px-3 py-1 rounded-md bg-muted hover:bg-muted/80">Add to it</button>
        <label className="px-3 py-1 rounded-md bg-muted hover:bg-muted/80 cursor-pointer">
          Load a CSV file<input type="file" accept=".csv,.txt" hidden onChange={e => e.target.files?.[0] && void load(e.target.files[0])} />
        </label>
        {saved && <span className="text-emerald-600 dark:text-emerald-400">{saved}</span>}
      </div>
      {problems.map(p => <Fail key={p} message={p} />)}
      <Fetched data={data} error={error} loading={loading}>
        {d => d.positions.length === 0 ? <Note>No holdings yet. Paste them above.</Note> : (
          <>
            <p className="text-[13px] tabular-nums">Value <b>${big(d.value)}</b></p>
            <Table rows={d.positions} rowKey={p => p.symbol} onRow={p => run(`${p.symbol} DES`)}
              columns={[
                { head: 'Security', align: 'left', cell: p => <span><b>{p.symbol}</b> <span className="text-muted-foreground">{p.name}</span></span> },
                { head: 'Quantity', cell: p => p.quantity.toLocaleString('en-US') },
                { head: 'Price', cell: p => price(p.price) },
                { head: 'Today', cell: p => pct(p.change_pct ?? null), className: p => tone(p.change_pct ?? null) },
                { head: 'Value', cell: p => big(p.value) },
                { head: 'Weight', cell: p => pct(p.weight == null ? null : p.weight * 100, false) },
                { head: 'Gain', cell: p => big(p.gain), className: p => tone(p.gain) },
              ]} />
          </>
        )}
      </Fetched>
      <Note>
        Your holdings, kept on this machine only. MARS measures their risk and ATTR explains their return. Gain needs a
        cost on every lot. This is separate from PORT, which is your research watchlist.
      </Note>
    </div>
  )
}
