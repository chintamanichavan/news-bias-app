import { useState } from 'react'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, price, tone } from '@/lib/terminal/numbers'
import { parse } from '@/lib/terminal/parse'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

interface Order {
  id: number; symbol: string; side: 'buy' | 'sell'; quantity: number; type: 'market' | 'limit'
  limit_price: number | null; status: 'working' | 'filled' | 'cancelled'; created_at: string
  arrival_mid: number | null; filled_at: string | null; fill_price: number | null
}

interface Position { symbol: string; quantity: number; cost: number; price: number | null; realized: number; unrealized: number }

const URL = '/api/terminal/orders'
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })

export default function Emsx({ command, run }: ViewProps) {
  const { data, error, loading, reload } = useResource<{ orders: Order[]; positions: Position[] }>(URL, { freshMs: 0 })
  const [form, setForm] = useState({ security: command.security?.label ?? '', side: 'buy', quantity: '', type: 'market', limit: '' })
  const [problem, setProblem] = useState<string | null>(null)
  const [placed, setPlaced] = useState<string | null>(null)

  async function change(fn: () => Promise<unknown>) {
    try {
      setProblem(null)
      await fn()
      invalidate(URL)
      reload()
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  function place(e: React.FormEvent) {
    e.preventDefault()
    setPlaced(null)
    const p = parse(form.security)
    if (!p.ok || !p.command.security) return setProblem('Type a security, for example AAPL.')
    const quantity = Number(form.quantity)
    if (!(quantity > 0)) return setProblem('Set a quantity above zero.')
    const limit = Number(form.limit)
    if (form.type === 'limit' && !(limit > 0)) return setProblem('A limit order needs a limit price above zero.')
    void change(async () => {
      const o = await send<Order>('POST', URL, {
        symbol: p.command.security!.symbol, side: form.side, quantity, type: form.type,
        limit_price: form.type === 'limit' ? limit : null,
      })
      setPlaced(o.status === 'filled'
        ? `Filled: ${o.side} ${o.quantity} ${o.symbol} at ${price(o.fill_price)}.`
        : `Working: ${o.side} ${o.quantity} ${o.symbol} at ${price(o.limit_price)} or better.`)
      setForm(f => ({ ...f, quantity: '', limit: '' }))
    })
  }

  const input = 'font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <div className="space-y-3">
      <form onSubmit={place} className="flex flex-wrap gap-2 items-center text-[12px]">
        <select value={form.side} onChange={e => setForm({ ...form, side: e.target.value })} className={input} aria-label="Side">
          <option value="buy">Buy</option><option value="sell">Sell</option>
        </select>
        <input value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="Quantity" inputMode="decimal" className={`${input} w-24`} />
        <input value={form.security} onChange={e => setForm({ ...form, security: e.target.value })} placeholder="Security" className={`${input} w-28 uppercase`} />
        <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className={input} aria-label="Order type">
          <option value="market">at market</option><option value="limit">with a limit</option>
        </select>
        {form.type === 'limit' && (
          <input value={form.limit} onChange={e => setForm({ ...form, limit: e.target.value })} placeholder="Limit" inputMode="decimal" className={`${input} w-24`} />
        )}
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Place paper order</button>
        {placed && <span className="text-emerald-600 dark:text-emerald-400">{placed}</span>}
      </form>
      {problem && <Fail message={problem} />}
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <>
            {d.positions.some(p => p.quantity !== 0 || p.realized !== 0) && (
              <>
                <p className="news-section-label">Paper positions</p>
                <Table rows={d.positions} rowKey={p => p.symbol} onRow={p => run(`${p.symbol} DES`)}
                  columns={[
                    { head: 'Security', align: 'left', cell: p => <b>{p.symbol}</b> },
                    { head: 'Quantity', cell: p => p.quantity.toLocaleString('en-US') },
                    { head: 'Average cost', cell: p => price(p.quantity ? p.cost : null) },
                    { head: 'Price', cell: p => price(p.price) },
                    { head: 'Unrealized', cell: p => big(p.unrealized), className: p => tone(p.unrealized) },
                    { head: 'Realized', cell: p => big(p.realized), className: p => tone(p.realized) },
                  ]} />
              </>
            )}
            <p className="news-section-label">Orders</p>
            {d.orders.length === 0 ? <Note>No paper orders yet.</Note> : (
              <Table rows={d.orders} rowKey={o => String(o.id)}
                columns={[
                  { head: 'Placed', align: 'left', cell: o => when(o.created_at) },
                  { head: 'Order', align: 'left', cell: o => <span><b className={o.side === 'buy' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>{o.side}</b> {o.quantity.toLocaleString('en-US')} <b>{o.symbol}</b></span> },
                  { head: 'Type', align: 'left', cell: o => (o.type === 'market' ? 'market' : `limit ${price(o.limit_price)}`) },
                  { head: 'Arrival', cell: o => price(o.arrival_mid) },
                  { head: 'Fill', cell: o => price(o.fill_price) },
                  { head: 'Status', align: 'left', cell: o => (o.status === 'filled'
                    ? <span className="text-emerald-600 dark:text-emerald-400">filled {o.filled_at ? when(o.filled_at) : ''}</span>
                    : <span className="text-muted-foreground">{o.status}</span>) },
                  { head: '', cell: o => o.status === 'working'
                    ? <button onClick={() => void change(() => send('DELETE', `${URL}/${o.id}`))} className="text-muted-foreground hover:text-red-600">cancel</button>
                    : '' },
                ]} />
            )}
          </>
        )}
      </Fetched>
      <Note>
        Paper orders only: nothing is sent to a broker. A market order buys at the ask and sells at the bid, so it pays
        the spread. A limit order waits and is checked about once a minute while Artha is open. Quotes are about 15
        minutes late, and outside market hours they are the last ones of the day. No commission is charged. Paper
        positions are separate from PRTU. TCA measures what the fills cost.
      </Note>
    </div>
  )
}
