import { useState } from 'react'
import XYChart from '../XYChart'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { CompanySection } from './company'
import { big, pct, tone } from '@/lib/terminal/numbers'
import { send } from '@/lib/terminal/send'
import { invalidate, useResource } from '@/lib/useResource'

// EEG (estimate trend), EERM (revisions), EM (actuals against estimates),
// MYE (my own estimates), and the market calendars ACDR, SURP, EA, CACT, CDR.

const eps = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))
const AGO: [string, number][] = [['90daysAgo', 90], ['60daysAgo', 60], ['30daysAgo', 30], ['7daysAgo', 7], ['current', 0]]
const COLOURS = ['stroke-indigo-500', 'stroke-amber-500', 'stroke-emerald-500', 'stroke-rose-500']

export function EstimateTrend({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="estimates" missing="No analyst estimates for this security.">
      {est => {
        const series = est.filter(e => e.eps_trend).map((e, i) => ({
          label: e.period, cls: COLOURS[i % COLOURS.length],
          // each period rebased to 100 at 90 days ago, so a 2% cut shows as 98 whatever the size of the number
          points: AGO.filter(([k]) => e.eps_trend![k as keyof typeof e.eps_trend] != null && e.eps_trend!['90daysAgo'])
            .map(([k, d]) => ({ x: -d, y: (e.eps_trend![k as keyof typeof e.eps_trend]! / e.eps_trend!['90daysAgo']!) * 100 })),
        }))
        return (
          <div className="space-y-3">
            <XYChart series={series} xFmt={x => (x === 0 ? 'now' : `${Math.round(-x)}d ago`)} yFmt={v => v.toFixed(1)} />
            <Table rows={est} rowKey={e => e.period} columns={[
              { head: 'Period', align: 'left', cell: e => <b>{e.period}</b> },
              ...AGO.map(([k, d]) => ({ head: d ? `${d} days ago` : 'Now', cell: (e: typeof est[number]) => eps(e.eps_trend?.[k as keyof NonNullable<typeof e.eps_trend>]) })),
              { head: 'Change, 90 days', cell: e => { const a = e.eps_trend?.['90daysAgo'], b = e.eps_trend?.current; return a && b != null ? pct((b / a - 1) * 100) : '—' }, className: e => { const a = e.eps_trend?.['90daysAgo'], b = e.eps_trend?.current; return a && b != null ? tone(b - a) : '' } },
            ]} />
            <Note>The consensus earnings-per-share estimate for each period as it stood 90, 60, 30 and 7 days ago and now, from Yahoo. The chart shows each period as 100 ninety days ago.</Note>
          </div>
        )
      }}
    </CompanySection>
  )
}

export function Revisions({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="estimates" missing="No analyst estimates for this security.">
      {est => (
        <div className="space-y-3">
          <Table rows={est} rowKey={e => e.period} columns={[
            { head: 'Period', align: 'left', cell: e => <b>{e.period}</b> },
            { head: 'Analysts', cell: e => e.analysts ?? '—' },
            { head: 'Up, 7 days', cell: e => e.revisions_up_7d ?? '—', className: () => 'text-emerald-600 dark:text-emerald-400' },
            { head: 'Down, 7 days', cell: e => e.revisions_down_7d ?? '—', className: () => 'text-rose-600 dark:text-rose-400' },
            { head: 'Up, 30 days', cell: e => e.revisions_up_30d ?? '—', className: () => 'text-emerald-600 dark:text-emerald-400' },
            { head: 'Down, 30 days', cell: e => e.revisions_down_30d ?? '—', className: () => 'text-rose-600 dark:text-rose-400' },
            { head: 'Net, 30 days', cell: e => (e.revisions_up_30d ?? 0) - (e.revisions_down_30d ?? 0), className: e => tone((e.revisions_up_30d ?? 0) - (e.revisions_down_30d ?? 0)) },
          ]} />
          <Note>How many analysts raised or cut their earnings estimate for each period over the last week and month. Revisions tend to cluster: a run of cuts often continues.</Note>
        </div>
      )}
    </CompanySection>
  )
}

export function EstimateMatrix({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="earnings" missing="No earnings history for this security.">
      {(e, c) => (
        <div className="space-y-3">
          <p className="news-section-label">Quarters: reported against the estimate</p>
          <Table rows={[...e.quarters].reverse()} rowKey={q => q.quarter_end} columns={[
            { head: 'Quarter ended', align: 'left', cell: q => q.quarter_end },
            { head: 'Estimate', cell: q => eps(q.estimate) },
            { head: 'Actual', cell: q => eps(q.actual) },
            { head: 'Surprise', cell: q => pct(q.surprise_pct), className: q => tone(q.surprise_pct) },
          ]} />
          {c.estimates && (
            <>
              <p className="news-section-label">Ahead: the consensus</p>
              <Table rows={c.estimates} rowKey={x => x.period} columns={[
                { head: 'Period', align: 'left', cell: x => <span><b>{x.period}</b> <span className="text-muted-foreground">{x.end}</span></span> },
                { head: 'EPS estimate', cell: x => eps(x.eps_avg) },
                { head: 'Range', cell: x => `${eps(x.eps_low)}–${eps(x.eps_high)}` },
                { head: 'Year ago', cell: x => eps(x.eps_year_ago) },
                { head: 'Growth', cell: x => pct(x.eps_growth_pct), className: x => tone(x.eps_growth_pct) },
                { head: 'Revenue estimate', cell: x => big(x.revenue_avg) },
              ]} />
            </>
          )}
          {e.years.length > 0 && (
            <>
              <p className="news-section-label">Years: reported</p>
              <Table rows={[...e.years].reverse()} rowKey={y => String(y.year)} columns={[
                { head: 'Year', align: 'left', cell: y => y.year },
                { head: 'Revenue', cell: y => big(y.revenue) },
                { head: 'Net income', cell: y => big(y.earnings) },
              ]} />
            </>
          )}
        </div>
      )}
    </CompanySection>
  )
}

interface Mine { id: number; symbol: string; period: string; eps: number | null; revenue: number | null; note: string | null; created_at: string }

export function MyEstimates({ command }: ViewProps) {
  const sym = command.security?.symbol
  const url = `/api/terminal/my-estimates${sym ? `?symbol=${encodeURIComponent(sym)}` : ''}`
  const { data, error, loading, reload } = useResource<{ estimates: Mine[] }>(url, { freshMs: 0 })
  const [form, setForm] = useState({ period: 'This year', eps: '', revenue: '', note: '' })
  const [problem, setProblem] = useState<string | null>(null)
  if (!sym) return <Note>Put a security first: AAPL MYE. Your estimates sit beside the consensus.</Note>
  async function add(e: React.FormEvent) {
    e.preventDefault()
    try {
      setProblem(null)
      await send('POST', '/api/terminal/my-estimates', { symbol: sym, period: form.period, eps: form.eps ? Number(form.eps) : null,
        revenue: form.revenue ? Number(form.revenue) * 1e9 : null, note: form.note || null })
      setForm(f => ({ ...f, eps: '', revenue: '', note: '' }))
      invalidate(url); reload()
    } catch (err) { setProblem((err as Error).message) }
  }
  const input = 'font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex flex-wrap gap-2 items-center text-[12px]">
        <select value={form.period} onChange={e => setForm({ ...form, period: e.target.value })} className={input} aria-label="Period">
          {['This quarter', 'Next quarter', 'This year', 'Next year'].map(p => <option key={p}>{p}</option>)}
        </select>
        <input value={form.eps} onChange={e => setForm({ ...form, eps: e.target.value })} placeholder="EPS" inputMode="decimal" className={`${input} w-24`} />
        <input value={form.revenue} onChange={e => setForm({ ...form, revenue: e.target.value })} placeholder="Revenue, $bn" inputMode="decimal" className={`${input} w-32`} />
        <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="Why (optional)" className={`${input} flex-1 min-w-[10rem]`} />
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Save estimate</button>
      </form>
      {problem && <Fail message={problem} />}
      <CompanySection symbol={sym} section="estimates" missing="No consensus to compare with.">
        {est => (
          <Fetched data={data} error={error} loading={loading}>
            {d => d.estimates.length === 0 ? <Note>No estimates of yours for {sym} yet.</Note> : (
              <Table rows={d.estimates} rowKey={m => String(m.id)} columns={[
                { head: 'Saved', align: 'left', cell: m => m.created_at.slice(0, 10) },
                { head: 'Period', align: 'left', cell: m => <b>{m.period}</b> },
                { head: 'Your EPS', cell: m => eps(m.eps) },
                { head: 'Consensus', cell: m => eps(est.find(e => e.period === m.period)?.eps_avg) },
                { head: 'Gap', cell: m => { const c = est.find(e => e.period === m.period)?.eps_avg; return m.eps != null && c ? pct((m.eps / c - 1) * 100) : '—' }, className: m => { const c = est.find(e => e.period === m.period)?.eps_avg; return m.eps != null && c ? tone(m.eps - c) : '' } },
                { head: 'Your revenue', cell: m => big(m.revenue) },
                { head: 'Consensus', cell: m => big(est.find(e => e.period === m.period)?.revenue_avg) },
                { head: 'Why', align: 'left', cell: m => m.note ?? '' },
                { head: '', cell: m => <button onClick={() => void send('DELETE', `/api/terminal/my-estimates/${m.id}`).then(() => { invalidate(url); reload() })} className="text-muted-foreground hover:text-red-600" aria-label="Delete estimate">×</button> },
              ]} />
            )}
          </Fetched>
        )}
      </CompanySection>
      <Note>Kept on this machine only. The gap is your estimate against today&apos;s consensus for the same period.</Note>
    </div>
  )
}

interface Earn { date: string; symbol: string; name: string; time: string; quarter: string; eps: number | null; estimate: number | null; estimates: number | null; surprise_pct: number | null; market_cap: number | null }

export function EarningsCalendar({ command, run }: ViewProps) {
  const surp = command.fn === 'SURP'
  const { data, error, loading } = useResource<{ rows: Earn[] }>(`/api/terminal/calendar/${surp ? 'surprises' : 'earnings'}`, { freshMs: 30 * 60_000 })
  const [big_, setBig] = useState(true)
  return (
    <div className="space-y-3">
      <label className="text-[12px] flex items-center gap-2"><input type="checkbox" checked={big_} onChange={e => setBig(e.target.checked)} />Only companies worth $10 billion or more</label>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const rows = d.rows.filter(r => !big_ || (r.market_cap ?? 0) >= 1e10)
          return rows.length === 0 ? <Note>Nothing in this window.</Note> : (
            <Table rows={rows} rowKey={(r, i) => `${r.date}${r.symbol}${i}`} onRow={r => run(`${r.symbol} ERN`)} columns={[
              { head: 'Date', align: 'left', cell: r => r.date },
              { head: 'When', align: 'left', cell: r => r.time },
              { head: 'Company', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
              { head: 'Quarter', align: 'left', cell: r => r.quarter },
              { head: 'Estimate', cell: r => eps(r.estimate) },
              ...(surp ? [
                { head: 'Actual', cell: (r: Earn) => eps(r.eps) },
                { head: 'Surprise', cell: (r: Earn) => pct(r.surprise_pct), className: (r: Earn) => tone(r.surprise_pct) },
              ] : [{ head: 'Analysts', cell: (r: Earn) => r.estimates ?? '—' }]),
              { head: 'Market cap', cell: r => big(r.market_cap) },
            ]} />
          )
        }}
      </Fetched>
      <Note>{surp ? 'Results of the last ten trading days against the consensus, newest first,' : 'Reports due in the next ten trading days with the consensus estimate,'} from Nasdaq&apos;s earnings calendar.</Note>
    </div>
  )
}

interface SectorCard { sector: string; reported: number; beat: number; met: number; missed: number; median_surprise_pct: number | null }

export function Season() {
  const { data, error, loading } = useResource<{ days: number; sectors: SectorCard[]; total: Record<string, number> }>('/api/terminal/calendar/season', { freshMs: 60 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">
            {d.total.reported} S&amp;P 500 companies reported in the last {d.days} trading days: <b className="text-emerald-600 dark:text-emerald-400">{d.total.beat} beat</b>,{' '}
            {d.total.met} met, <b className="text-rose-600 dark:text-rose-400">{d.total.missed} missed</b>
            {d.total.reported ? ` (${Math.round((d.total.beat / d.total.reported) * 100)}% beat)` : ''}.
          </p>
          <Table rows={d.sectors} rowKey={s => s.sector} columns={[
            { head: 'Sector', align: 'left', cell: s => <b>{s.sector}</b> },
            { head: 'Reported', cell: s => s.reported },
            { head: 'Beat', cell: s => s.beat },
            { head: 'Met', cell: s => s.met },
            { head: 'Missed', cell: s => s.missed },
            { head: 'Beat rate', cell: s => pct((s.beat / s.reported) * 100, false) },
            { head: 'Median surprise', cell: s => pct(s.median_surprise_pct), className: s => tone(s.median_surprise_pct) },
          ]} />
          <Note>Earnings per share against the consensus for S&amp;P 500 members, from Nasdaq&apos;s calendar, by sector. About three in four companies usually beat: estimates are set to be beaten.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Action { kind: 'dividend' | 'split'; date: string; symbol: string; name: string; amount?: number | null; annual?: number | null; pay_date?: string; ratio?: string }

export function ActionsCalendar({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ rows: Action[] }>('/api/terminal/calendar/actions', { freshMs: 60 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={(r, i) => `${r.kind}${r.symbol}${r.date}${i}`} onRow={r => run(`${r.symbol} DVD`)} columns={[
            { head: 'Date', align: 'left', cell: r => r.date },
            { head: 'Action', align: 'left', cell: r => (r.kind === 'split' ? <b>Split {r.ratio}</b> : 'Ex-dividend') },
            { head: 'Security', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
            { head: 'Amount', cell: r => (r.amount == null ? '' : r.amount.toFixed(4).replace(/0{1,2}$/, '')) },
            { head: 'Yearly', cell: r => (r.annual == null ? '' : r.annual.toFixed(2)) },
            { head: 'Paid', align: 'left', cell: r => r.pay_date ?? '' },
          ]} />
          <Note>Ex-dividend dates in the next ten trading days and announced splits, from Nasdaq&apos;s calendars. US listings only; municipal actions are not public in one place.</Note>
        </div>
      )}
    </Fetched>
  )
}

export function Holidays({ command, run }: ViewProps) {
  const year = Number(command.args[0]) || new Date().getFullYear()
  const { data, error, loading } = useResource<{ year: number; days: { date: string; name: string; kind: string }[] }>(`/api/terminal/calendar/holidays?year=${year}`)
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {[year - 1, year, year + 1].map(y => (
          <button key={y} onClick={() => run(`CDR ${y}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${y === year ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{y}</button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => (
          <Table rows={d.days} rowKey={h => h.date} columns={[
            { head: 'Date', align: 'left', cell: h => h.date },
            { head: 'Day', align: 'left', cell: h => new Date(`${h.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' }) },
            { head: 'Holiday', align: 'left', cell: h => <b>{h.name}</b> },
            { head: 'Market', align: 'left', cell: h => h.kind, className: h => (h.kind === 'closed' ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400') },
          ]} />
        )}
      </Fetched>
      <Note>NYSE and Nasdaq holidays by the exchanges&apos; rules: a Saturday holiday closes the Friday before, a Sunday one the Monday after, and Good Friday follows Easter. Extra closures (a national day of mourning) are announced as they happen.</Note>
    </div>
  )
}
