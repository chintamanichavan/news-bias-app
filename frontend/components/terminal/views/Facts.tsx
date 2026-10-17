import { useState } from 'react'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { argSymbol } from '@/lib/terminal/parse'
import { useResource } from '@/lib/useResource'

// Company numbers from SEC XBRL filings: ARD, EV, CAST, DLIS, AZS, DRSK,
// DRAM, GF, GRET and PEBD.

function useFacts<T>(kind: string, symbol: string) {
  return useResource<T>(`/api/terminal/facts/${kind}/${encodeURIComponent(symbol)}`, { freshMs: 60 * 60_000 })
}

const SEC_ONLY = 'These come from SEC XBRL filings, so they cover US filers only.'

interface Line { label: string; value: number | null; as_of: string | null; form: string | null; tag: string | null }
interface Structure { name: string; price: number | null; market_cap: number | null; lines: Line[]; debt: number; cash: number; net_debt: number; enterprise_value: number | null; debt_to_capital: number | null }

export function CapitalStructure({ command }: ViewProps) {
  const { data, error, loading } = useFacts<Structure>('structure', command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const get = (label: string) => d.lines.find(l => l.label.startsWith(label))?.value ?? 0
        const bridge: [string, number | null, string][] = [
          ['Market value of equity', d.market_cap, 'price × shares, Yahoo'],
          ['+ Debt', d.debt, 'long-term debt, commercial paper, short-term borrowings'],
          ['+ Operating leases', get('Operating lease'), ''],
          ['+ Preferred stock', get('Preferred'), ''],
          ['+ Minority interest', get('Minority'), ''],
          ['− Cash and short-term investments', -d.cash, ''],
          ['= Enterprise value', d.enterprise_value, ''],
        ]
        return (
          <div className="space-y-3">
            {command.fn === 'EV' ? (
              <Table rows={bridge} rowKey={r => r[0]} columns={[
                { head: `${d.name}`, align: 'left', cell: r => (r[0].startsWith('=') ? <b>{r[0]}</b> : r[0]) },
                { head: '', cell: r => (r[0].startsWith('=') ? <b>{big(r[1])}</b> : big(r[1])) },
                { head: '', align: 'left', cell: r => <span className="text-muted-foreground">{r[2]}</span> },
              ]} />
            ) : (
              <>
                <p className="text-[13px] tabular-nums">Debt {big(d.debt)}, cash {big(d.cash)}, net debt <b>{big(d.net_debt)}</b>; debt is {pct((d.debt_to_capital ?? 0) * 100, false)} of debt plus market equity.</p>
                <Table rows={d.lines} rowKey={l => l.label} columns={[
                  { head: 'Line', align: 'left', cell: l => <b>{l.label}</b> },
                  { head: 'Amount', cell: l => big(l.value) },
                  { head: 'As of', align: 'left', cell: l => l.as_of ?? '—' },
                  { head: 'Filing', align: 'left', cell: l => l.form ?? '' },
                  { head: 'XBRL tag', align: 'left', cell: l => <span className="text-muted-foreground text-[11px]">{l.tag ?? ''}</span> },
                ]} />
              </>
            )}
            <Note>Balance-sheet lines from the latest filing that reports each one; the market value is today&apos;s. {SEC_ONLY}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

export function Maturities({ command }: ViewProps) {
  const { data, error, loading } = useFacts<{ as_of: string | null; rows: { bucket: string; amount: number | null }[]; total: number }>('maturities', command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => !d.as_of ? <Note>No debt maturity schedule in {command.security!.label}&apos;s filings. {SEC_ONLY}</Note> : (
        <div className="space-y-3">
          {d.rows.map(r => (
            <div key={r.bucket} className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="w-28">{r.bucket}</span>
              <div className="flex-1 h-3 bg-muted rounded"><div className="h-3 rounded bg-indigo-500" style={{ width: `${((r.amount ?? 0) / Math.max(...d.rows.map(x => x.amount ?? 0), 1)) * 100}%` }} /></div>
              <span className="w-20 text-right">{big(r.amount)}</span>
            </div>
          ))}
          <Note>Principal falling due, from the debt maturity table in the annual report for the year to {d.as_of}: {big(d.total)} in all. {SEC_ONLY}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Z { year_end: string; z: number; zone: string; parts: Record<string, number> }

export function AltmanZ({ command }: ViewProps) {
  const { data, error, loading } = useFacts<{ name: string; years: Z[] }>('zscore', command.security!.symbol)
  const ZONE = { safe: 'text-emerald-600 dark:text-emerald-400', grey: 'text-amber-600 dark:text-amber-400', distress: 'text-rose-600 dark:text-rose-400' } as Record<string, string>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.years.length === 0 ? <Note>Not enough in the filings to score {command.security!.label} (banks and insurers have no current assets). {SEC_ONLY}</Note> : (
        <div className="space-y-3">
          <TimeSeriesChart H={160} series={[{ label: 'Z', cls: 'stroke-indigo-500', points: d.years.map(y => ({ t: y.year_end, v: y.z })) },
            { label: '2.99', cls: 'stroke-emerald-500', dash: '3 3', points: d.years.map(y => ({ t: y.year_end, v: 2.99 })) },
            { label: '1.81', cls: 'stroke-rose-400', dash: '3 3', points: d.years.map(y => ({ t: y.year_end, v: 1.81 })) }]} />
          <Table rows={[...d.years].reverse()} rowKey={y => y.year_end} columns={[
            { head: 'Year end', align: 'left', cell: y => y.year_end },
            { head: 'Z', cell: y => <b>{y.z.toFixed(2)}</b> },
            { head: 'Zone', align: 'left', cell: y => y.zone, className: y => ZONE[y.zone] },
            { head: '1.2 × WC/TA', cell: y => y.parts.working_capital.toFixed(2) },
            { head: '1.4 × RE/TA', cell: y => y.parts.retained_earnings.toFixed(2) },
            { head: '3.3 × EBIT/TA', cell: y => y.parts.ebit.toFixed(2) },
            { head: '0.6 × MVE/TL', cell: y => y.parts.market_to_liabilities.toFixed(2) },
            { head: '1.0 × Sales/TA', cell: y => y.parts.sales.toFixed(2) },
          ]} />
          <Note>Altman&apos;s 1968 Z-score for public companies: above 2.99 safe, 1.81 to 2.99 grey, below 1.81 distress. Built for manufacturers; it reads service and financial firms poorly. Market value is the year-end price times diluted shares. {SEC_ONLY}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Risk { symbol: string; name?: string; equity?: number; equity_vol?: number; default_point?: number; assets?: number; asset_vol?: number; distance_to_default?: number; default_probability?: number; rate?: number; error?: string }

const MERTON = "Merton's model treats the shares as an option on the company's assets with the debt as strike. Default point: liabilities due within a year plus half the long-term debt (Moody's KMV rule). Equity volatility from a year of daily prices. The probability is the model's normal one and understates real default rates; distance to default ranks companies better than it prices them."

export function DefaultRisk({ command }: ViewProps) {
  const { data, error, loading } = useFacts<Risk>('default', command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.error ? <Fail message={d.error} /> : (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">Distance to default <b className="text-[16px]">{d.distance_to_default!.toFixed(2)}</b> standard deviations; one-year default probability {(d.default_probability! * 100).toFixed(4)}%.</p>
          <Table rows={[
            ['Market value of equity', big(d.equity)], ['Equity volatility, a year', pct(d.equity_vol! * 100, false)],
            ['Default point', big(d.default_point)], ['Implied asset value', big(d.assets)], ['Implied asset volatility', pct(d.asset_vol! * 100, false)],
            ['Risk-free rate, one year', pct(d.rate! * 100, false)],
          ]} rowKey={r => r[0]} columns={[{ head: d.name ?? '', align: 'left', cell: r => r[0] }, { head: '', cell: r => r[1] }]} />
          <Note>{MERTON} {SEC_ONLY}</Note>
        </div>
      )}
    </Fetched>
  )
}

export function DefaultMonitor({ command, run }: ViewProps) {
  const names = [command.security?.symbol, ...command.args.map(argSymbol)].filter(Boolean) as string[]
  const { data, error, loading } = useResource<{ rows: Risk[] }>(names.length ? `/api/terminal/default-risk?symbols=${encodeURIComponent(names.join(','))}` : null)
  if (!names.length) return <Note>Name the companies: DRAM F GM CCL AAL T. Up to 30.</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={[...d.rows].sort((a, b) => (a.distance_to_default ?? 99) - (b.distance_to_default ?? 99))} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DRSK`)} columns={[
            { head: 'Company', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
            { head: 'Distance to default', cell: r => (r.distance_to_default == null ? '—' : r.distance_to_default.toFixed(2)), className: r => ((r.distance_to_default ?? 99) < 2 ? 'text-rose-600 dark:text-rose-400 font-semibold' : '') },
            { head: 'Default probability', cell: r => (r.default_probability == null ? '—' : `${(r.default_probability * 100).toFixed(3)}%`) },
            { head: 'Equity vol', cell: r => (r.equity_vol == null ? '—' : pct(r.equity_vol * 100, false)) },
            { head: 'Equity', cell: r => big(r.equity) },
            { head: 'Default point', cell: r => big(r.default_point) },
            { head: 'Note', align: 'left', cell: r => <span className="text-muted-foreground">{r.error ?? ''}</span> },
          ]} />
          <Note>Riskiest first. {MERTON}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Field { label: string; annual: { end: string; val: number }[]; quarterly: { end: string; val: number; derived?: boolean }[] }

export function GraphFundamentals({ command, run }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useFacts<{ name: string; fields: Record<string, Field> }>('fundamentals', sec.symbol)
  const [period, setPeriod] = useState<'annual' | 'quarterly'>('annual')
  const picked = (command.args[0] ?? 'revenue').toLowerCase()
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const key = picked in d.fields ? picked : 'revenue'
        const f = d.fields[key]
        const rows = f[period]
        const margin = key.endsWith('margin')
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {Object.entries(d.fields).filter(([k]) => k !== 'capex').map(([k, v]) => (
                <button key={k} onClick={() => run(`${sec.label} ${command.fn} ${k}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${k === key ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{v.label}</button>
              ))}
              <span className="w-3" />
              {(['annual', 'quarterly'] as const).map(p => (
                <button key={p} onClick={() => setPeriod(p)} className={`text-[11px] px-2 py-0.5 rounded-full ${p === period ? 'bg-indigo-600 text-white font-semibold' : 'bg-muted/60 text-muted-foreground'}`}>{p}</button>
              ))}
            </div>
            {rows.length < 2 ? <Note>Not enough {period} data. {SEC_ONLY}</Note> : (
              <>
                <TimeSeriesChart H={220} zeroLine series={[{ label: f.label, cls: 'stroke-indigo-500', fill: 'fill-indigo-500/10', points: rows.map(r => ({ t: r.end, v: r.val })) }]}
                  yFmt={margin ? (v => `${v.toFixed(0)}%`) : key === 'eps' ? (v => v.toFixed(2)) : (v => big(v))} />
                <Table rows={[...rows].reverse().slice(0, 12)} rowKey={r => r.end} columns={[
                  { head: 'Period end', align: 'left', cell: r => r.end },
                  { head: f.label, cell: r => (margin ? `${r.val.toFixed(1)}%` : key === 'eps' ? r.val.toFixed(2) : big(r.val)) },
                  { head: 'Change', cell: r => { const i = rows.findIndex(x => x.end === r.end); const p = rows[i - (period === 'quarterly' ? 4 : 1)]; return p && p.val && !margin ? pct((r.val / p.val - 1) * 100) : '' }, className: r => { const i = rows.findIndex(x => x.end === r.end); const p = rows[i - (period === 'quarterly' ? 4 : 1)]; return p ? tone(r.val - p.val) : '' } },
                ]} />
              </>
            )}
            <Note>{d.name}, as filed with the SEC. Quarterly changes are against the same quarter a year before; a fourth quarter is the year less its first three. {SEC_ONLY}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Pe { name: string; rows: { date: string; close: number; eps_ttm: number; pe: number | null }[]; stats: { median: number | null; low_decile: number | null; high_decile: number | null } }

export function PeHistory({ command }: ViewProps) {
  const { data, error, loading } = useFacts<Pe>('pe', command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        if (d.rows.length < 30) return <Note>Not enough filed earnings to build a history. {SEC_ONLY}</Note>
        const s = d.stats
        const last = d.rows[d.rows.length - 1]
        if (command.fn === 'PEBD') {
          const band = (m: number | null, label: string, cls: string) => ({ label, cls, dash: '4 3', points: d.rows.map(r => ({ t: r.date, v: m == null ? NaN : m * r.eps_ttm })).filter(p => !isNaN(p.v)) })
          return (
            <div className="space-y-3">
              <ChartLegend items={[{ label: 'Price', cls: 'stroke-foreground' }, { label: `${s.high_decile?.toFixed(0)}× earnings`, cls: 'stroke-rose-400', dash: true }, { label: `${s.median?.toFixed(0)}× (median)`, cls: 'stroke-amber-500', dash: true }, { label: `${s.low_decile?.toFixed(0)}×`, cls: 'stroke-emerald-500', dash: true }]} />
              <TimeSeriesChart H={260} series={[{ label: 'Price', cls: 'stroke-foreground', points: d.rows.map(r => ({ t: r.date, v: r.close })) },
                band(s.high_decile, 'high', 'stroke-rose-400'), band(s.median, 'median', 'stroke-amber-500'), band(s.low_decile, 'low', 'stroke-emerald-500')]} />
              <Note>The price against what it would be at the stock&apos;s own usual P/E multiples (its 10th, 50th and 90th percentile over the period) times trailing earnings, each earnings figure used from the day it was filed. {SEC_ONLY}</Note>
            </div>
          )
        }
        const pts = d.rows.filter(r => r.pe != null && r.pe < 200)
        return (
          <div className="space-y-3">
            <p className="text-[13px] tabular-nums">P/E now <b className="text-[16px]">{last.pe?.toFixed(1) ?? '—'}</b> on trailing EPS of {price(last.eps_ttm)}; median {s.median?.toFixed(1)}, usual range {s.low_decile?.toFixed(1)} to {s.high_decile?.toFixed(1)}.</p>
            <TimeSeriesChart H={240} series={[{ label: 'P/E', cls: 'stroke-indigo-500', points: pts.map(r => ({ t: r.date, v: r.pe! })) },
              { label: 'median', cls: 'stroke-amber-500', dash: '4 3', points: pts.map(r => ({ t: r.date, v: s.median ?? NaN })) }]} />
            <Note>Daily price over the trailing twelve months&apos; diluted EPS as filed with the SEC, each figure used only from its filing date, adjusted for splits. Loss-making stretches have no P/E. {SEC_ONLY}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Reported { name: string; cik: number; lines: { label: string; years: { end: string; first: number; first_filed: string; latest: number; latest_filed: string; accession: string | null; tag: string; changed: boolean }[] }[] }

export function AsReported({ command }: ViewProps) {
  const { data, error, loading } = useFacts<Reported>('reported', command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const ends = Array.from(new Set(d.lines.flatMap(l => l.years.map(y => y.end)))).sort().slice(-5)
        const fmt = (label: string, v: number) => (label.includes('EPS') ? v.toFixed(2) : big(v))
        return (
          <div className="space-y-3">
            <Table rows={d.lines} rowKey={l => l.label} columns={[
              { head: 'As filed in 10-Ks', align: 'left', cell: l => <b>{l.label}</b> },
              ...ends.map(end => ({
                head: end, cell: (l: Reported['lines'][number]) => {
                  const y = l.years.find(x => x.end === end)
                  if (!y) return '—'
                  return y.changed
                    ? <span title={`first filed ${fmt(l.label, y.first)} on ${y.first_filed}; now ${fmt(l.label, y.latest)} (${y.latest_filed})`} className="text-amber-600 dark:text-amber-400">{fmt(l.label, y.latest)}*</span>
                    : fmt(l.label, y.latest)
                },
              })),
            ]} />
            <Note>Annual figures exactly as the company filed them, by fiscal year end. * marks a figure a later 10-K changed (a restatement, a reclassification or a stock split); hover for the first-filed value. {SEC_ONLY}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
