import { useState } from 'react'
import { TimeSeriesChart } from '@/components/quantviz'
import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// Topic and source screens over Artha's news corpus, GN, MMN, NL, TREN,
// NRC, RNS, BBNI and CNP.

interface Story { id: string; title: string; url: string | null; published: string | null; source_id?: string | null; sentiment_score?: number | null }

function ago(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (isNaN(t)) return ''
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 60 ? `${Math.max(1, m)}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

export function Stories({ stories, external = false }: { stories: Story[]; external?: boolean }) {
  if (stories.length === 0) return <Note>No stories match.</Note>
  return (
    <ol className="divide-y divide-border/50">
      {stories.map((s, i) => (
        <li key={`${s.id}${i}`} className="py-1.5 flex gap-3 text-[12.5px] leading-snug">
          <span className="w-8 shrink-0 text-right tabular-nums text-muted-foreground">{ago(s.published)}</span>
          <a href={external ? s.url ?? '#' : `/article/${s.id}`} target={external ? '_blank' : undefined} rel="noopener noreferrer" className="flex-1 hover:underline">{s.title}</a>
          {s.source_id && <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">{s.source_id}</span>}
        </li>
      ))}
    </ol>
  )
}

const CORPUS = "From Artha's own news corpus: about 26,000 stories a month from two dozen outlets."

export function TopicNews({ command }: ViewProps) {
  const subject = command.args.join(' ')
  const { data, error, loading } = useResource<{ title: string; stories: Story[]; words?: string[] }>(
    `/api/terminal/newsfilter/${command.fn}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}`, { freshMs: 5 * 60_000 })
  const external = command.fn === 'TEL'
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-2">
          <p className="news-section-label">{d.title}</p>
          <Stories stories={d.stories} external={external} />
          <Note>
            {external ? 'Headlines from the last two days through Google News, because the Telegraph blocks automated readers; links open at Google News.'
              : d.words ? `Stories from the last week that mention any of: ${d.words.map(w => w.trim()).join(', ')}. Narrow it with a subject: ${command.fn} ${command.fn === 'ENRG' ? 'solar' : 'China'}. ${CORPUS}`
                : `The outlet's stories of the last three days. ${CORPUS}`}
          </Note>
        </div>
      )}
    </Fetched>
  )
}

interface Coverage { symbol: string; name: string | null; words: string[]; days: { date: string; stories: number; tone: number | null }[]; stories: Story[]; total: number }

export function CompanyCoverage({ command }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useResource<Coverage>(`/api/terminal/newsfilter/GN?symbol=${encodeURIComponent(sec.symbol)}`, { freshMs: 30 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px]">{d.total} stories in 90 days naming {d.words.join(' or ')}.</p>
          {d.days.length > 1 && (
            <>
              <p className="news-section-label">Stories a day</p>
              <TimeSeriesChart H={130} series={[{ label: 'stories', cls: 'stroke-indigo-500', fill: 'fill-indigo-500/10', points: d.days.map(x => ({ t: x.date, v: x.stories })) }]} yFmt={v => v.toFixed(0)} />
              <p className="news-section-label">Average tone</p>
              <TimeSeriesChart H={110} zeroLine series={[{ label: 'tone', cls: 'stroke-amber-500', points: d.days.filter(x => x.tone != null).map(x => ({ t: x.date, v: x.tone! })) }]} yFmt={v => v.toFixed(2)} />
            </>
          )}
          <Stories stories={d.stories} />
          <Note>Coverage and tone of the company in Artha&apos;s corpus; tone is Artha&apos;s sentiment score, from −1 to +1. {CORPUS}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface MoverNews { symbol: string; name: string | null; price: number | null; change_pct: number | null; stories: Story[] }

export function MoversNews({ command, run }: ViewProps) {
  const isNL = command.fn === 'NL'
  const { data, error, loading } = useResource<{ rows: MoverNews[]; list?: string | null; lists?: string[] }>(
    `/api/terminal/newsfilter/${command.fn}${isNL && command.args[0] ? `?name=${encodeURIComponent(command.args.join(' '))}` : ''}`, { freshMs: 5 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          {isNL && (d.list ? <p className="text-[13px]">News for watchlist <b>{d.list}</b>{d.lists && d.lists.length > 1 ? ` (others: ${d.lists.filter(l => l !== d.list).join(', ')})` : ''}.</p>
            : <Note>No watchlists yet. Make one with W.</Note>)}
          {d.rows.map(r => (
            <div key={r.symbol}>
              <p className="text-[12.5px]"><button className="font-bold hover:underline" onClick={() => run(`${r.symbol} DES`)}>{r.symbol}</button>{' '}
                <span className="text-muted-foreground">{r.name}</span>{' '}
                {r.change_pct != null && <span className={`tabular-nums ${tone(r.change_pct)}`}>{price(r.price)} {pct(r.change_pct)}</span>}</p>
              {r.stories.length ? <Stories stories={r.stories} /> : <p className="text-[11.5px] text-muted-foreground pl-11">No stories in the corpus.</p>}
            </div>
          ))}
          <Note>{isNL ? 'The last week’s stories naming each name on the list.' : 'The day’s ten biggest gainers and losers and the stories of the last three days that name them; small companies often move with no story at all.'} {CORPUS}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Trend { term: string; count: number; before_per_day: number; lift: number; examples: string[] }

export function NewsTrends({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ stories_today: number; stories_before: number; terms: Trend[] }>('/api/terminal/newsfilter/TREN', { freshMs: 10 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.terms} rowKey={t => t.term} onRow={t => run(`NSE ${t.term}`)} columns={[
            { head: 'In the headlines', align: 'left', cell: t => <b>{t.term}</b> },
            { head: 'Last day', cell: t => t.count },
            { head: 'Usual day', cell: t => t.before_per_day.toFixed(1) },
            { head: 'Times usual', cell: t => `${t.lift.toFixed(0)}×` },
            { head: 'For example', align: 'left', cell: t => <span className="text-muted-foreground">{t.examples[0] ?? ''}</span> },
          ]} />
          <Note>Words and two-word phrases far more common in the last day&apos;s {d.stories_today} headlines than in the {d.stories_before} of the two weeks before. Click one to search for it. {CORPUS}</Note>
        </div>
      )}
    </Fetched>
  )
}

export function Outlets() {
  const { data, error, loading } = useResource<{ outlets: { source_id: string; stories: number; tone: number | null; latest: string }[] }>('/api/terminal/newsfilter/NRC', { freshMs: 30 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.outlets} rowKey={o => o.source_id} columns={[
            { head: 'Outlet', align: 'left', cell: o => <b>{o.source_id}</b> },
            { head: 'Stories, 30 days', cell: o => o.stories.toLocaleString('en-US') },
            { head: 'Average tone', cell: o => (o.tone == null ? '—' : o.tone.toFixed(3)), className: o => tone(o.tone) },
            { head: 'Latest', align: 'left', cell: o => ago(o.latest) },
          ]} />
          <Note>The outlets Artha reads, from its own collector. Bloomberg and FT items are headlines only; the stories sit behind their paywalls. NYT, WSJ and WPT show one outlet&apos;s stories.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Filing { form: string | null; company: string; cik: string | null; updated: string; url: string | null; items: string[]; item_names: string[] }

export function RegulatoryNews() {
  const { data, error, loading } = useResource<{ rows: Filing[] }>('/api/terminal/newsfilter/RNS', { freshMs: 2 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={(r, i) => `${r.url}${i}`} onRow={r => r.url && window.open(r.url, '_blank', 'noopener')} columns={[
            { head: 'Filed', align: 'left', cell: r => r.updated.slice(0, 16).replace('T', ' ') },
            { head: 'Company', align: 'left', cell: r => <b>{r.company}</b> },
            { head: 'Form', align: 'left', cell: r => r.form },
            { head: 'What it reports', align: 'left', cell: r => r.item_names.join(', ') },
          ]} />
          <Note>The SEC&apos;s live list of 8-K filings, the US counterpart of the UK&apos;s Regulatory News Service (which is licensed): results, deals, executive changes, bankruptcies, as companies file them.</Note>
        </div>
      )}
    </Fetched>
  )
}

const INDUSTRIES = ['banks', 'semiconductors', 'oil', 'airlines', 'pharma', 'insurance', 'retail', 'autos', 'software', 'mining', 'utilities', 'real estate']

export function IndustryNews({ command, run }: ViewProps) {
  const subject = command.args.join(' ')
  const { data, error, loading } = useResource<{ stories: Story[] }>(subject ? `/api/terminal/news?q=${encodeURIComponent(subject)}&days=7` : null)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {INDUSTRIES.map(i => (
          <button key={i} onClick={() => run(`BBNI ${i}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${i === subject.toLowerCase() ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{i}</button>
        ))}
      </div>
      {subject ? <Fetched data={data} error={error} loading={loading}>{d => <Stories stories={d.stories} />}</Fetched> : <Note>Pick an industry, or type one: BBNI shipping.</Note>}
    </div>
  )
}

const CNP_KEY = 'artha.cnp'

export function CustomPaper({ run }: ViewProps) {
  const [searches, setSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(CNP_KEY) ?? '') as string[] } catch { return ['federal reserve', 'oil', 'nvidia'] }
  })
  const [draft, setDraft] = useState('')
  const save = (s: string[]) => { setSearches(s); try { localStorage.setItem(CNP_KEY, JSON.stringify(s)) } catch { /* private window */ } }
  return (
    <div className="space-y-3">
      <form className="flex gap-2 text-[12px]" onSubmit={e => { e.preventDefault(); if (draft.trim()) { save([...searches, draft.trim()]); setDraft('') } }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Add a section: words to follow" className="flex-1 font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none" />
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Add section</button>
      </form>
      {searches.map(s => <PaperSection key={s} query={s} onRemove={() => save(searches.filter(x => x !== s))} onOpen={() => run(`NSE ${s}`)} />)}
      <Note>Your own front page: one section per search, the five newest stories in each, kept in this browser.</Note>
    </div>
  )
}

function PaperSection({ query, onRemove, onOpen }: { query: string; onRemove: () => void; onOpen: () => void }) {
  const { data } = useResource<{ stories: Story[] }>(`/api/terminal/news?q=${encodeURIComponent(query)}&days=7`, { freshMs: 10 * 60_000 })
  return (
    <div>
      <p className="news-section-label flex items-center gap-2"><button onClick={onOpen} className="hover:underline">{query}</button>
        <button onClick={onRemove} aria-label={`Remove ${query}`} className="text-muted-foreground hover:text-red-600 normal-case">×</button></p>
      <Stories stories={(data?.stories ?? []).slice(0, 5)} />
    </div>
  )
}
