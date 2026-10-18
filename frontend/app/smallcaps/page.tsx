'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Company {
  symbol: string
  ticker: string
  exchange: string
  name: string
  float: number
  cosine_content: number | null
  short_ratio: number | null
  why?: string[]
}

interface Screen {
  date: string
  rule: string
  short_settlement: string | null
  trend: { fund: string; month_end: string; close: number; average_10m: number; above: boolean }
  counts: { filers: number; small_half: number; rewritten: number; shorted: number; bad_news: number; not_listed: number; kept: number }
  largest_float: number
  kept: Company[]
  dropped: Company[]
}

const WHY: Record<string, string> = {
  rewritten: 'report rewritten',
  shorted: 'heavily shorted',
  bad_news: '8-K warning',
}

const pct = (x: number | null, d = 0) => (x === null ? '—' : `${(x * 100).toFixed(d)}%`)
const millions = (x: number) => (x >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : `$${Math.round(x / 1e6)}M`)

export default function SmallCapsPage() {
  const { data, loading, refreshing, error, reload } = useResource<Screen>('/api/smallcaps')
  const [query, setQuery] = useState('')
  const [showDropped, setShowDropped] = useState(false)

  const rows = useMemo(() => {
    const list = (showDropped ? data?.dropped : data?.kept) ?? []
    const q = query.trim().toLowerCase()
    return q ? list.filter(c => c.ticker.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)) : list
  }, [data, query, showDropped])

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      <header className="mb-6">
        <p className="news-section-label">Small companies, from their filings</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">Small caps</h1>
        {data && (
          <p className="text-xs text-muted-foreground mt-2 tabular-nums">
            {data.counts.kept} kept of {data.counts.small_half} in the smaller half on {data.date} · up to {millions(data.largest_float)} public float
          </p>
        )}
        <p className="text-[13px] mt-2 max-w-2xl">
          Every small company, less the three groups that most often halve. Tested 2010–2022 with failed companies
          included: <b>14.2%</b> a year against 11.6% for all small companies, and 21% halved within three years
          against 24%. It does not find big winners; it loses less.
        </p>
      </header>

      {error && !data && <LoadError message={error} onRetry={reload} retrying={refreshing || loading} />}
      {!data && !error && <div className="news-card h-96 animate-pulse bg-muted/30" />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 mb-4">
            <div className="news-card px-4 py-3">
              <p className="text-[11px] text-muted-foreground">Timing</p>
              <p className="text-[13px] mt-1">
                Small caps ({data.trend.fund}) closed {data.trend.month_end} at <b className="tabular-nums">${data.trend.close}</b>,{' '}
                {data.trend.above ? 'above' : 'below'} their 10-month average of <span className="tabular-nums">${data.trend.average_10m}</span>.
                {' '}The trend rule says <b>{data.trend.above ? 'hold' : 'wait in Treasury bills'}</b>.
              </p>
              <p className="text-[11px] text-muted-foreground mt-1">
                Since 1926 the rule halved the worst year (−53% to −28%) at about the same return; it trailed holding in
                most 20-year periods.
              </p>
            </div>
            <div className="news-card px-4 py-3">
              <p className="text-[11px] text-muted-foreground">Dropped from {data.counts.small_half}</p>
              <ul className="text-[13px] mt-1 tabular-nums space-y-0.5">
                <li>{data.counts.rewritten} whose last annual report was rewritten most (a fifth)</li>
                <li>{data.counts.shorted} most bet against by short sellers (a fifth; settled {data.short_settlement ?? '—'})</li>
                <li>{data.counts.bad_news} that filed a delisting notice, restatement or auditor change in the past year</li>
                <li>{data.counts.not_listed} not listed on an exchange</li>
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mb-4">
            <button onClick={() => setShowDropped(false)}
              className={`text-[13px] px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${!showDropped ? 'bg-foreground text-background' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>
              Kept <span className="tabular-nums opacity-70">{data.kept.length}</span>
            </button>
            <button onClick={() => setShowDropped(true)}
              className={`text-[13px] px-3 py-1.5 rounded-full whitespace-nowrap transition-colors ${showDropped ? 'bg-foreground text-background' : 'bg-muted/60 hover:bg-muted text-muted-foreground'}`}>
              Dropped <span className="tabular-nums opacity-70">{data.dropped.length}</span>
            </button>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or ticker"
              className="ml-auto text-[13px] bg-muted/60 rounded-full px-3 py-1.5 w-full sm:w-64" />
          </div>

          <div className="news-card px-4 py-3 overflow-x-auto">
            <table className="w-full text-[13px] tabular-nums min-w-[640px]">
              <thead>
                <tr className="text-[11px] text-muted-foreground text-left">
                  <th className="font-normal pb-2">Company</th>
                  <th className="font-normal pb-2 pl-3">Exchange</th>
                  <th className="font-normal pb-2 pl-3 text-right" title="Market value of shares held by outsiders, from the last 10-K cover">Public float</th>
                  <th className="font-normal pb-2 pl-3 text-right" title="Similarity of the last two 10-Ks' content words: 1 is unchanged">Report sameness</th>
                  <th className="font-normal pb-2 pl-3 text-right" title="Shares sold short over shares outstanding">Shorted</th>
                  {showDropped && <th className="font-normal pb-2 pl-3">Why dropped</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map(c => (
                  <tr key={c.symbol} className="border-t border-border/60">
                    <td className="py-2 pr-3 max-w-80">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold w-14 shrink-0">{c.ticker || '—'}</span>
                        <span className="truncate capitalize">{c.name.toLowerCase()}</span>
                      </div>
                    </td>
                    <td className="py-2 pl-3 text-muted-foreground">{c.exchange || '—'}</td>
                    <td className="py-2 pl-3 text-right">{millions(c.float)}</td>
                    <td className="py-2 pl-3 text-right">{c.cosine_content === null ? '—' : c.cosine_content.toFixed(3)}</td>
                    <td className="py-2 pl-3 text-right">{pct(c.short_ratio, 1)}</td>
                    {showDropped && <td className="py-2 pl-3 text-muted-foreground">{(c.why ?? []).map(w => WHY[w] ?? w).join(', ')}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No companies match.</p>}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground mt-8 max-w-3xl leading-relaxed">
        Tested as: buy every kept company in equal amounts each 30 June and hold a year. This list is refreshed
        monthly and each one is kept in the record, so it builds a track record of its own; between Junes it is a
        watch list. The test measured companies without a quoted price by their public float, which is noisy, and
        capped any one company&apos;s year at +300%. Short interest is on record only from 2018, so that filter has
        five tested years. The test also held companies traded over the counter; this list keeps exchange-listed
        ones only. Report sameness: Cohen, Malloy &amp; Nguyen, &quot;Lazy Prices&quot; (2020). Short interest:
        Boehmer, Huszar &amp; Jordan (2010). Trend rule: Faber (2007). <Link href="/companies" className="underline">The S&amp;P 500 companies</Link>.
        Not financial advice.
      </p>
    </div>
  )
}
