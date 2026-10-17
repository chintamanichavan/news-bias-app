import { useState } from 'react'
import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { pct, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Effect {
  sector: string; port_weight: number; bench_weight: number; port_return: number | null; bench_return: number
  allocation: number; selection: number; interaction: number
}
interface Period {
  portfolio: number; benchmark: number | null; sector_benchmark: number
  contributions: { symbol: string; sector: string; weight: number; return: number; contribution: number }[]
  sectors: Effect[]; missing: string[]
}

const PERIODS: [string, string][] = [['1m', '1 month'], ['3m', '3 months'], ['ytd', 'This year'], ['1y', '1 year']]
const p100 = (v: number | null | undefined, signed = true) => pct(v == null ? null : v * 100, signed)

export default function Attribution({ run }: ViewProps) {
  const { data, error, loading } = useResource<{ empty?: boolean; periods: Record<string, Period | null> }>('/api/terminal/attribution', { freshMs: 10 * 60_000 })
  const [key, setKey] = useState('1y')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        if (d.empty) return <Note>No holdings to explain. <button className="underline" onClick={() => run('PRTU')}>Load them with PRTU</button>.</Note>
        const p = d.periods[key]
        const effects = p ? p.sectors.filter(e => e.port_weight || e.bench_weight) : []
        const sum = (f: 'allocation' | 'selection' | 'interaction') => effects.reduce((s, e) => s + e[f], 0)
        return (
          <div className="space-y-4">
            <div className="flex gap-1">
              {PERIODS.map(([k, label]) => (
                <button key={k} onClick={() => setKey(k)}
                  className={`text-[11px] px-2 py-0.5 rounded-full ${k === key ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
            {!p ? <Note>Not enough history for this period.</Note> : (
              <>
                <p className="text-[13px] tabular-nums">
                  Your book <b className={tone(p.portfolio)}>{p100(p.portfolio)}</b> · S&amp;P 500 (SPY) {p100(p.benchmark)} ·
                  difference <b className={tone(p.portfolio - (p.benchmark ?? 0))}>{p100(p.benchmark == null ? null : p.portfolio - p.benchmark)}</b>
                </p>
                <div>
                  <p className="news-section-label mb-1">What each holding added</p>
                  <Table rows={p.contributions} rowKey={c => c.symbol}
                    columns={[
                      { head: 'Security', align: 'left', cell: c => <span><b>{c.symbol}</b> <span className="text-muted-foreground">{c.sector}</span></span> },
                      { head: 'Weight', cell: c => p100(c.weight, false) },
                      { head: 'Return', cell: c => p100(c.return), className: c => tone(c.return) },
                      { head: 'Contribution', cell: c => p100(c.contribution), className: c => `font-semibold ${tone(c.contribution)}` },
                    ]} />
                </div>
                <div>
                  <p className="news-section-label mb-1">Against the S&amp;P 500, by sector (Brinson)</p>
                  <Table rows={effects} rowKey={e => e.sector}
                    columns={[
                      { head: 'Sector', align: 'left', cell: e => e.sector },
                      { head: 'Your weight', cell: e => p100(e.port_weight, false) },
                      { head: 'S&P weight', cell: e => p100(e.bench_weight, false) },
                      { head: 'Your return', cell: e => p100(e.port_return) },
                      { head: 'Sector return', cell: e => p100(e.bench_return) },
                      { head: 'Allocation', cell: e => p100(e.allocation), className: e => tone(e.allocation) },
                      { head: 'Selection', cell: e => p100(e.selection), className: e => tone(e.selection) },
                      { head: 'Interaction', cell: e => p100(e.interaction), className: e => tone(e.interaction) },
                    ]} />
                  <p className="mt-1 text-[12px] tabular-nums">
                    Totals: allocation {p100(sum('allocation'))}, selection {p100(sum('selection'))}, interaction {p100(sum('interaction'))};
                    together {p100(sum('allocation') + sum('selection') + sum('interaction'))}, which is your return less the
                    sector benchmark&rsquo;s {p100(p.sector_benchmark)}.
                  </p>
                </div>
              </>
            )}
            <Note>
              Assumes today&rsquo;s holdings were held for the whole period. Allocation is the gain from leaning towards
              sectors that did well; selection is from picking better holdings within a sector. The benchmark is the
              S&amp;P 500&rsquo;s sector weights applied to each sector&rsquo;s SPDR fund, so it differs slightly from
              SPY itself. Funds, bonds and crypto count as &ldquo;Other&rdquo;.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
