import { Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { useResource } from '@/lib/useResource'

interface Story {
  id: string
  title: string
  url: string | null
  published: string | null
  source_id?: string | null
  sentiment_score?: number | null
}

// CN: stories naming the company. N: the last day's market news. TOP: the
// stories the most outlets carried. NSE: a search. All from Artha's own corpus.
function urlFor(fn: string, symbol: string, query: string): string | null {
  if (fn === 'NSE') return query ? `/api/terminal/news?q=${encodeURIComponent(query)}` : null
  if (fn === 'CN') return `/api/markets/${encodeURIComponent(symbol)}/news?limit=30`
  if (fn === 'TOP') return '/api/top?limit=25'
  return '/api/articles?per_page=40&lookback_hours=24'
}

function ago(iso: string | null): string {
  if (!iso) return ''
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 60) return `${Math.max(1, minutes)}m`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

export default function News({ command }: ViewProps) {
  const query = command.args.join(' ')
  const url = urlFor(command.fn, command.security?.symbol ?? '', query)
  const { data, error, loading } = useResource<{ articles?: Story[]; stories?: Story[] }>(url)
  if (!url) return <Note>Type words after NSE, for example NSE fed rates.</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const stories = d.articles ?? d.stories ?? []
        if (stories.length === 0) return <Note>No stories in the corpus for this{query ? ` in the last 30 days` : ' yet'}.</Note>
        return (
          <ol className="divide-y divide-border/50">
            {stories.map(s => (
              <li key={s.id} className="py-1.5 flex gap-3 text-[12.5px] leading-snug">
                <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{ago(s.published)}</span>
                <a href={`/article/${s.id}`} className="flex-1 hover:underline">{s.title}</a>
                {s.source_id && <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{s.source_id}</span>}
              </li>
            ))}
          </ol>
        )
      }}
    </Fetched>
  )
}
