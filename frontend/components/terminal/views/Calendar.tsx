import { Fetched, Note, Table } from '../kit'
import { useResource } from '@/lib/useResource'

interface Event { date: string; time: string | null; release: string; source: string }

const SOURCE_STYLE: Record<string, string> = {
  Fed: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  BEA: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  Census: 'bg-muted text-muted-foreground',
}

/** "Tue 20 Oct" */
function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Calendar() {
  const { data, error, loading } = useResource<{ events: Event[]; days: number; unavailable: string[] }>('/api/terminal/calendar?days=45')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          {d.events.length === 0 ? <Note>Nothing scheduled in the next {d.days} days from these sources.</Note> : (
            <Table
              rows={d.events}
              rowKey={(e, i) => `${e.date}-${i}`}
              columns={[
                { head: 'Day', align: 'left', cell: e => <span className="whitespace-nowrap">{weekday(e.date)}</span> },
                { head: 'Time (ET)', align: 'left', cell: e => e.time ?? '—' },
                { head: 'Release', align: 'left', cell: e => e.release },
                { head: 'From', cell: e => <span className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_STYLE[e.source] ?? ''}`}>{e.source}</span> },
              ]}
            />
          )}
          <Note>Next {d.days} days. Not available: {d.unavailable.join('; ')}.</Note>
        </div>
      )}
    </Fetched>
  )
}
