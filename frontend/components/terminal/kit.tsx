// Small pieces every terminal screen uses: a labelled value grid, a dense
// table, and the three states a fetch can be in.

import ArthaLoader from '@/components/ArthaLoader'
import { big, day, pct } from '@/lib/terminal/numbers'

const LABELS: Record<string, string> = {
  pe: 'P/E', peg: 'PEG', eps: 'EPS', roe: 'ROE', roa: 'ROA', ev: 'EV', ebitda: 'EBITDA',
  fcf: 'FCF', rnd: 'R&D', iv: 'IV', oi: 'OI', atm: 'ATM', var: 'VaR', cvar: 'CVaR',
}

/** "trailing_pe" -> "Trailing P/E", "roe_pct" -> "ROE %" */
export function label(key: string): string {
  const words = key.split('_').map(w => (w === 'pct' ? '%' : LABELS[w] ?? w))
  const text = words.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Formats a value by what its key says it is. */
export function value(key: string, v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? day(v.slice(0, 10)) : v
  if (typeof v !== 'number') return String(v)
  if (key.endsWith('_pct')) return pct(v, false)
  if (MONEY_WORDS.some(w => key.includes(w))) return big(v)
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

// keys holding amounts or counts large enough to shorten: 3.9T, 26.9M
const MONEY_WORDS = [
  'cap', 'value', 'cash', 'debt', 'volume', 'float', 'flow', 'revenue', 'income',
  'profit', 'assets', 'equity', 'shares', 'capex', 'buyback', 'dividends_paid', 'rnd', 'taxes',
]

export function Kv({ data, title }: { data: Record<string, unknown> | null | undefined; title?: string }) {
  if (!data) return null
  const rows = Object.entries(data).filter(([, v]) => v != null)
  if (rows.length === 0) return null
  return (
    <div>
      {title && <p className="news-section-label mb-1.5">{title}</p>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground truncate">{label(k)}</dt>
            <dd className="text-right tabular-nums font-medium">{value(k, v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export interface Column<T> {
  head: string
  cell: (row: T) => React.ReactNode
  align?: 'left' | 'right'
  className?: (row: T) => string
}

export function Table<T>({ rows, columns, onRow, rowKey }: {
  rows: T[]
  columns: Column<T>[]
  rowKey: (row: T, i: number) => string
  onRow?: (row: T) => void
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
            {columns.map(c => (
              <th key={c.head} className={`py-1.5 px-2 font-semibold ${c.align === 'left' ? 'text-left' : 'text-right'}`}>
                {c.head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r, i)} onClick={onRow ? () => onRow(r) : undefined}
              className={`border-b border-border/40 last:border-0 ${onRow ? 'cursor-pointer hover:bg-muted/40' : ''}`}>
              {columns.map(c => (
                <td key={c.head}
                  className={`py-1.5 px-2 ${c.align === 'left' ? 'text-left' : 'text-right'} ${c.className?.(r) ?? ''}`}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Loading() {
  return <ArthaLoader className="h-48" />
}

export function Note({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground leading-relaxed">{children}</p>
}

export function Fail({ message }: { message: string }) {
  return <p className="text-[12px] text-red-600 dark:text-red-400">{message}</p>
}

/** The usual three states of a fetch, so screens only render the happy one. */
export function Fetched<T>({ data, error, loading, children }: {
  data: T | null
  error: string | null
  loading: boolean
  children: (data: T) => React.ReactNode
}) {
  if (data) return <>{children(data)}</>
  if (error) return <Fail message={error} />
  if (loading) return <Loading />
  return null
}
