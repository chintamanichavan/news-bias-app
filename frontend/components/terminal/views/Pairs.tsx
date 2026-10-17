import { useEffect, useState } from 'react'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import type { Bar } from '../Candles'
import { Fail, Loading, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { argSymbol } from '@/lib/terminal/parse'
import { historicalVol } from '@/lib/terminal/studies'
import { fetchJSON } from '@/lib/useResource'

// Two or more securities against each other: spread and ratio (HS, HSP,
// HSE, SGP, GR), the ratio's z-score (HSN), the same intraday (SGIP, ISGP),
// and their volatilities side by side (GV).

const SPANS: Record<string, string> = { '1Y': '1y', '2Y': '2y', '5Y': '5y' }
const INTRADAY: Record<string, string> = { '1D': '1d', '5D': '5d', '1M': '1mo' }
const COLOURS = ['stroke-foreground', 'stroke-indigo-500', 'stroke-amber-500', 'stroke-emerald-500', 'stroke-rose-500', 'stroke-sky-500']

function useMany(symbols: string[], url: (s: string) => string) {
  const key = symbols.map(url).join('|')
  const [state, setState] = useState<{ key: string; data: Record<string, Bar[]> | null; error: string | null }>({ key: '', data: null, error: null })
  useEffect(() => {
    let alive = true
    Promise.all(symbols.map(s => fetchJSON<{ bars: Bar[] }>(url(s)).then(r => [s, r.bars] as const).catch(() => [s, [] as Bar[]] as const)))
      .then(pairs => { if (alive) setState({ key, data: Object.fromEntries(pairs), error: null }) })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { data: null, error: null }
}

/** Closes of both on the dates both have. */
export function joined(a: Bar[], b: Bar[]): { t: string; a: number; b: number }[] {
  const bb = new Map(b.map(x => [x.date, x.close]))
  return a.filter(x => bb.has(x.date)).map(x => ({ t: x.date, a: x.close, b: bb.get(x.date)! }))
}

export function zScores(xs: number[]): number[] {
  const m = xs.reduce((s, v) => s + v, 0) / xs.length
  const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)) || 1
  return xs.map(v => (v - m) / sd)
}

export default function Pairs({ command, run }: ViewProps) {
  const intraday = command.fn === 'SGIP' || command.fn === 'ISGP'
  const choices = intraday ? INTRADAY : SPANS
  const up = command.args.map(a => a.toUpperCase())
  const period = up.find(a => a in choices) ?? (intraday ? (command.fn === 'ISGP' ? '1M' : '5D') : '1Y')
  const others = up.filter(a => !(a in choices))
  const labels = [command.security?.label, ...others].filter((s): s is string => !!s)
  const symbols = labels.map((l, i) => (i === 0 && command.security ? command.security.symbol : argSymbol(l)))
  const url = (s: string) => intraday
    ? `/api/terminal/intraday/${encodeURIComponent(s)}?span=${INTRADAY[period]}`
    : `/api/terminal/bars/${encodeURIComponent(s)}?span=${SPANS[period]}`
  const { data } = useMany(symbols, url)
  const isGV = command.fn === 'GV'
  if (labels.length < 2) return <Note>Name a second security: {command.security?.label ?? 'AAPL'} {command.fn} MSFT{isGV ? ' KO SPX' : ''}, with a period ({Object.keys(choices).join(', ')}).</Note>
  if (!data) return <Loading />
  const missing = labels.filter((_, i) => !data[symbols[i]].length)
  if (missing.length) return <Fail message={`No prices for ${missing.join(', ')}.`} />
  const base = [command.security?.label, command.fn, ...others].filter(Boolean).join(' ')
  const periods = (
    <div className="flex gap-1">
      {Object.keys(choices).map(p => (
        <button key={p} onClick={() => run(`${base} ${p}`)}
          className={`text-[11px] px-2 py-0.5 rounded-full ${p === period ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{p}</button>
      ))}
    </div>
  )

  if (isGV) {
    const lines = symbols.map((s, i) => {
      const bars = data[s]
      const v = historicalVol(bars.map(b => b.close), 30)
      return { label: labels[i], cls: COLOURS[i % COLOURS.length], points: bars.map((b, j) => ({ t: b.date, v: v[j] ?? NaN })).filter(p => !isNaN(p.v)) }
    })
    return (
      <div className="space-y-2">
        {periods}
        <ChartLegend items={lines.map(l => ({ label: l.label, cls: l.cls }))} />
        <TimeSeriesChart series={lines} H={240} unit="%" />
        <Note>30-day historical volatility of each, annualised, in percent.</Note>
      </div>
    )
  }

  const rows = joined(data[symbols[0]], data[symbols[1]])
  if (rows.length < 10) return <Note>The two have too few dates in common.</Note>
  const [a, b] = labels
  const ratio = rows.map(r => r.a / r.b)
  const spread = rows.map(r => r.a - r.b)
  const z = zScores(ratio)
  const show = command.fn === 'HSN' ? 'z' : command.fn === 'GR' ? 'ratio' : command.fn === 'HSP' || command.fn === 'SGP' ? 'spread' : 'both'
  const stat = (xs: number[]) => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length
    const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1))
    return { now: xs[xs.length - 1], mean: m, sd, high: Math.max(...xs), low: Math.min(...xs), z: (xs[xs.length - 1] - m) / (sd || 1) }
  }
  const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(3))
  return (
    <div className="space-y-3">
      {periods}
      {(show === 'ratio' || show === 'both') && (
        <>
          <p className="news-section-label">Ratio {a} / {b}</p>
          <TimeSeriesChart series={[{ label: 'ratio', cls: 'stroke-indigo-500', points: rows.map((r, i) => ({ t: r.t, v: ratio[i] })) }]} H={180} />
        </>
      )}
      {(show === 'spread' || show === 'both') && (
        <>
          <p className="news-section-label">Spread {a} − {b}</p>
          <TimeSeriesChart zeroLine series={[{ label: 'spread', cls: 'stroke-amber-500', points: rows.map((r, i) => ({ t: r.t, v: spread[i] })) }]} H={160} />
        </>
      )}
      {show === 'z' && (
        <>
          <p className="news-section-label">Ratio {a} / {b} in standard deviations from its mean</p>
          <TimeSeriesChart zeroLine series={[{ label: 'z', cls: 'stroke-indigo-500', points: rows.map((r, i) => ({ t: r.t, v: z[i] })) },
            { label: '+2', cls: 'stroke-rose-400', dash: '3 3', points: rows.map(r => ({ t: r.t, v: 2 })) },
            { label: '-2', cls: 'stroke-emerald-500', dash: '3 3', points: rows.map(r => ({ t: r.t, v: -2 })) }]} H={200} />
        </>
      )}
      <Table rows={[['Ratio', stat(ratio)], ['Spread', stat(spread)]] as const} rowKey={r => r[0]} columns={[
        { head: '', align: 'left', cell: r => <b>{r[0]}</b> },
        { head: 'Now', cell: r => fmt(r[1].now) },
        { head: 'Mean', cell: r => fmt(r[1].mean) },
        { head: 'Std dev', cell: r => fmt(r[1].sd) },
        { head: 'High', cell: r => fmt(r[1].high) },
        { head: 'Low', cell: r => fmt(r[1].low) },
        { head: 'Z now', cell: r => r[1].z.toFixed(2) },
      ]} />
      <Note>{rows.length} {intraday ? 'bars' : 'days'} both traded, {rows[0].t.replace('T', ' ')} to {rows[rows.length - 1].t.replace('T', ' ')}. Prices are not adjusted for dividends.</Note>
    </div>
  )
}
