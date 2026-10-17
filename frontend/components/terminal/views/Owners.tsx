import { useState } from 'react'
import { TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { usePrices } from './Chart'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// INSD and GPTR (insider trades), FLNG and PHDC (a manager's 13F), SIA
// (short interest history), SPOS (UK short positions), and the filing
// searches CFS, EDGS, ACF, CFA and DSCO.

interface Trade { date: string; name: string; relation: string; text: string; kind: string; shares: number | null; value: number | null; price: number | null; direct: boolean }
interface Insiders { symbol: string; transactions: Trade[]; year: Record<'buy' | 'sell', { count: number; shares: number; value: number }>; six_months: Record<string, number | null> }

const KIND_TONE: Record<string, string> = { buy: 'text-emerald-600 dark:text-emerald-400', sell: 'text-rose-600 dark:text-rose-400' }

export function Insiders({ command, run }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useResource<Insiders>(`/api/terminal/insiders/${encodeURIComponent(sec.symbol)}`)
  const prices = usePrices(sec.symbol, '1y')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const market = d.transactions.filter(t => t.kind === 'buy' || t.kind === 'sell')
        return (
          <div className="space-y-3">
            <p className="text-[13px] tabular-nums">
              Last twelve months: <b className={KIND_TONE.buy}>{d.year.buy.count} buys</b> ({big(d.year.buy.value)}),{' '}
              <b className={KIND_TONE.sell}>{d.year.sell.count} sales</b> ({big(d.year.sell.value)}) on the open market.
            </p>
            {command.fn === 'GPTR' && prices.data && (
              <>
                <TimeSeriesChart H={200} series={[{ label: 'Close', cls: 'stroke-foreground', points: prices.data.series.map(p => ({ t: p.t * 1000, v: p.c })) }]} />
                <MonthBars trades={market} />
              </>
            )}
            {d.transactions.length === 0 ? <Note>No insider filings reported.</Note> : (
              <Table rows={d.transactions} rowKey={(t, i) => `${t.date}${t.name}${i}`} onRow={() => run(`${sec.label} CF`)}
                columns={[
                  { head: 'Date', align: 'left', cell: t => t.date },
                  { head: 'Insider', align: 'left', cell: t => <span><b>{t.name}</b> <span className="text-muted-foreground">{t.relation}</span></span> },
                  { head: 'Kind', align: 'left', cell: t => t.kind, className: t => KIND_TONE[t.kind] ?? 'text-muted-foreground' },
                  { head: 'Shares', cell: t => (t.shares == null ? '—' : t.shares.toLocaleString('en-US')) },
                  { head: 'Price', cell: t => price(t.price) },
                  { head: 'Value', cell: t => big(t.value) },
                  { head: 'Held', align: 'left', cell: t => (t.direct ? 'direct' : 'indirect') },
                ]} />
            )}
            <Note>From the insiders&apos; SEC Forms 4, as Yahoo lists them. Awards, gifts and option exercises are not market trades; only purchases and sales count above.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

/** Insider buying and selling by month, in dollars. */
function MonthBars({ trades }: { trades: Trade[] }) {
  const months = new Map<string, { buy: number; sell: number }>()
  for (const t of trades) {
    const m = t.date.slice(0, 7)
    const v = months.get(m) ?? { buy: 0, sell: 0 }
    v[t.kind as 'buy' | 'sell'] += t.value ?? 0
    months.set(m, v)
  }
  const rows = Array.from(months.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12)
  const max = Math.max(1, ...rows.map(([, v]) => Math.max(v.buy, v.sell)))
  return (
    <div className="space-y-0.5">
      <p className="news-section-label">Insider dollars by month</p>
      {rows.map(([m, v]) => (
        <div key={m} className="flex items-center gap-2 text-[11.5px] tabular-nums">
          <span className="w-16 text-muted-foreground">{m}</span>
          <div className="flex-1 flex justify-end"><div className="h-2.5 bg-emerald-500/70 rounded-l" style={{ width: `${(v.buy / max) * 100}%` }} /></div>
          <div className="flex-1"><div className="h-2.5 bg-rose-500/70 rounded-r" style={{ width: `${(v.sell / max) * 100}%` }} /></div>
          <span className="w-40 text-right">{v.buy ? `+${big(v.buy)}` : ''} {v.sell ? `−${big(v.sell)}` : ''}</span>
        </div>
      ))}
    </div>
  )
}

interface Holding { issuer: string; class: string; cusip: string; put_call: string | null; value: number; shares: number; weight: number | null; previous_shares: number; status: string }
interface Manager { cik: number; name: string; period: string; filed: string; previous_period: string | null; value: number; positions: number; holdings: Holding[] }

const STATUS_TONE: Record<string, string> = { new: 'text-emerald-600 dark:text-emerald-400', added: 'text-emerald-600 dark:text-emerald-400', reduced: 'text-rose-600 dark:text-rose-400', sold: 'text-rose-600 dark:text-rose-400' }

export function Thirteenf({ command, run }: ViewProps) {
  const name = command.args.join(' ')
  const { data, error, loading } = useResource<Manager>(name ? `/api/terminal/13f?manager=${encodeURIComponent(name)}` : null, { freshMs: 60 * 60_000 })
  if (!name) return <Note>Name a manager: {command.fn} BERKSHIRE HATHAWAY, {command.fn} BRIDGEWATER, or a CIK number.</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">
            <b>{d.name}</b> (CIK {d.cik}): {d.positions} positions worth <b>${big(d.value)}</b> at {d.period}, filed {d.filed}.
            {d.previous_period && <> Changes are against {d.previous_period}.</>}
          </p>
          <Table rows={d.holdings} rowKey={(h, i) => `${h.cusip}${h.put_call}${i}`} onRow={h => run(`SECF ${h.issuer.split(' ')[0]}`)}
            columns={[
              { head: 'Issuer', align: 'left', cell: h => <span><b>{h.issuer}</b> <span className="text-muted-foreground">{h.put_call ?? h.class}</span></span> },
              { head: 'Value', cell: h => big(h.value) },
              { head: 'Weight', cell: h => (h.weight == null ? '—' : pct(h.weight * 100, false)) },
              { head: 'Shares', cell: h => h.shares.toLocaleString('en-US') },
              { head: 'Change', cell: h => (h.previous_shares ? pct((h.shares / h.previous_shares - 1) * 100) : '—'), className: h => STATUS_TONE[h.status] ?? '' },
              { head: 'Status', align: 'left', cell: h => h.status, className: h => STATUS_TONE[h.status] ?? 'text-muted-foreground' },
            ]} />
          <Note>From the manager&apos;s 13F filings with the SEC: US-listed long positions and options only, 45 days after the quarter ends. Shorts and non-US holdings are not reported. Weights leave out options.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface ShortRow { date: string; short: number; days_to_cover: number | null; change_pct: number | null; avg_volume: number | null }

export function ShortHistory({ command }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useResource<{ rows: ShortRow[] }>(`/api/terminal/shorts/${encodeURIComponent(sec.symbol)}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Note>FINRA reports no short interest for {sec.label} (it covers US-listed and OTC shares).</Note> : (
        <div className="space-y-3">
          <p className="news-section-label">Shares sold short</p>
          <TimeSeriesChart H={170} series={[{ label: 'Short', cls: 'stroke-rose-500', points: d.rows.map(r => ({ t: r.date, v: r.short })) }]} />
          <p className="news-section-label">Days to cover</p>
          <TimeSeriesChart H={120} series={[{ label: 'Days', cls: 'stroke-indigo-500', points: d.rows.filter(r => r.days_to_cover != null).map(r => ({ t: r.date, v: r.days_to_cover! })) }]} />
          <Table rows={[...d.rows].reverse()} rowKey={r => r.date} columns={[
            { head: 'Settlement', align: 'left', cell: r => r.date },
            { head: 'Short shares', cell: r => r.short.toLocaleString('en-US') },
            { head: 'Change', cell: r => pct(r.change_pct), className: r => tone(r.change_pct == null ? null : -r.change_pct) },
            { head: 'Average volume', cell: r => (r.avg_volume == null ? '—' : r.avg_volume.toLocaleString('en-US')) },
            { head: 'Days to cover', cell: r => r.days_to_cover?.toFixed(2) ?? '—' },
          ]} />
          <Note>FINRA&apos;s consolidated short interest, reported twice a month by brokers, for the last two years.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface UkShort { issuer: string; isin: string; net_short_pct: number; date: string }

export function UkShorts({ command }: ViewProps) {
  const issuer = command.args.join(' ') || null
  const { data, error, loading } = useResource<{ as_of: string | null; issuers: UkShort[] }>(`/api/terminal/uk-shorts${issuer ? `?issuer=${encodeURIComponent(issuer)}` : ''}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          {d.issuers.length === 0 ? <Note>No disclosed short position matches {issuer}.</Note> : (
            <Table rows={d.issuers} rowKey={r => r.isin} columns={[
              { head: 'Company', align: 'left', cell: r => <b>{r.issuer}</b> },
              { head: 'ISIN', align: 'left', cell: r => <span className="text-muted-foreground">{r.isin}</span> },
              { head: 'Net short %', cell: r => r.net_short_pct.toFixed(2) },
              { head: 'Latest change', align: 'left', cell: r => r.date },
            ]} />
          )}
          <Note>
            The UK Financial Conduct Authority&apos;s total net short position in each company, as of {d.as_of}. Since July 2026
            the FCA publishes the total per company only, not each short seller. Filter by name: SPOS OCADO.
          </Note>
        </div>
      )}
    </Fetched>
  )
}

interface Hit { company: string; form: string; filed: string; period: string | null; document: string; description: string | null; url: string }

const FORMS = /^FORM=(.+)$/i

export function FilingSearch({ command }: ViewProps) {
  const formArg = command.args.find(a => FORMS.test(a))
  // BNKF and CL are preset searches: bankruptcy items in 8-Ks, legal proceedings in reports
  const preset = command.fn === 'BNKF' ? '"Item 1.03" bankruptcy' : command.fn === 'CL' ? '"legal proceedings" litigation' : ''
  const words = command.args.filter(a => a !== formArg).join(' ') || preset
  const [q, setQ] = useState(words)
  const [forms, setForms] = useState(formArg ? formArg.replace(FORMS, '$1').toUpperCase() : command.fn === 'DSCO' ? 'DEF 14A,ARS,10-K' : command.fn === 'BNKF' ? '8-K' : command.fn === 'CL' ? '10-K,10-Q' : '')
  const [submitted, setSubmitted] = useState({ q: words, forms })
  const sym = command.security?.symbol
  const params = new URLSearchParams({ q: submitted.q })
  if (submitted.forms) params.set('forms', submitted.forms)
  if (sym) params.set('symbol', sym)
  if (command.fn === 'BNKF') params.set('start', new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))
  const { data, error, loading } = useResource<{ total: number; more: boolean; hits: Hit[] }>(submitted.q.length >= 2 ? `/api/terminal/filing-search?${params}` : null)
  const input = 'font-mono text-[12.5px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <div className="space-y-3">
      <form onSubmit={e => { e.preventDefault(); setSubmitted({ q, forms }) }} className="flex flex-wrap gap-2 text-[12px]">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={'Words or "an exact phrase"'} className={`${input} flex-1 min-w-[12rem]`} />
        <input value={forms} onChange={e => setForms(e.target.value.toUpperCase())} placeholder="Forms, e.g. 10-K,8-K" className={`${input} w-44`} />
        <button className="px-3 py-1.5 rounded-md bg-foreground text-background">Search</button>
      </form>
      {submitted.q.length < 2 ? <Note>Search the text of every SEC filing since 2001. Put a security first to search one company: AAPL CFS &quot;supply chain&quot;.</Note> : (
        <Fetched data={data} error={error} loading={loading}>
          {d => d.hits.length === 0 ? <Fail message="No filings match." /> : (
            <>
              <p className="text-[12px] text-muted-foreground">{d.more ? 'More than ' : ''}{d.total.toLocaleString('en-US')} documents; the {d.hits.length} most relevant shown.</p>
              <Table rows={d.hits} rowKey={(h, i) => `${h.url}${i}`} onRow={h => window.open(h.url, '_blank', 'noopener')}
                columns={[
                  { head: 'Filed', align: 'left', cell: h => h.filed },
                  { head: 'Company', align: 'left', cell: h => h.company.replace(/\s*\(CIK \d+\)/, '') },
                  { head: 'Form', align: 'left', cell: h => <b>{h.form}</b> },
                  { head: 'Document', align: 'left', cell: h => h.description ?? h.document },
                  { head: 'Period', align: 'left', cell: h => h.period ?? '' },
                ]} />
            </>
          )}
        </Fetched>
      )}
      <Note>SEC EDGAR full-text search. Click a row to open the document at the SEC.</Note>
    </div>
  )
}
