import { useState } from 'react'
import { Fail, Note } from '../kit'
import type { ViewProps } from './types'
import { download, objectsToCsv } from '@/lib/terminal/csv'

// Whole datasets, beyond what any one screen shows. Every panel also has a
// CSV button for the tables on screen.
const DATASETS: { key: string; label: string; needs: 'security' | 'none'; build: (sym: string) => Promise<Record<string, unknown>[]> }[] = [
  {
    key: 'history', label: 'Five years of daily prices', needs: 'security',
    build: async sym => (await get<{ bars: Record<string, unknown>[] }>(`/api/terminal/bars/${encodeURIComponent(sym)}?span=5y`)).bars,
  },
  {
    key: 'screen', label: 'The full EQS screener table (about 1,650 companies)', needs: 'none',
    build: async () => (await get<{ rows: Record<string, unknown>[] }>('/api/terminal/screen')).rows,
  },
  {
    key: 'watchlists', label: 'Every watchlist and its securities', needs: 'none',
    build: async () => {
      const { lists } = await get<{ lists: { name: string }[] }>('/api/terminal/watchlists')
      const out: Record<string, unknown>[] = []
      for (const l of lists) {
        const w = await get<{ rows: Record<string, unknown>[] }>(`/api/terminal/watchlists/${encodeURIComponent(l.name)}`)
        w.rows.forEach(r => out.push({ list: l.name, symbol: r.symbol, name: r.name, price: r.price, change_pct: r.change_pct }))
      }
      return out
    },
  },
  { key: 'notes', label: 'All notes', needs: 'none', build: async () => (await get<{ notes: Record<string, unknown>[] }>('/api/terminal/notes')).notes },
  { key: 'alerts', label: 'All alerts', needs: 'none', build: async () => (await get<{ alerts: Record<string, unknown>[] }>('/api/terminal/alerts')).alerts },
]

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Could not fetch ${url} (${r.status})`)
  return r.json() as Promise<T>
}

export default function Export({ command }: ViewProps) {
  const sym = command.security?.symbol ?? null
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  async function save(d: (typeof DATASETS)[number]) {
    setBusy(d.key); setProblem(null)
    try {
      const rows = await d.build(sym ?? '')
      if (rows.length === 0) throw new Error('Nothing to export yet.')
      download(`${d.needs === 'security' ? `${sym}-` : ''}${d.key}`, objectsToCsv(rows as Record<string, string>[]))
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {DATASETS.map(d => {
          const blocked = d.needs === 'security' && !sym
          return (
            <li key={d.key} className="flex items-center justify-between gap-3 text-[13px]">
              <span>{d.label}{d.needs === 'security' ? (sym ? ` for ${sym}` : ' (type a security before EXPT)') : ''}</span>
              <button disabled={blocked || busy !== null} onClick={() => void save(d)}
                className="text-[12px] px-3 py-1 rounded-md bg-foreground text-background disabled:opacity-40">
                {busy === d.key ? 'Saving…' : 'Download CSV'}
              </button>
            </li>
          )
        })}
      </ul>
      {problem && <Fail message={problem} />}
      <Note>Every panel also has a CSV button in its header that saves the tables on screen, as shown.</Note>
    </div>
  )
}
