'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Card {
  ticker: string
  name: string
  industry: string | null
  sic: string
  fiscal_year_end: string
  years: number
  financial: boolean
  moat: 'wide' | 'narrow' | 'none' | null
  return_measure: string
  return_median: number | null
  return_by_year: (number | null)[]
  gross_margin: number | null
  gross_margin_swing: number | null
  sales_growth_5y: number | null
  reinvestment: number | null
  altman_z: number | null
  debt_to_operating_income: number | null
  share_change_yearly: number | null
  industry_share: number | null
  industry_peers: number
}

interface Priced {
  ticker: string
  percentiles: Record<'5' | '25' | '50' | '75' | '95', number>
  roic_target: number
  price: number
  price_date: string
  value_per_share: Record<'5' | '25' | '50' | '75' | '95', number>
  p_worth_more: number
  roic_10y?: Record<'5' | '50' | '95', number>
  sales_10y?: Record<'5' | '50' | '95', number>
}

interface Pricing {
  as_of: string
  market_return: number
  priced: number
  companies: Priced[]
}

interface Group {
  index: number
  label: string
  excess: number
  excess_recent: number
  won_10y: number
}

type Trait = 'issuance' | 'profitability' | 'momentum'
const TRAITS: [Trait, string, string][] = [
  ['issuance', 'Buybacks', 'Last year\'s change in share count, placed in the groups of Fama & French\'s net-issuance portfolios'],
  ['profitability', 'Profitability', 'Operating profit less interest over book equity, against NYSE fifths (Fama & French 2015)'],
  ['momentum', 'Momentum', 'The twelve months to last month, against NYSE tenths (Jegadeesh & Titman 1993)'],
]
// A group counts as good when it beat the market in more than 70% of ten-year
// windows since 1963, and bad when it did in under 30%.
const goodGroup = (g?: Group) => !!g && g.won_10y > 0.7
const badGroup = (g?: Group) => !!g && g.won_10y < 0.3

type Row = Card & { implied: number | null; worth: number | null; evidence: number; groups: Partial<Record<Trait, Group>>; priced?: Priced }

type Moat = 'all' | 'wide' | 'narrow' | 'none' | 'unknown'
type SortKey = 'ticker' | 'implied' | 'worth' | 'evidence' | 'return_median' | 'gross_margin' | 'industry_share'
  | 'sales_growth_5y' | 'altman_z' | 'share_change_yearly'

const MOATS: Moat[] = ['all', 'wide', 'narrow', 'none', 'unknown']
const MOAT_LABEL: Record<Moat, string> = {
  all: 'All', wide: 'Wide moat', narrow: 'Narrow', none: 'No moat', unknown: 'Too new to judge',
}
const MOAT_CLASS: Record<string, string> = {
  wide: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  narrow: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  none: 'bg-muted text-muted-foreground',
}

const pct = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`)
const signed = (x: number | null, d = 1) => (x === null ? '—' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%`)
const money = (x: number) => `$${x >= 1000 ? Math.round(x).toLocaleString() : x.toFixed(x >= 100 ? 0 : 2)}`
const moatOf = (c: Card): Moat => c.moat ?? 'unknown'

/** Ten years of return on capital as bars; the line marks the 15% wide-moat hurdle. */
function Spark({ values }: { values: (number | null)[] }) {
  const max = 0.6
  return (
    <div className="relative flex items-end gap-px h-5 w-16" title={values.map(v => pct(v)).join(' · ')}>
      <div className="absolute inset-x-0 border-t border-dashed border-emerald-500/50" style={{ bottom: `${(0.15 / max) * 100}%` }} />
      {values.map((v, i) => (
        <div key={i} className={`flex-1 ${v === null ? 'bg-muted' : v >= 0.15 ? 'bg-foreground/60' : v >= 0 ? 'bg-foreground/25' : 'bg-red-500/60'}`}
          style={{ height: `${Math.max(6, (Math.min(Math.abs(v ?? 0), max) / max) * 100)}%` }} />
      ))}
    </div>
  )
}

function zClass(z: number | null) {
  if (z === null) return ''
  return z < 1.1 ? 'text-red-600 dark:text-red-400' : z > 2.6 ? 'text-emerald-600 dark:text-emerald-400' : ''
}

export default function CompaniesPage() {
  const [asOf, setAsOf] = useState('')
  const url = asOf ? `/api/scorecard?as_of=${asOf}` : '/api/scorecard'
  const { data, loading, refreshing, error, reload } = useResource<{ as_of: string; cards: Card[] }>(url)
  const pricing = useResource<Pricing>(asOf ? `/api/pricer?as_of=${asOf}` : '/api/pricer')
  const evidence = useResource<{ companies: Record<string, Partial<Record<Trait, Group>>> }>(
    asOf ? `/api/evidence/companies?as_of=${asOf}` : '/api/evidence/companies')
  const [allGood, setAllGood] = useState(false)
  const [moat, setMoat] = useState<Moat>('wide')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'evidence', desc: true })

  const counts = useMemo(() => {
    const n: Record<Moat, number> = { all: 0, wide: 0, narrow: 0, none: 0, unknown: 0 }
    for (const c of data?.cards ?? []) { n.all++; n[moatOf(c)]++ }
    return n
  }, [data])

  const joined = useMemo<Row[]>(() => {
    const byTicker = new Map((pricing.data?.companies ?? []).map(p => [p.ticker, p]))
    const ev = evidence.data?.companies ?? {}
    return (data?.cards ?? []).map(c => {
      const p = byTicker.get(c.ticker)
      const groups = ev[c.ticker] ?? {}
      const evidence = TRAITS.reduce((n, [t]) => n + (goodGroup(groups[t]) ? 1 : 0) - (badGroup(groups[t]) ? 1 : 0), 0)
      return { ...c, priced: p, implied: p?.percentiles['50'] ?? null,
        worth: p ? p.value_per_share['50'] / p.price : null, groups, evidence }
    })
  }, [data, pricing.data, evidence.data])
  // Counted within the moat chosen, so the number matches the rows it shows.
  const allGoodCount = joined.filter(c =>
    (moat === 'all' || moatOf(c) === moat) && TRAITS.every(([t]) => goodGroup(c.groups[t]))).length

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = joined.filter(c =>
      (moat === 'all' || moatOf(c) === moat) &&
      (!allGood || TRAITS.every(([t]) => goodGroup(c.groups[t]))) &&
      (!q || c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)
        || (c.industry ?? '').toLowerCase().includes(q)))
    const sign = sort.desc ? -1 : 1
    return [...list].sort((a, b) => {
      if (sort.key === 'ticker') return sign * a.ticker.localeCompare(b.ticker)
      const x = a[sort.key], y = b[sort.key]
      if (x === null) return 1
      if (y === null) return -1
      return sign * (x - y)
    })
  }, [joined, moat, allGood, query, sort])

  const head = (key: SortKey, label: string, title?: string) => (
    <th className="font-normal pb-2 text-right whitespace-nowrap" title={title}>
      <button onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : true })}
        className={sort.key === key ? 'text-foreground font-semibold' : 'hover:text-foreground'}>
        {label}{sort.key === key ? (sort.desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  )

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="news-section-label">The S&amp;P 500, from its filings</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">Companies</h1>
          {data && (
            <p className="text-xs text-muted-foreground mt-2 tabular-nums">
              {counts.all} members on {data.as_of} · {counts.wide} wide moat · {counts.narrow} narrow · {counts.none} none
            </p>
          )}
          {pricing.data && (
            <p className="text-[13px] mt-2">
              The market&apos;s price implies <b className="tabular-nums">{pct(pricing.data.market_return, 1)}</b> a year
              for the whole business, value-weighted over {pricing.data.priced} companies.
            </p>
          )}
          {pricing.data && (
            <p className="text-[12px] text-muted-foreground mt-1 max-w-2xl">
              Sorted by the sixty-year evidence: each company sits in a buyback, a profitability and a momentum group,
              shown with what that group earned against the market since 1963, failed companies included. The implied
              return did not predict 3- or 5-year returns in our tests. <Link href="/proof" className="underline">See the proof</Link>.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2">
        <Link href="/proof" className="text-[13px] px-3 py-1.5 rounded-full bg-muted/60 hover:bg-muted">
          Has this worked? →
        </Link>
        <label className="text-[12px] text-muted-foreground flex items-center gap-2">
          As known on
          <input type="date" value={asOf} min="2010-01-01" onChange={e => setAsOf(e.target.value)}
            className="bg-muted/60 rounded-md px-2 py-1 text-foreground tabular-nums" />
          {asOf && <button onClick={() => setAsOf('')} className="hover:text-foreground">today</button>}
        </label>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {MOATS.map(m => (
          <button key={m} onClick={() => setMoat(moat === m ? 'all' : m)}
            className={`text-[13px] px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${moat === m ? 'bg-foreground text-background' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>
            {MOAT_LABEL[m]} <span className="tabular-nums opacity-70">{counts[m]}</span>
          </button>
        ))}
        <button onClick={() => setAllGood(!allGood)}
          title="Buys back or holds its share count, in the top two profitability fifths, and in the top three momentum tenths"
          className={`text-[13px] px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${allGood ? 'bg-emerald-600 text-white' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>
          Good on all three <span className="tabular-nums opacity-70">{allGoodCount}</span>
        </button>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, ticker, industry"
          className="ml-auto text-[13px] bg-muted/60 rounded-full px-3 py-1.5 w-full sm:w-64" />
      </div>

      {error && !data && <LoadError message={error} onRetry={reload} retrying={refreshing || loading} />}
      {!data && !error && <div className="news-card h-96 animate-pulse bg-muted/30" />}

      {data && (
        <div className="news-card px-4 py-3 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums min-w-[1500px]">
            <thead>
              <tr className="text-[11px] text-muted-foreground text-left">
                <th className="font-normal pb-2">
                  <button onClick={() => setSort({ key: 'ticker', desc: sort.key === 'ticker' ? !sort.desc : false })}
                    className={sort.key === 'ticker' ? 'text-foreground font-semibold' : 'hover:text-foreground'}>Company</button>
                </th>
                <th className="font-normal pb-2">Moat</th>
                {head('implied', 'Implied return', 'What today\'s price earns a year, middle of 5,000 futures; the small figures are the 1-in-20 low and high')}
                {head('worth', 'Price · value a share', 'Today\'s price, and what one share is worth in the middle of the 5,000 futures when each is valued at the market\'s implied return; the small figures are the 1-in-20 low and high. Sorts by value over price.')}
                <th className="font-normal pb-2 pl-3 text-right whitespace-nowrap" title="Return on capital in the tenth fiscal year from now, middle of the futures; the small figures are the 1-in-20 low and high. Back-checked from 2014-16: the range held 89-92% of the time, and the middle beat assuming it stays where it is.">Return on capital in 10 yrs</th>
                <th className="font-normal pb-2 pl-3 text-right whitespace-nowrap" title="Sales in ten fiscal years as a multiple of the last year's; the small figures are the 1-in-20 low and high. Back-checked from 2014-16: the range held 90-95% of the time, but the middle was no better than assuming 4% growth a year for everyone.">Sales in 10 yrs</th>
                {head('evidence', 'Evidence', 'Good groups less bad groups, of the three below: −3 to +3')}
                {TRAITS.map(([t, label, title]) => (
                  <th key={t} className="font-normal pb-2 text-left pl-3 whitespace-nowrap" title={title}>{label}</th>
                ))}
                {head('return_median', 'Return on capital', 'Median of the last 10 fiscal years, after tax. Banks and insurers: return on equity.')}
                <th className="font-normal pb-2 pl-3">10 years</th>
                {head('gross_margin', 'Gross margin', 'Median of the last 5 years; the small figure is how far it swung in 10')}
                {head('industry_share', 'Industry share', 'Sales over the sales of S&P 500 members in the same SIC industry group')}
                {head('sales_growth_5y', 'Sales growth', 'A year, over 5 years')}
                {head('altman_z', 'Altman Z', "Z'': below 1.1 distressed, above 2.6 safe")}
                {head('share_change_yearly', 'Shares a year', 'Change in diluted share count; negative is buybacks')}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.ticker} className="border-t border-border/60">
                  <td className="py-2 pr-3 max-w-72">
                    <div className="flex items-baseline gap-2">
                      <Link href={`/lab?symbol=${encodeURIComponent(c.ticker)}`} title={`Research ${c.ticker}`}
                        className="font-semibold w-14 shrink-0 hover:underline">{c.ticker}</Link>
                      <span className="truncate capitalize">{c.name.toLowerCase()}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate pl-16">{c.industry}</div>
                  </td>
                  <td className="py-2 pr-3">
                    {c.moat
                      ? <span className={`text-[11px] px-2 py-0.5 rounded-full ${MOAT_CLASS[c.moat]}`}>{c.moat}</span>
                      : <span className="text-[11px] text-muted-foreground" title={`${c.years} fiscal years on record`}>too new</span>}
                  </td>
                  <td className="py-2 text-right">
                    {pct(c.implied, 1)}
                    {c.priced && <div className="text-[10px] text-muted-foreground">{pct(c.priced.percentiles['5'])} – {pct(c.priced.percentiles['95'])}</div>}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    {c.priced ? (
                      <span title={`Worth more than its price in ${pct(c.priced.p_worth_more)} of futures; price on ${c.priced.price_date}`}>
                        {money(c.priced.price)}
                        <span className={`ml-1.5 ${c.worth! > 1 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                          {money(c.priced.value_per_share['50'])}
                        </span>
                        <div className="text-[10px] text-muted-foreground">
                          {money(c.priced.value_per_share['5'])} – {money(c.priced.value_per_share['95'])}
                        </div>
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    {c.priced?.roic_10y ? (
                      <>
                        {pct(c.priced.roic_10y['50'])}
                        <div className="text-[10px] text-muted-foreground">{pct(c.priced.roic_10y['5'])} – {pct(c.priced.roic_10y['95'])}</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    {c.priced?.sales_10y ? (
                      <>
                        {`${c.priced.sales_10y['50'].toFixed(1)}×`}
                        <div className="text-[10px] text-muted-foreground">{c.priced.sales_10y['5'].toFixed(1)}× – {c.priced.sales_10y['95'].toFixed(1)}×</div>
                      </>
                    ) : '—'}
                  </td>
                  <td className={`py-2 text-right font-semibold ${c.evidence > 0 ? 'text-emerald-600 dark:text-emerald-400' : c.evidence < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {c.evidence > 0 ? `+${c.evidence}` : c.evidence}
                  </td>
                  {TRAITS.map(([t]) => {
                    const g = c.groups[t]
                    return (
                      <td key={t} className="py-2 pl-3 whitespace-nowrap"
                        title={g ? `${g.label}: ${signed(g.excess)} a year against the market since 1963, ${signed(g.excess_recent)} since 2007; beat it in ${pct(g.won_10y)} of ten-year windows` : 'not sorted'}>
                        {g ? (
                          <>
                            <span className={goodGroup(g) ? 'text-emerald-600 dark:text-emerald-400' : badGroup(g) ? 'text-red-600 dark:text-red-400' : ''}>{signed(g.excess)}</span>
                            <div className="text-[10px] text-muted-foreground">{g.label}</div>
                          </>
                        ) : <span className="text-muted-foreground">—</span>}
                      </td>
                    )
                  })}
                  <td className="py-2 text-right" title={c.return_measure}>
                    {pct(c.return_median, 1)}{c.financial && <span className="text-[10px] text-muted-foreground"> ROE</span>}
                  </td>
                  <td className="py-2 pl-3"><Spark values={c.return_by_year} /></td>
                  <td className="py-2 text-right">
                    {pct(c.gross_margin)}
                    {c.gross_margin_swing !== null && <span className="text-[10px] text-muted-foreground"> ±{(c.gross_margin_swing * 50).toFixed(0)}</span>}
                  </td>
                  <td className="py-2 text-right">
                    {pct(c.industry_share)}
                    <span className="text-[10px] text-muted-foreground"> of {c.industry_peers}</span>
                  </td>
                  <td className="py-2 text-right">{signed(c.sales_growth_5y)}</td>
                  <td className={`py-2 text-right ${zClass(c.altman_z)}`}>{c.altman_z === null ? '—' : c.altman_z.toFixed(1)}</td>
                  <td className={`py-2 text-right ${c.share_change_yearly !== null && c.share_change_yearly < -0.005 ? 'text-emerald-600 dark:text-emerald-400' : c.share_change_yearly !== null && c.share_change_yearly > 0.02 ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {signed(c.share_change_yearly)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No companies match.</p>}
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-8 max-w-3xl leading-relaxed">
        Implied return: 5,000 futures of each company&apos;s sales growth and return on capital, which fades toward
        its industry&apos;s median at the speed measured for its moat grade (Fama &amp; French 2000); the rate at which
        today&apos;s enterprise value buys that cash is its implied cost of capital (Gebhardt, Lee &amp; Swaminathan
        2001). It is the return to the whole business, before leverage. Value a share: the same futures, each valued
        at the market&apos;s implied return, less net debt, over the diluted shares — at least nothing, as owners can
        lose no more than they put in (Merton 1974). It is the implied return in dollars, so it carries the same
        warning: it has not predicted returns. Banks and insurers are not priced. The ten-year columns come from
        the same futures. Rebuilt as if it were 2014, 2015 and 2016 and checked against what happened ten fiscal
        years later, their 1-in-20 ranges held 88&ndash;92% of the time for return on capital and 90&ndash;95% for
        sales, after two changes tuned on 2014 alone: return on capital fades halfway to the company&apos;s own
        past level and halfway to its industry&apos;s, and the yearly swings are twice those seen year to year.
        The middle return on capital beat &ldquo;it stays where it is&rdquo;; the middle sales figure did no better
        than 4% growth a year for everyone. Companies bought or failed in those years were not in the check.
        From SEC filings, each figure counted from the day it was first filed. Moat: return on capital above 15% in 8 of
        every 10 years is wide, above 10% in 6 of 10 is narrow (Mauboussin; Fama &amp; French 2000). Industry share
        counts S&amp;P 500 members only, so it is a share of filed peers, not of the whole market. Altman Z&apos;&apos;
        is the book-value form (Altman 1968; 1995). Not financial advice.
      </p>
    </div>
  )
}
