import { ChartLegend, TimeSeriesChart, type Series } from '@/components/quantviz'
import Candles, { type Bar } from '../Candles'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { bollinger, macd, readings, rsi, sma, type Line } from '@/lib/terminal/studies'
import { useResource } from '@/lib/useResource'

// Two years of daily bars are fetched so every study has its warm-up
// (200 days for the long average) before the first day shown.
const WINDOWS: Record<string, number> = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }

function useBars(symbol: string) {
  return useResource<{ bars: Bar[] }>(`/api/terminal/bars/${encodeURIComponent(symbol)}?span=2y`)
}

function windowFor(args: string[], fallback: string): number | string {
  const a = (args[0] ?? fallback).toUpperCase()
  return WINDOWS[a] ?? `Period ${args[0]} is not available. Use ${Object.keys(WINDOWS).join(', ')}.`
}

function Periods({ command, run, n }: ViewProps & { n: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(WINDOWS).map(([a, days]) => (
        <button key={a} onClick={() => run(`${command.security!.label} ${command.fn} ${a}`)}
          className={`text-[11px] px-2 py-0.5 rounded-full ${days === n ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{a}</button>
      ))}
    </div>
  )
}

/** The last n points of a study as a chart line, dates attached. A study
 *  still warming up somewhere in the window is left out rather than drawn
 *  stretched across dates it does not cover (a young stock's 200-day line). */
const tail = (bars: Bar[], line: Line, n: number, label: string, cls: string, dash?: string): Series => {
  const values = line.slice(-n)
  const whole = values.length === n && values.every(v => v != null)
  return { label, cls, dash, points: whole ? bars.slice(-n).map((b, i) => ({ t: b.date, v: values[i]! })) : [] }
}

export function PriceBars(props: ViewProps) {
  const { command } = props
  const n = windowFor(command.args, '6M')
  const { data, error, loading } = useBars(command.security!.symbol)
  if (typeof n === 'string') return <Fail message={n} />
  return (
    <div className="space-y-2">
      <Periods {...props} n={n} />
      <Fetched data={data} error={error} loading={loading}>
        {d => <Candles bars={d.bars.slice(-n)} style={command.fn === 'GPO' ? 'ohlc' : 'candle'} />}
      </Fetched>
    </div>
  )
}

export function Study(props: ViewProps) {
  const { command } = props
  const n = windowFor(command.args, '6M')
  const { data, error, loading } = useBars(command.security!.symbol)
  if (typeof n === 'string') return <Fail message={n} />
  return (
    <div className="space-y-3">
      <Periods {...props} n={n} />
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const closes = d.bars.map(b => b.close)
          if (closes.length < n + 30) return <Note>Not enough history for this study.</Note>
          const price = tail(d.bars, closes, n, 'Close', 'stroke-foreground')
          if (command.fn === 'RSI') {
            return (
              <>
                <TimeSeriesChart series={[price]} H={170} />
                <TimeSeriesChart series={[tail(d.bars, rsi(closes), n, 'RSI 14', 'stroke-indigo-500'),
                  tail(d.bars, closes.map(() => 70), n, '70', 'stroke-rose-400', '3 3'),
                  tail(d.bars, closes.map(() => 30), n, '30', 'stroke-emerald-500', '3 3')]} H={130} />
                <Note>Wilder&apos;s 14-day relative strength index. 70 or more is usually read as overbought, 30 or less as oversold.</Note>
              </>
            )
          }
          if (command.fn === 'MACD') {
            const m = macd(closes)
            return (
              <>
                <TimeSeriesChart series={[price]} H={170} />
                <ChartLegend items={[{ label: 'MACD', cls: 'stroke-indigo-500' }, { label: 'Signal', cls: 'stroke-amber-500' }, { label: 'Histogram', cls: 'stroke-muted-foreground', dash: true }]} />
                <TimeSeriesChart zeroLine series={[tail(d.bars, m.macd, n, 'MACD', 'stroke-indigo-500'),
                  tail(d.bars, m.signal, n, 'Signal', 'stroke-amber-500'),
                  tail(d.bars, m.histogram, n, 'Histogram', 'stroke-muted-foreground', '2 2')]} H={140} />
                <Note>12- and 26-day exponential averages; MACD is their gap, the signal line its 9-day average, the histogram the difference.</Note>
              </>
            )
          }
          if (command.fn === 'BOLL') {
            const b = bollinger(closes)
            return (
              <>
                <TimeSeriesChart series={[price, tail(d.bars, b.upper, n, 'Upper', 'stroke-indigo-400', '4 3'),
                  tail(d.bars, b.middle, n, '20-day average', 'stroke-amber-500'), tail(d.bars, b.lower, n, 'Lower', 'stroke-indigo-400', '4 3')]} H={240} />
                <Note>Bollinger bands: the 20-day average plus and minus two standard deviations of the closes.</Note>
              </>
            )
          }
          // TECH: the price with its long averages and every study read at the last close
          return (
            <>
              <ChartLegend items={[{ label: 'Close', cls: 'stroke-foreground' }, { label: '50-day', cls: 'stroke-amber-500' }, { label: '200-day', cls: 'stroke-indigo-500' }]} />
              <TimeSeriesChart series={[price, tail(d.bars, sma(closes, 50), n, '50-day', 'stroke-amber-500'),
                tail(d.bars, sma(closes, 200), n, '200-day', 'stroke-indigo-500')]} H={220} />
              <Table rows={readings(closes)} rowKey={r => r.study}
                columns={[
                  { head: 'Study', align: 'left', cell: r => r.study },
                  { head: 'Reading', cell: r => (r.value == null ? '—' : r.value.toFixed(2)) },
                  { head: 'Meaning', align: 'left', cell: r => r.meaning },
                ]} />
              <Note>Readings at the last daily close, {d.bars[d.bars.length - 1].date}. These describe the trend; they are not a forecast.</Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
