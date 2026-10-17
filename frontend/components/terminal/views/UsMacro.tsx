import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// FED, DOTS, FOMC, FCON, BUDG, DEBT, TAYL, IFMO, HSST and OUTL.

function useUs<T>(kind: string) {
  return useResource<T>(`/api/terminal/us/${kind}`, { freshMs: 60 * 60_000 })
}

const n2 = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))

interface Fed {
  h41: { week: string | null; total_factors_supplying: number | null; securities_held: number | null; treasuries: number | null; mbs: number | null; reserve_balances: number | null }
  rates: Record<string, { rate: number; date: string }> | null; target: { low: number; high: number } | null; next_meeting: string | null
  statement: { url: string; date: string } | null; minutes: { url: string; date: string } | null; projection_meeting: string; funds_median: Record<string, number | null> | null
}

export function FedPage({ run }: ViewProps) {
  const { data, error, loading } = useUs<Fed>('fed')
  const m = (v: number | null) => (v == null ? '—' : `$${(v / 1e6).toFixed(2)} trillion`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <Table rows={[
              ['Target range', d.target ? `${d.target.low.toFixed(2)}–${d.target.high.toFixed(2)}%` : '—', 'WIRP'],
              ['Effective fed funds', d.rates?.EFFR ? `${n2(d.rates.EFFR.rate)}% (${d.rates.EFFR.date})` : '—', 'BTMM'],
              ['SOFR', d.rates?.SOFR ? `${n2(d.rates.SOFR.rate)}%` : '—', 'BTMM'],
              ['Next decision', d.next_meeting ?? '—', 'WIRP'],
              ['Last statement', d.statement?.date ?? '—', 'FOMC'],
              ['Median path (Sep projections)', d.funds_median ? Object.entries(d.funds_median).map(([y, v]) => `${y.replace('Longer run', 'long run')} ${n2(v)}`).join(' · ') : '—', 'DOTS'],
            ]} rowKey={r => r[0]} onRow={r => run(r[2])} columns={[{ head: 'Policy', align: 'left', cell: r => r[0] }, { head: '', cell: r => <b>{r[1]}</b> }]} />
            <Table rows={[
              ['Balance sheet (factors supplying reserves)', m(d.h41.total_factors_supplying)], ['Securities held outright', m(d.h41.securities_held)],
              ['  Treasuries', m(d.h41.treasuries)], ['  Mortgage-backed', m(d.h41.mbs)], ['Bank reserves', m(d.h41.reserve_balances)],
            ]} rowKey={r => r[0]} columns={[{ head: `H.4.1, week to ${d.h41.week ?? '—'}`, align: 'left', cell: r => r[0] }, { head: '', cell: r => <b>{r[1]}</b> }]} />
          </div>
          <Note>The Federal Reserve&apos;s weekly balance sheet (H.4.1), the New York Fed&apos;s reference rates and the FOMC calendar and projections, all from the Fed&apos;s own pages. Click a row for more.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Sep { meeting: string; url: string; years: string[]; medians: Record<string, Record<string, number | null>>; dots: { year: string; rate: number; count: number }[]; dot_years: string[] }

export function DotPlot() {
  const { data, error, loading } = useUs<Sep>('dots')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const levels = Array.from(new Set(d.dots.map(x => x.rate))).sort((a, b) => b - a)
        const max = Math.max(...d.dots.map(x => x.count))
        return (
          <div className="space-y-3">
            <div className="overflow-x-auto">
              <table className="text-[11.5px] tabular-nums">
                <thead><tr><th className="pr-3 text-left font-normal text-muted-foreground">Rate</th>{d.dot_years.map(y => <th key={y} className="px-3 font-semibold">{y}</th>)}</tr></thead>
                <tbody>
                  {levels.map(l => (
                    <tr key={l}>
                      <td className="pr-3 text-muted-foreground">{l.toFixed(3)}</td>
                      {d.dot_years.map(y => {
                        const c = d.dots.find(x => x.year === y && x.rate === l)?.count ?? 0
                        const isMedian = Math.abs((d.medians['Federal funds rate']?.[y] ?? -1) - l) < 0.07
                        return <td key={y} className="px-3 text-left whitespace-nowrap">
                          {Array.from({ length: c }, (_, i) => <span key={i} className={`inline-block w-2 h-2 rounded-full mr-0.5 ${isMedian ? 'bg-rose-500' : 'bg-indigo-500'}`} />)}
                        </td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Table rows={Object.entries(d.medians)} rowKey={r => r[0]} columns={[
              { head: `Median projections, ${d.meeting}`, align: 'left', cell: r => r[0] },
              ...d.years.map(y => ({ head: y, cell: (r: [string, Record<string, number | null>]) => n2(r[1][y]) })),
            ]} />
            <Note>The FOMC&apos;s dot plot: each dot is one participant&apos;s view of the right year-end fed funds rate (the middle of the target range); red dots sit at the median. {max} participants at most at one level. From the Summary of Economic Projections of {d.meeting}.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

export function FomcDocs() {
  const { data, error, loading } = useUs<{ rows: { date: string; kind: string; url: string }[] }>('fomc')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => `${r.date}${r.kind}`} onRow={r => window.open(r.url, '_blank', 'noopener')} columns={[
            { head: 'Meeting', align: 'left', cell: r => r.date },
            { head: 'Document', align: 'left', cell: r => <b>{r.kind}</b> },
          ]} />
          <Note>The FOMC&apos;s statements, minutes (three weeks after each meeting) and projections, opening at the Federal Reserve. The next decision and what futures expect: WIRP.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Nfci { latest: { date: string; NFCI: number; ANFCI: number; Risk: number; Credit: number; Leverage: number }; rows: { date: string; NFCI: number; ANFCI: number }[] }

export function Conditions() {
  const { data, error, loading } = useUs<Nfci>('conditions')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">Week of {d.latest.date}: NFCI <b>{d.latest.NFCI.toFixed(2)}</b> ({d.latest.NFCI < 0 ? 'looser' : 'tighter'} than average), adjusted {d.latest.ANFCI.toFixed(2)}; risk {d.latest.Risk.toFixed(2)}, credit {d.latest.Credit.toFixed(2)}, leverage {d.latest.Leverage.toFixed(2)}.</p>
          <ChartLegend items={[{ label: 'NFCI', cls: 'stroke-indigo-500' }, { label: 'Adjusted for the economy', cls: 'stroke-amber-500' }]} />
          <TimeSeriesChart H={200} zeroLine series={[{ label: 'NFCI', cls: 'stroke-indigo-500', points: d.rows.map(r => ({ t: r.date, v: r.NFCI })) },
            { label: 'ANFCI', cls: 'stroke-amber-500', points: d.rows.map(r => ({ t: r.date, v: r.ANFCI })) }]} yFmt={v => v.toFixed(1)} />
          <Note>The Chicago Fed&apos;s National Financial Conditions Index: 105 measures of money markets, debt, equity and banking, in standard deviations from average; above zero is tighter. {d.latest.date} is the latest week in the Chicago Fed&apos;s public file.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Budget { months: { record_date: string; period: string; receipts: number | null; outlays: number | null; deficit: number | null }[]; debt: { date: string; total: number; public: number; intragov: number }[] }

export function FederalBudget() {
  const { data, error, loading } = useUs<Budget>('budget')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const now = d.debt[0], yearAgo = d.debt.find(x => x.date <= new Date(new Date(now.date).getTime() - 365 * 86_400_000).toISOString().slice(0, 10))
        return (
          <div className="space-y-3">
            <p className="text-[13px] tabular-nums">Debt outstanding on {now.date}: <b>{big(now.total)}</b> ({big(now.public)} held by the public){yearAgo ? `, up ${big(now.total - yearAgo.total)} in a year` : ''}.</p>
            <TimeSeriesChart H={150} series={[{ label: 'debt', cls: 'stroke-rose-500', points: [...d.debt].reverse().map(x => ({ t: x.date, v: x.total })) }]} yFmt={v => big(v)} />
            <Table rows={d.months} rowKey={(m, i) => `${m.period}${i}`} columns={[
              { head: `Monthly Treasury Statement (${d.months[0]?.record_date ?? ''})`, align: 'left', cell: m => m.period },
              { head: 'Receipts', cell: m => big(m.receipts) },
              { head: 'Outlays', cell: m => big(m.outlays) },
              { head: 'Deficit', cell: m => big(m.deficit), className: () => 'text-rose-600 dark:text-rose-400' },
            ]} />
            <Note>From the Treasury&apos;s Fiscal Data service: the Monthly Treasury Statement for the fiscal year (October to September) and the daily debt to the penny.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Holders { months: string[]; rows: { country: string; values: Record<string, number | null> }[] }

export function ForeignHolders() {
  const { data, error, loading } = useUs<Holders>('holders')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const [now, prev] = d.months
        const yr = d.months[12]
        return (
          <div className="space-y-3">
            <Table rows={d.rows} rowKey={r => r.country} columns={[
              { head: 'Holder', align: 'left', cell: r => (r.country.includes('Total') ? <b>{r.country}</b> : r.country) },
              { head: `${now}, $bn`, cell: r => r.values[now]?.toLocaleString('en-US', { maximumFractionDigits: 1 }) ?? '—' },
              { head: 'Month', cell: r => (r.values[now] != null && r.values[prev] != null ? (r.values[now]! - r.values[prev]!).toFixed(1) : '—'), className: r => tone(r.values[now] != null && r.values[prev] != null ? r.values[now]! - r.values[prev]! : null) },
              ...(yr ? [{ head: 'Year', cell: (r: Holders['rows'][number]) => (r.values[now] != null && r.values[yr] != null ? (r.values[now]! - r.values[yr]!).toFixed(1) : '—'), className: (r: Holders['rows'][number]) => tone(r.values[now] != null && r.values[yr] != null ? r.values[now]! - r.values[yr]! : null) }] : []),
            ]} />
            <Note>Major foreign holders of US Treasury securities from the Treasury International Capital system, in billions of dollars. Holdings in custody centres (Belgium, Luxembourg, Cayman) belong to investors elsewhere.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Taylor { inputs: { core_inflation: number; headline_inflation: number | null; unemployment: number; u_star: number; r_star: number; period: string; sep_meeting: string }; effr: number | null; rules: { rule: string; rate: number | null }[]; error?: string }

export function TaylorRule() {
  const { data, error, loading } = useUs<Taylor>('taylor')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.error ? <Fail message={d.error} /> : (
        <div className="space-y-3">
          <Table rows={d.rules} rowKey={r => r.rule} columns={[
            { head: 'Rule', align: 'left', cell: r => r.rule },
            { head: 'Prescribed rate', cell: r => (r.rate == null ? '—' : `${r.rate.toFixed(2)}%`) },
            { head: 'Against today', cell: r => (r.rate == null || d.effr == null ? '—' : `${r.rate - d.effr > 0 ? '+' : ''}${((r.rate - d.effr) * 100).toFixed(0)} bp`), className: r => tone(r.rate == null || d.effr == null ? null : -(r.rate - d.effr)) },
          ]} />
          <Table rows={[
            ['Effective fed funds today', d.effr == null ? '—' : `${d.effr.toFixed(2)}%`], ['Core CPI inflation, a year', `${d.inputs.core_inflation.toFixed(2)}%`],
            ['Headline CPI inflation', d.inputs.headline_inflation == null ? '—' : `${d.inputs.headline_inflation.toFixed(2)}%`], ['Unemployment', `${d.inputs.unemployment.toFixed(1)}%`],
            ['Full employment (FOMC long-run median)', `${d.inputs.u_star.toFixed(1)}%`], ['Neutral real rate (FOMC long-run rate less 2%)', `${d.inputs.r_star.toFixed(2)}%`],
          ]} rowKey={r => r[0]} columns={[{ head: `Inputs, ${d.inputs.period}`, align: 'left', cell: r => r[0] }, { head: '', cell: r => <b>{r[1]}</b> }]} />
          <Note>Taylor (1993): neutral real rate + inflation + half the gap between inflation and 2% + half the output gap, the gap taken from unemployment by Okun&apos;s law (twice the shortfall). Full employment and the neutral rate are the FOMC&apos;s own long-run medians from its {d.inputs.sep_meeting} projections. CPI stands in for the Fed&apos;s PCE measure, which runs a little lower.</Note>
        </div>
      )}
    </Fetched>
  )
}

export function Inflation({ run }: ViewProps) {
  const { data, error, loading } = useUs<{ rows: { date: string; '5Y': number | null; '10Y': number | null; '30Y': number | null }[] }>('breakevens')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const last = d.rows[d.rows.length - 1]
        return (
          <div className="space-y-3">
            <p className="text-[13px] tabular-nums">Inflation the bond market prices, {last.date}: 5 years <b>{n2(last['5Y'])}%</b>, 10 years <b>{n2(last['10Y'])}%</b>, 30 years <b>{n2(last['30Y'])}%</b> a year.</p>
            <ChartLegend items={[{ label: '5-year', cls: 'stroke-indigo-500' }, { label: '10-year', cls: 'stroke-amber-500' }, { label: '30-year', cls: 'stroke-emerald-500' }]} />
            <TimeSeriesChart H={180} series={(['5Y', '10Y', '30Y'] as const).map((k, i) => ({ label: k, cls: ['stroke-indigo-500', 'stroke-amber-500', 'stroke-emerald-500'][i], points: d.rows.filter(r => r[k] != null).map(r => ({ t: r.date, v: r[k]! })) }))} yFmt={v => v.toFixed(2)} />
            <Note>Breakeven inflation: the Treasury&apos;s nominal par yield less its TIPS real yield at the same maturity, this year. Consumer price inflation by country: <button className="underline" onClick={() => run('ECMX')}>ECMX</button>; US CPI in detail: <button className="underline" onClick={() => run('ECST')}>ECST</button>.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Housing { starts: { title: string | null; points: { t: string; v: number }[] }; sales: { title: string | null; points: { t: string; v: number }[] }; hpi: { t: string; v: number }[] }

export function UsHousing() {
  const { data, error, loading } = useUs<Housing>('housing')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const hp = d.hpi, yoy = hp.length > 12 ? (hp[hp.length - 1].v / hp[hp.length - 13].v - 1) * 100 : null
        const last = (s: { t: string; v: number }[]) => s[s.length - 1]
        return (
          <div className="space-y-3">
            <p className="text-[13px] tabular-nums">Housing starts {last(d.starts.points)?.t.slice(0, 7)}: <b>{(last(d.starts.points)?.v ?? 0).toLocaleString('en-US')}k</b> a year; new homes sold <b>{(last(d.sales.points)?.v ?? 0).toLocaleString('en-US')}k</b> a year; FHFA house prices {pct(yoy)} over a year.</p>
            <ChartLegend items={[{ label: 'Starts, thousands a year', cls: 'stroke-indigo-500' }, { label: 'New homes sold', cls: 'stroke-amber-500' }]} />
            <TimeSeriesChart H={180} series={[{ label: 'starts', cls: 'stroke-indigo-500', points: d.starts.points.map(p => ({ t: p.t, v: p.v })) },
              { label: 'sales', cls: 'stroke-amber-500', points: d.sales.points.filter(p => p.t >= (d.starts.points[0]?.t ?? '')).map(p => ({ t: p.t, v: p.v })) }]} yFmt={v => v.toFixed(0)} />
            <p className="news-section-label">FHFA purchase-only house price index</p>
            <TimeSeriesChart H={140} series={[{ label: 'HPI', cls: 'stroke-emerald-500', points: hp.map(p => ({ t: p.t, v: p.v })) }]} yFmt={v => v.toFixed(0)} />
            <Note>Census Bureau new residential construction and sales (seasonally adjusted annual rates) and the FHFA house price index. Other countries&apos; house prices: HOIN.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Outlook { rows: { area: string; name: string | null; gdp: Record<string, number>; cpi: Record<string, number> }[] }

export function OecdOutlook({ run }: ViewProps) {
  const { data, error, loading } = useUs<Outlook>('outlook')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const years = Array.from(new Set(d.rows.flatMap(r => Object.keys(r.gdp)))).sort()
        return (
          <div className="space-y-3">
            <Table rows={d.rows} rowKey={r => r.area} onRow={r => r.area.length === 3 && run(`COUN ${r.area.slice(0, 2)}`)} columns={[
              { head: 'Economy', align: 'left', cell: r => <b>{r.name ?? r.area}</b> },
              ...years.map(y => ({ head: `GDP ${y}`, cell: (r: Outlook['rows'][number]) => pct(r.gdp[y] ?? null), className: (r: Outlook['rows'][number]) => tone(r.gdp[y] ?? null) })),
              ...years.map(y => ({ head: `Inflation ${y}`, cell: (r: Outlook['rows'][number]) => (r.cpi[y] == null ? '—' : `${r.cpi[y].toFixed(1)}%`) })),
            ]} />
            <Note>The OECD Economic Outlook: real GDP growth and consumer price inflation, actual and projected. Official projections only; private economists&apos; surveys (Bloomberg&apos;s ECFC) are licensed.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
