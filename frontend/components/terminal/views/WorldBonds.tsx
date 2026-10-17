import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useResource } from '@/lib/useResource'

interface Country {
  country: string; source: string; date: string | null; yields: Record<string, number | null>
  change_10y_bp: number | null; spread_to_us_bp: number | null; slope_2s10s_bp: number | null; note: string | null
}

const y = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))
const bp = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(0)}`)
// rising yields are falling bond prices, so a rise is shown in red
const rateTone = (v: number | null) => (v == null || v === 0 ? '' : v > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')

/** WB: government bond yields by country, each from its own official source. */
export default function WorldBonds({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ tenors: string[]; countries: Country[] }>('/api/terminal/wb')
  return (
    <div className="space-y-3">
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <>
            <Table rows={d.countries} rowKey={c => c.country} onRow={c => c.country === 'United States' && run('GC')}
              columns={[
                { head: 'Country', align: 'left', cell: c => <b>{c.country}</b> },
                ...d.tenors.map(t => ({ head: t, cell: (c: Country) => y(c.yields[t]) })),
                { head: '10Y day bp', cell: c => bp(c.change_10y_bp), className: c => rateTone(c.change_10y_bp) },
                { head: '10Y vs US bp', cell: c => bp(c.spread_to_us_bp) },
                { head: '2s10s bp', cell: c => bp(c.slope_2s10s_bp) },
                { head: 'As of', align: 'left', cell: c => <span className="text-muted-foreground">{c.date ?? 'unavailable'}</span> },
                { head: 'Source', align: 'left', cell: c => <span className="text-muted-foreground">{c.source}</span> },
              ]} />
            <ul className="text-[11.5px] text-muted-foreground list-disc pl-5 space-y-0.5">
              {d.countries.filter(c => c.note).map(c => <li key={c.country}>{c.country}: {c.note}</li>)}
            </ul>
          </>
        )}
      </Fetched>
      <Note>
        Yields in percent, each from the country&apos;s treasury or central bank, published after its own close, so dates
        can differ by a day. Click the United States for its full curve (GC). Italy, France, Spain, Australia and others
        need a source that is both free and official; they are not shown rather than shown from a scraped quote.
      </Note>
    </div>
  )
}
