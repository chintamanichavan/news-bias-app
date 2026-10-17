import { useEffect, useState } from 'react'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { parse } from '@/lib/terminal/parse'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

interface Row {
  symbol: string; name?: string; price?: number; change?: number; change_pct?: number; volume?: number
  bid?: number | null; ask?: number | null; market_state?: string; missing?: boolean
}

const REFRESH_MS = 60_000

export default function Watchlist({ command, run }: ViewProps) {
  const listArg = command.args.join(' ')
  const name = listArg || 'Main'
  const url = `/api/terminal/watchlists/${encodeURIComponent(name)}`
  const lists = useResource<{ lists: { name: string; count: number }[] }>('/api/terminal/watchlists')
  const { data, error, loading, reload } = useResource<{ rows: Row[] }>(url, { freshMs: REFRESH_MS })
  const [adding, setAdding] = useState(command.security?.label ?? '')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS)
    return () => clearInterval(t)
  }, [reload])

  async function change(fn: () => Promise<unknown>) {
    try {
      setProblem(null)
      await fn()
      invalidate(url)
      invalidate('/api/terminal/watchlists')
      reload()
      lists.reload()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const p = parse(adding)
    if (!p.ok || !p.command.security) return setProblem(p.ok ? 'Type a security, for example AAPL or VOD LN EQUITY.' : p.error)
    const symbol = p.command.security.symbol
    void change(() => send('POST', url, { symbol })).then(() => setAdding(''))
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1">
        {(lists.data?.lists ?? []).map(l => (
          <button key={l.name} onClick={() => run(`W ${l.name}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full ${l.name === name
              ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {l.name} · {l.count}
          </button>
        ))}
        <span className="text-[11px] text-muted-foreground ml-1">New list: type W and its name</span>
      </div>
      <form onSubmit={add} className="flex gap-2">
        <input value={adding} onChange={e => setAdding(e.target.value)} placeholder={`Add a security to ${name}`}
          className="flex-1 font-mono text-[12.5px] uppercase placeholder:normal-case bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
        <button className="text-[12px] px-3 rounded-md bg-foreground text-background">Add</button>
      </form>
      {problem && <Fail message={problem} />}
      <Fetched data={data} error={error} loading={loading}>
        {d => d.rows.length === 0 ? <Note>{name} is empty. Add a security above.</Note> : (
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)}
            columns={[
              { head: 'Security', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.missing ? 'no quote' : r.name}</span></span> },
              { head: 'Last', cell: r => price(r.price) },
              { head: 'Change', cell: r => pct(r.change_pct), className: r => `font-semibold ${tone(r.change_pct)}` },
              { head: 'Bid', cell: r => price(r.bid) },
              { head: 'Ask', cell: r => price(r.ask) },
              { head: 'Volume', cell: r => big(r.volume) },
              { head: '', cell: r => (
                <button onClick={e => { e.stopPropagation(); void change(() => send('DELETE', `${url}/${encodeURIComponent(r.symbol)}`)) }}
                  className="text-muted-foreground hover:text-red-600" aria-label={`Remove ${r.symbol}`}>×</button>) },
            ]} />
        )}
      </Fetched>
      <Note>Refreshes every minute; quotes about 15 minutes late. Click a row for its description.</Note>
    </div>
  )
}
