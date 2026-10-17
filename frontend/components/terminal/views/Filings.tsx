import { useState } from 'react'
import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { day } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Filing { form: string; what: string; filed: string; period: string | null; url: string }

const KINDS: [string, (f: Filing) => boolean][] = [
  ['All', () => true],
  ['Reports', f => ['10-K', '10-Q', '20-F', '6-K', '10-K/A', '10-Q/A'].includes(f.form)],
  ['Events', f => f.form.startsWith('8-K')],
  ['Insiders', f => ['3', '4', '5', '144'].includes(f.form)],
  ['Proxy', f => f.form.includes('14A')],
]

export default function Filings({ command }: ViewProps) {
  const [kind, setKind] = useState(0)
  const sym = command.security!.symbol
  const { data, error, loading } = useResource<{ name: string; industry: string; filings: Filing[] }>(
    `/api/terminal/filings/${encodeURIComponent(sym)}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const shown = d.filings.filter(KINDS[kind][1])
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {KINDS.map(([label], i) => (
                <button key={label} onClick={() => setKind(i)}
                  className={`text-[11px] px-2 py-0.5 rounded-full ${i === kind
                    ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
            {shown.length === 0 ? <Note>None of this kind among the latest {d.filings.length} filings.</Note> : (
              <Table rows={shown} rowKey={f => f.url}
                columns={[
                  { head: 'Filed', align: 'left', cell: f => day(f.filed) },
                  { head: 'Form', align: 'left', cell: f => <b>{f.form}</b> },
                  { head: 'What', align: 'left', cell: f => <a href={f.url} target="_blank" rel="noreferrer" className="hover:underline">{f.what}</a> },
                  { head: 'Period', cell: f => (f.period ? day(f.period) : '—') },
                ]} />
            )}
            <Note>{d.name} · {d.industry}. Latest {d.filings.length} filings from SEC EDGAR; each opens the document.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
