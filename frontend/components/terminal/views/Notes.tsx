import { useState } from 'react'
import { Fail, Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

interface Item { id: number; symbol: string | null; body: string; created_at: string }

export default function Notes({ command, run }: ViewProps) {
  const symbol = command.security?.symbol ?? null
  const url = `/api/terminal/notes${symbol ? `?symbol=${encodeURIComponent(symbol)}` : ''}`
  const { data, error, loading, reload } = useResource<{ notes: Item[] }>(url)
  const [body, setBody] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

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

  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); if (body.trim()) void change(() => send('POST', '/api/terminal/notes', { symbol, body })).then(() => setBody('')) }}>
        <textarea value={body} onChange={e => setBody(e.target.value)} rows={3}
          placeholder={symbol ? `A note on ${symbol}` : 'A note (type a security before NOTE to file it under one)'}
          className="w-full text-[13px] bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
        <button className="mt-1 text-[12px] px-3 py-1 rounded-md bg-foreground text-background">Save note</button>
      </form>
      {problem && <Fail message={problem} />}
      <Fetched data={data} error={error} loading={loading}>
        {d => d.notes.length === 0 ? <Note>No notes yet.</Note> : (
          <ul className="space-y-2">
            {d.notes.map(n => (
              <li key={n.id} className="border-b border-border/40 pb-2">
                <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
                  <span>
                    {new Date(n.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}
                    {n.symbol && !symbol && <> · <button onClick={() => run(`${n.symbol} DES`)} className="underline">{n.symbol}</button></>}
                  </span>
                  <button onClick={() => void change(() => send('DELETE', `/api/terminal/notes/${n.id}`))} className="hover:text-red-600">delete</button>
                </div>
                <p className="text-[13px] whitespace-pre-wrap mt-0.5">{n.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Fetched>
    </div>
  )
}
