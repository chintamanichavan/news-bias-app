import { useState } from 'react'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { price } from '@/lib/terminal/numbers'
import { parse } from '@/lib/terminal/parse'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

interface Item {
  id: number; symbol: string; op: 'above' | 'below'; level: number; note: string | null
  created_at: string; triggered_at: string | null; triggered_price: number | null
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export default function Alerts({ command }: ViewProps) {
  const url = '/api/terminal/alerts'
  const { data, error, loading, reload } = useResource<{ alerts: Item[] }>(url)
  const [form, setForm] = useState({ security: command.security?.label ?? '', op: 'above', level: '', note: '' })
  const [problem, setProblem] = useState<string | null>(null)
  const [allowed, setAllowed] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied')

  async function change(fn: () => Promise<unknown>) {
    try {
      setProblem(null)
      await fn()
      invalidate(url)
      reload()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  function add(e: React.FormEvent) {
    e.preventDefault()
    const p = parse(form.security)
    if (!p.ok || !p.command.security) return setProblem('Type a security, for example AAPL.')
    const level = Number(form.level)
    if (!(level > 0)) return setProblem('Set a price level above zero.')
    void change(() => send('POST', url, { symbol: p.command.security!.symbol, op: form.op, level, note: form.note || null }))
      .then(() => setForm(f => ({ ...f, level: '', note: '' })))
  }

  const input = 'font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex flex-wrap gap-2 items-center text-[12px]">
        <input value={form.security} onChange={e => setForm({ ...form, security: e.target.value })} placeholder="Security" className={`${input} w-32 uppercase`} />
        <select value={form.op} onChange={e => setForm({ ...form, op: e.target.value })} className={input}>
          <option value="above">rises to</option><option value="below">falls to</option>
        </select>
        <input value={form.level} onChange={e => setForm({ ...form, level: e.target.value })} placeholder="Price" inputMode="decimal" className={`${input} w-24`} />
        <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Note (optional)" className={`${input} flex-1 min-w-[8rem]`} />
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Set alert</button>
      </form>
      {problem && <Fail message={problem} />}
      <Fetched data={data} error={error} loading={loading}>
        {d => d.alerts.length === 0 ? <Note>No alerts set.</Note> : (
          <Table rows={d.alerts} rowKey={a => String(a.id)}
            columns={[
              { head: 'Security', align: 'left', cell: a => <b>{a.symbol}</b> },
              { head: 'When', align: 'left', cell: a => `${a.op === 'above' ? 'rises to' : 'falls to'} ${price(a.level)}` },
              { head: 'Note', align: 'left', cell: a => a.note ?? '' },
              { head: 'Status', align: 'left', cell: a => (a.triggered_at
                ? <span className="text-emerald-600 dark:text-emerald-400">fired at {price(a.triggered_price)}, {when(a.triggered_at)}</span>
                : <span className="text-muted-foreground">waiting</span>) },
              { head: '', cell: a => <button onClick={() => void change(() => send('DELETE', `${url}/${a.id}`))} className="text-muted-foreground hover:text-red-600" aria-label="Delete alert">×</button> },
            ]} />
        )}
      </Fetched>
      <Note>
        Alerts are checked about once a minute while Artha is open in a browser, against quotes about 15 minutes late.
        {allowed !== 'granted' && typeof Notification !== 'undefined' && (
          <> <button className="underline" onClick={() => void Notification.requestPermission().then(setAllowed)}>Allow system notifications</button> to be told even when this tab is in the background.</>
        )}
      </Note>
    </div>
  )
}
