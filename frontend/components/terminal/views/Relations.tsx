import { useEffect, useState } from 'react'
import { Fail, Loading, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useWidth } from '@/lib/terminal/useWidth'
import { argSymbol } from '@/lib/terminal/parse'
import { adjustedBeta, aligned, correlation, regress, returnsByDate, weekly, type Close } from '@/lib/terminal/stats'
import { fetchJSON } from '@/lib/useResource'

const SPANS: Record<string, number> = { '1Y': 365, '2Y': 730, '5Y': 1826 }
const FREQS = ['DAILY', 'WEEKLY'] as const

/** Daily closes for several symbols at once; a symbol with no data comes
 *  back empty rather than failing the rest. */
function useCloses(symbols: string[], span: string) {
  const key = `${symbols.join(',')}|${span}`
  const [state, setState] = useState<{ key: string; data: Record<string, Close[]> | null; error: string | null }>({ key: '', data: null, error: null })
  useEffect(() => {
    let alive = true
    const fetchSpan = span === '5Y' ? '5y' : '2y'
    Promise.all(symbols.map(s => fetchJSON<{ bars: Close[] }>(`/api/terminal/bars/${encodeURIComponent(s)}?span=${fetchSpan}`)
      .then(r => [s, r.bars] as const).catch(() => [s, [] as Close[]] as const)))
      .then(pairs => { if (alive) setState({ key, data: Object.fromEntries(pairs), error: null }) })
      .catch(e => { if (alive) setState({ key, data: null, error: (e as Error).message }) })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state.key === key ? state : { data: null, error: null }
}

function since(rows: Close[], days: number): Close[] {
  if (!rows.length) return rows
  const cut = new Date(new Date(rows[rows.length - 1].date).getTime() - days * 86_400_000).toISOString().slice(0, 10)
  return rows.filter(r => r.date >= cut)
}

function options(args: string[]) {
  const up = args.map(a => a.toUpperCase())
  const span = up.find(a => a in SPANS) ?? '2Y'
  const freq = up.find(a => (FREQS as readonly string[]).includes(a)) ?? 'WEEKLY'
  const names = up.filter(a => !(a in SPANS) && !(FREQS as readonly string[]).includes(a))
  return { span, freq, names }
}

function Scatter({ points, beta, alpha }: { points: { x: number; y: number }[]; beta: number; alpha: number }) {
  const { ref, width: W } = useWidth<HTMLDivElement>()
  const H = 260, P = 40
  // each axis spans its own data, so a calm benchmark is not squeezed into
  // the middle by a volatile stock (or the other way round)
  const span = (vs: number[]) => Math.max(...vs.map(Math.abs)) * 1.08 || 0.01
  const ex = span(points.map(p => p.x)), ey = span(points.map(p => p.y))
  const sx = (v: number) => P + ((v + ex) / (2 * ex)) * (W - 2 * P)
  const sy = (v: number) => H - P - ((v + ey) / (2 * ey)) * (H - 2 * P)
  const fracs = [-1, -0.5, 0, 0.5, 1]
  return (
    <div ref={ref}>
      <svg width={W} height={H} role="img" aria-label="Regression scatter">
        {fracs.map(f => (
          <g key={f}>
            <line x1={sx(f * ex)} x2={sx(f * ex)} y1={sy(-ey)} y2={sy(ey)} className={f === 0 ? 'stroke-foreground/40' : 'stroke-border/60'} strokeWidth={0.75} />
            <line x1={sx(-ex)} x2={sx(ex)} y1={sy(f * ey)} y2={sy(f * ey)} className={f === 0 ? 'stroke-foreground/40' : 'stroke-border/60'} strokeWidth={0.75} />
            <text x={sx(f * ex)} y={H - P + 14} textAnchor="middle" fontSize={9.5} className="fill-muted-foreground tabular-nums">{(f * ex * 100).toFixed(1)}%</text>
            <text x={P - 4} y={sy(f * ey) + 3} textAnchor="end" fontSize={9.5} className="fill-muted-foreground tabular-nums">{(f * ey * 100).toFixed(1)}%</text>
          </g>
        ))}
        {points.map((p, i) => <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2} className="fill-indigo-500/60" />)}
        <line x1={sx(-ex)} y1={sy(alpha - beta * ex)} x2={sx(ex)} y2={sy(alpha + beta * ex)} className="stroke-rose-500" strokeWidth={1.5} />
      </svg>
    </div>
  )
}

/** HRA: the security's returns regressed on a benchmark's (SPX unless named). */
export function Hra({ command, run }: ViewProps) {
  const sec = command.security!
  const { span, freq, names } = options(command.args)
  const bench = argSymbol(names[0] ?? 'SPX')
  const { data, error } = useCloses([sec.symbol, bench], span)
  if (error) return <Fail message={error} />
  if (!data) return <Loading />
  const prep = (rows: Close[]) => {
    const r = since(rows, SPANS[span])
    return returnsByDate(freq === 'WEEKLY' ? weekly(r) : r)
  }
  if (!data[bench].length) return <Fail message={`No prices for ${names[0] ?? 'SPX'}.`} />
  const pairs = aligned(prep(data[bench]), prep(data[sec.symbol]))
  const fit = regress(pairs.map(p => p.x), pairs.map(p => p.y))
  if (!fit) return <Note>Not enough overlapping prices to regress.</Note>
  const base = `${sec.label} HRA ${names[0] ?? ''}`.trim()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {[...Object.keys(SPANS), ...FREQS].map(a => {
          const on = a === span || a === freq
          const next = a in SPANS ? `${base} ${a} ${freq}` : `${base} ${span} ${a}`
          return <button key={a} onClick={() => run(next)} className={`text-[11px] px-2 py-0.5 rounded-full ${on ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{a.toLowerCase()}</button>
        })}
      </div>
      <Scatter points={pairs} beta={fit.beta} alpha={fit.alpha} />
      <Table rows={[
        ['Raw beta', fit.beta.toFixed(3)], ['Adjusted beta', adjustedBeta(fit.beta).toFixed(3)],
        [`Alpha per ${freq === 'WEEKLY' ? 'week' : 'day'}`, `${(fit.alpha * 100).toFixed(3)}%`],
        ['R²', fit.r2.toFixed(3)], ['Correlation', fit.correlation?.toFixed(3) ?? '—'],
        ['Standard error of beta', fit.seBeta.toFixed(3)], ['t of beta', fit.t?.toFixed(1) ?? '—'],
        ['Observations', String(fit.n)], ['From', pairs[0].date], ['To', pairs[pairs.length - 1].date],
      ]} rowKey={r => r[0]} columns={[
        { head: `${sec.label} on ${names[0] ?? 'SPX'}`, align: 'left', cell: r => r[0] },
        { head: '', cell: r => r[1] },
      ]} />
      <Note>
        Least squares of {freq.toLowerCase()} price returns over {span.toLowerCase()}. The default, two years of weekly
        returns, is Bloomberg&apos;s. Adjusted beta is Blume&apos;s: two thirds raw plus one third of 1. Dividends are left out of the returns.
      </Note>
    </div>
  )
}

/** CORR: a correlation matrix of returns. */
export function Corr({ command }: ViewProps) {
  const { span, freq, names } = options(command.args)
  const labels = [command.security?.label, ...names].filter((s): s is string => !!s)
  const symbols = labels.map((l, i) => (i === 0 && command.security ? command.security.symbol : argSymbol(l)))
  const { data, error } = useCloses(symbols, span)
  if (labels.length < 2) return <Note>Name two or more securities: CORR AAPL MSFT KO XOM SPX, with 1Y, 2Y or 5Y and DAILY or WEEKLY.</Note>
  if (error) return <Fail message={error} />
  if (!data) return <Loading />
  const rets = symbols.map(s => {
    const r = since(data[s], SPANS[span])
    return returnsByDate(freq === 'WEEKLY' ? weekly(r) : r)
  })
  const cell = (i: number, j: number) => {
    const p = aligned(rets[i], rets[j])
    return correlation(p.map(q => q.x), p.map(q => q.y))
  }
  const missing = labels.filter((_, i) => !data[symbols[i]].length)
  const shade = (c: number | null) => c == null ? '' : c >= 0.7 ? 'bg-emerald-500/30' : c >= 0.4 ? 'bg-emerald-500/15' : c <= -0.4 ? 'bg-rose-500/25' : c < 0 ? 'bg-rose-500/10' : ''
  return (
    <div className="space-y-3">
      {missing.length > 0 && <Fail message={`No prices for ${missing.join(', ')}.`} />}
      <div className="overflow-x-auto">
        <table className="text-[12px] tabular-nums">
          <thead><tr><th />{labels.map(l => <th key={l} className="px-2 py-1 font-semibold">{l}</th>)}</tr></thead>
          <tbody>
            {labels.map((l, i) => (
              <tr key={l}>
                <th className="px-2 py-1 text-left font-semibold">{l}</th>
                {labels.map((m, j) => {
                  const c = i === j ? 1 : cell(i, j)
                  return <td key={m} className={`px-2 py-1 text-right ${shade(c)}`}>{c == null ? '—' : c.toFixed(2)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Note>Correlation of {freq.toLowerCase()} price returns over {span.toLowerCase()}, each pair on the dates both traded.</Note>
    </div>
  )
}
