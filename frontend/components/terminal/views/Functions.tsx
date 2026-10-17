import { useState } from 'react'
import type { ViewProps } from './types'
import { searchFunctions, type Status } from '@/lib/terminal/functions'

const CHIP: Record<Status, string> = {
  live: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  impossible: 'bg-muted text-muted-foreground',
}

const CHIP_TEXT: Record<Status, string> = { live: 'live', impossible: 'not possible' }

export default function Functions({ command, run }: ViewProps) {
  const [query, setQuery] = useState(command.args.join(' '))
  const found = searchFunctions(query)
  const groups = found.map(f => f.group).filter((g, i, all) => all.indexOf(g) === i)
  const counts = (s: Status) => found.filter(f => f.status === s).length
  return (
    <div className="space-y-3">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by code or name"
        className="w-full text-[12.5px] bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40" />
      <p className="text-[11px] text-muted-foreground">
        {found.length} functions: {counts('live')} live, {counts('impossible')} not possible on free data.
      </p>
      {groups.map(g => (
        <div key={g}>
          <p className="news-section-label mb-1">{g}</p>
          <ul className="text-[12.5px]">
            {found.filter(f => f.group === g).map(f => (
              <li key={f.code} className="flex items-center gap-2 py-0.5">
                <button onClick={() => run(f.status === 'live' ? f.code : `HELP ${f.code}`)}
                  className="w-12 text-left font-mono font-semibold hover:underline">{f.code}</button>
                <span className="flex-1 truncate" title={f.why}>{f.name}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${CHIP[f.status]}`}>{CHIP_TEXT[f.status]}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
