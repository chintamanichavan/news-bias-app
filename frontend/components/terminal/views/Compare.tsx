import { Fetched, Note, Table } from '../kit'
import { LINE_COLOURS, PERIODS, useReturns } from './returns'
import type { ViewProps } from './types'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { pct, tone } from '@/lib/terminal/numbers'
import { SPANS, splitArgs } from '@/lib/terminal/compare'

/**
 * COMP: total return against benchmarks (SPY and QQQ unless others are
 * named). G: any securities' price on one chart, each starting at 100.
 */
export default function Compare({ command, run }: ViewProps) {
  const isG = command.fn === 'G' || command.fn === 'MGR'
  const { symbols, span } = splitArgs(command.security?.symbol ?? null, command.args, isG ? [] : ['SPY', 'QQQ'])
  const { data, error, loading } = useReturns(symbols, span)
  if (symbols.length === 0) return <Note>Name the securities: G AAPL MSFT NVDA, with a period such as 1Y.</Note>
  const others = command.args.filter(a => !(SPANS as readonly string[]).includes(a.toUpperCase()))
  const base = [command.security?.label, command.fn, ...others].filter(Boolean).join(' ')

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {SPANS.map(s => (
          <button key={s} onClick={() => run(`${base} ${s}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full ${s === span
              ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {s}
          </button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const found = d.series.filter(s => !s.missing)
          const lines = found.map((s, i) => ({
            label: s.symbol,
            points: (isG ? s.price : s.total) ?? [],
            cls: LINE_COLOURS[i % LINE_COLOURS.length],
          }))
          return (
            <>
              <TimeSeriesChart series={lines} H={220} yFmt={v => v.toFixed(0)} />
              <ChartLegend items={lines.map(l => ({ label: l.label, cls: l.cls }))} />
              {!isG && (
                <Table rows={found} rowKey={s => s.symbol}
                  columns={[
                    { head: 'Total return', align: 'left', cell: s => <b>{s.symbol}</b> },
                    ...PERIODS.map(([k, head]) => ({
                      head,
                      cell: (s: typeof found[number]) => pct(s.periods?.[k]?.per_year_pct ?? s.periods?.[k]?.total_pct ?? null),
                      className: (s: typeof found[number]) => tone(s.periods?.[k]?.total_pct ?? null),
                    })),
                  ]} />
              )}
              <Note>
                {isG ? 'Price only, each line starting at 100.' : 'Each line is 100 invested with dividends reinvested. Periods of a year or more are per year.'}
                {d.series.some(s => s.missing) ? ` No data for ${d.series.filter(s => s.missing).map(s => s.symbol).join(', ')}.` : ''}
                {' '}Use provider symbols for indices (^GSPC, ^IXIC).
              </Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
