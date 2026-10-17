import type { ReactNode } from 'react'
import { ChartLegend, TimeSeriesChart, type Series } from '@/components/quantviz'
import Candles, { type Bar } from '../Candles'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useDividends } from './Dividends'
import { pct, price, tone } from '@/lib/terminal/numbers'
import {
  bollinger, candlePatterns, cci, chaikin, dmi, envelopes, historicalVol, hurst, ichimoku, macd, moneyFlow, obv,
  parabolicSar, pivots, pointAndFigure, readings, roc, rsi, seasonality, sma, stochastic, williamsR, type Line,
} from '@/lib/terminal/studies'
import { useResource } from '@/lib/useResource'

// Every chart study, daily and intraday, in one place. Daily studies fetch
// two years of bars so each has its warm-up (200 days for the long average)
// before the first day shown. Intraday ones (codes starting with I, and
// GIM) use 2-minute bars over a day, 5-minute over five days or 30-minute
// over a month, and show what is left after the warm-up.

const DAILY: Record<string, number> = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252 }
const INTRADAY: Record<string, string> = { '1D': '1d', '5D': '5d', '1M': '1mo' }
const WARMUP = 60

function useBars(symbol: string, intraday: string | null) {
  return useResource<{ bars: Bar[] }>(intraday
    ? `/api/terminal/intraday/${encodeURIComponent(symbol)}?span=${intraday}`
    : `/api/terminal/bars/${encodeURIComponent(symbol)}?span=2y`, { freshMs: intraday ? 60_000 : 60 * 60_000 })
}

/** The last n points of a study as a chart line, dates attached. A study
 *  still warming up somewhere in the window is left out rather than drawn
 *  stretched across dates it does not cover (a young stock's 200-day line). */
export const tail = (bars: Bar[], line: Line, n: number, label: string, cls: string, dash?: string): Series => {
  const values = line.slice(-n)
  const whole = values.length === n && values.every(v => v != null)
  return { label, cls, dash, points: whole ? bars.slice(-n).map((b, i) => ({ t: b.date, v: values[i]! })) : [] }
}

const level = (bars: Bar[], v: number, n: number, label: string, cls: string): Series => tail(bars, bars.map(() => v), n, label, cls, '3 3')

interface Ctx { bars: Bar[]; closes: number[]; n: number; intraday: boolean; symbol: string }

type Study = (c: Ctx) => ReactNode

const priceLine = ({ bars, closes, n }: Ctx) => tail(bars, closes, n, 'Close', 'stroke-foreground')

function Price({ c, extra = [], H = 170 }: { c: Ctx; extra?: Series[]; H?: number }) {
  return <TimeSeriesChart series={[priceLine(c), ...extra]} H={H} />
}

function Lower({ series, zero = false, H = 130, legend }: { series: Series[]; zero?: boolean; H?: number; legend?: boolean }) {
  return (
    <>
      {legend && <ChartLegend items={series.map(s => ({ label: s.label, cls: s.cls, dash: !!s.dash }))} />}
      <TimeSeriesChart series={series} zeroLine={zero} H={H} />
    </>
  )
}

function Pivots({ c }: { c: Ctx }) {
  // daily pivots from the last complete day; intraday from the previous session
  const { bars } = c
  const prev = c.intraday ? sessionBefore(bars) : bars[bars.length - 2]
  if (!prev) return <Note>Not enough bars for pivots.</Note>
  const p = pivots(prev.high, prev.low, prev.close)
  const rows = Object.entries(p).sort((a, b) => b[1] - a[1])
  return (
    <>
      <Price c={c} extra={rows.map(([k, v]) => level(bars, v, c.n, k.toUpperCase(), k === 'pivot' ? 'stroke-amber-500' : k.startsWith('r') ? 'stroke-rose-400' : 'stroke-emerald-500'))} H={240} />
      <Table rows={rows} rowKey={r => r[0]} columns={[
        { head: 'Level', align: 'left', cell: r => <b>{r[0].toUpperCase()}</b> },
        { head: 'Price', cell: r => price(r[1]) },
        { head: 'From last', cell: r => pct((r[1] / c.closes[c.closes.length - 1] - 1) * 100), className: r => tone(r[1] - c.closes[c.closes.length - 1]) },
      ]} />
      <Note>Classic floor pivots from {c.intraday ? 'the previous session' : 'the previous day'}: high {price(prev.high)}, low {price(prev.low)}, close {price(prev.close)}. Pivot = (H + L + C) / 3.</Note>
    </>
  )
}

/** The previous trading day's high, low and close from intraday bars. */
function sessionBefore(bars: Bar[]): Bar | null {
  const lastDay = bars[bars.length - 1].date.slice(0, 10)
  const prior = bars.filter(b => b.date.slice(0, 10) < lastDay)
  if (!prior.length) return null
  const day = prior[prior.length - 1].date.slice(0, 10)
  const s = prior.filter(b => b.date.slice(0, 10) === day)
  return { date: day, open: s[0].open, high: Math.max(...s.map(b => b.high)), low: Math.min(...s.map(b => b.low)), close: s[s.length - 1].close, volume: null }
}

function vwapLine(bars: Bar[]): Line {
  // resets each session, as VWAP does
  let day = '', pv = 0, v = 0
  return bars.map(b => {
    if (b.date.slice(0, 10) !== day) { day = b.date.slice(0, 10); pv = 0; v = 0 }
    pv += ((b.high + b.low + b.close) / 3) * (b.volume ?? 0); v += b.volume ?? 0
    return v ? pv / v : null
  })
}

const STUDIES: Record<string, Study> = {
  GPC: c => <Candles bars={c.bars.slice(-c.n)} style="candle" />,
  GPO: c => <Candles bars={c.bars.slice(-c.n)} style="ohlc" />,
  VBAR: c => <Candles bars={c.bars.slice(-c.n)} style="candle" />,
  GPL: c => (
    <>
      <TimeSeriesChart series={[{ ...priceLine(c), points: priceLine(c).points.map(p => ({ t: p.t, v: Math.log10(p.v) })) }]}
        yFmt={v => (10 ** v).toFixed(10 ** v >= 100 ? 0 : 2)} H={240} />
      <Note>Price on a log scale: equal heights are equal percentage moves.</Note>
    </>
  ),
  RSI: c => (
    <>
      <Price c={c} />
      <Lower series={[tail(c.bars, rsi(c.closes), c.n, 'RSI 14', 'stroke-indigo-500'), level(c.bars, 70, c.n, '70', 'stroke-rose-400'), level(c.bars, 30, c.n, '30', 'stroke-emerald-500')]} />
      <Note>Wilder&apos;s 14-period relative strength index. 70 or more is usually read as overbought, 30 or less as oversold.</Note>
    </>
  ),
  MACD: c => {
    const m = macd(c.closes)
    return (
      <>
        <Price c={c} />
        <Lower legend zero series={[tail(c.bars, m.macd, c.n, 'MACD', 'stroke-indigo-500'), tail(c.bars, m.signal, c.n, 'Signal', 'stroke-amber-500'), tail(c.bars, m.histogram, c.n, 'Histogram', 'stroke-muted-foreground', '2 2')]} />
        <Note>12- and 26-period exponential averages; MACD is their gap, the signal line its 9-period average, the histogram the difference.</Note>
      </>
    )
  },
  BOLL: c => {
    const b = bollinger(c.closes)
    return (
      <>
        <Price c={c} H={240} extra={[tail(c.bars, b.upper, c.n, 'Upper', 'stroke-indigo-400', '4 3'), tail(c.bars, b.middle, c.n, '20 average', 'stroke-amber-500'), tail(c.bars, b.lower, c.n, 'Lower', 'stroke-indigo-400', '4 3')]} />
        <Note>Bollinger bands: the 20-period average plus and minus two standard deviations of the closes.</Note>
      </>
    )
  },
  MAE: c => {
    const e = envelopes(c.closes)
    return (
      <>
        <Price c={c} H={240} extra={[tail(c.bars, e.upper, c.n, '+2.5%', 'stroke-indigo-400', '4 3'), tail(c.bars, e.middle, c.n, '20 average', 'stroke-amber-500'), tail(c.bars, e.lower, c.n, '-2.5%', 'stroke-indigo-400', '4 3')]} />
        <Note>Moving average envelopes: the 20-period average and bands 2.5% above and below it.</Note>
      </>
    )
  },
  TAS: c => {
    const s = stochastic(c.bars)
    return (
      <>
        <Price c={c} />
        <Lower legend series={[tail(c.bars, s.k, c.n, '%K', 'stroke-indigo-500'), tail(c.bars, s.d, c.n, '%D', 'stroke-amber-500'), level(c.bars, 80, c.n, '80', 'stroke-rose-400'), level(c.bars, 20, c.n, '20', 'stroke-emerald-500')]} />
        <Note>Slow stochastics (14, 3, 3): where the close sits in the 14-period range, smoothed; above 80 is high in the range, below 20 low.</Note>
      </>
    )
  },
  WLPR: c => (
    <>
      <Price c={c} />
      <Lower series={[tail(c.bars, williamsR(c.bars), c.n, '%R', 'stroke-indigo-500'), level(c.bars, -20, c.n, '-20', 'stroke-rose-400'), level(c.bars, -80, c.n, '-80', 'stroke-emerald-500')]} />
      <Note>Williams %R (14): 0 at the top of the range, -100 at the bottom.</Note>
    </>
  ),
  CMCI: c => (
    <>
      <Price c={c} />
      <Lower zero series={[tail(c.bars, cci(c.bars), c.n, 'CCI', 'stroke-indigo-500'), level(c.bars, 100, c.n, '100', 'stroke-rose-400'), level(c.bars, -100, c.n, '-100', 'stroke-emerald-500')]} />
      <Note>Lambert&apos;s commodity channel index (20): the typical price&apos;s distance from its average in units of mean deviation.</Note>
    </>
  ),
  DMI: c => {
    const d = dmi(c.bars)
    return (
      <>
        <Price c={c} />
        <Lower legend series={[tail(c.bars, d.plus, c.n, '+DI', 'stroke-emerald-500'), tail(c.bars, d.minus, c.n, '-DI', 'stroke-rose-500'), tail(c.bars, d.adx, c.n, 'ADX', 'stroke-foreground')]} />
        <Note>Wilder&apos;s directional movement (14). +DI above -DI is an up trend; ADX above 25 says the trend, either way, is strong.</Note>
      </>
    )
  },
  OBV: c => (
    <>
      <Price c={c} />
      <Lower series={[tail(c.bars, obv(c.bars), c.n, 'OBV', 'stroke-indigo-500')]} />
      <Note>On-balance volume: volume added on up closes and taken away on down ones, a running total.</Note>
    </>
  ),
  ROC: c => (
    <>
      <Price c={c} />
      <Lower zero series={[tail(c.bars, roc(c.closes), c.n, 'ROC 12', 'stroke-indigo-500')]} />
      <Note>Rate of change: percent change over 12 periods.</Note>
    </>
  ),
  PTPS: c => {
    const s = parabolicSar(c.bars)
    return (
      <>
        <Price c={c} H={240} extra={[tail(c.bars, s.sar, c.n, 'SAR', 'stroke-amber-500', '1 3')]} />
        <Note>Wilder&apos;s parabolic stop and reverse (0.02 to 0.2). The trend is {s.up[s.up.length - 1] ? 'up' : 'down'}; the stop is at {price(s.sar[s.sar.length - 1])}.</Note>
      </>
    )
  },
  CHKO: c => {
    const k = chaikin(c.bars)
    return (
      <>
        <Price c={c} />
        <Lower zero series={[tail(c.bars, k.oscillator, c.n, 'Chaikin', 'stroke-indigo-500')]} />
        <Note>Chaikin oscillator: the 3-period less the 10-period exponential average of the accumulation/distribution line.</Note>
      </>
    )
  },
  GOC: c => {
    const i = ichimoku(c.bars)
    return (
      <>
        <Price c={c} H={240} extra={[tail(c.bars, i.conversion, c.n, 'Conversion', 'stroke-indigo-500'), tail(c.bars, i.base, c.n, 'Base', 'stroke-rose-500'), tail(c.bars, i.spanA, c.n, 'Span A', 'stroke-emerald-500', '4 3'), tail(c.bars, i.spanB, c.n, 'Span B', 'stroke-amber-500', '4 3')]} />
        <ChartLegend items={[{ label: 'Conversion (9)', cls: 'stroke-indigo-500' }, { label: 'Base (26)', cls: 'stroke-rose-500' }, { label: 'Span A', cls: 'stroke-emerald-500', dash: true }, { label: 'Span B (52)', cls: 'stroke-amber-500', dash: true }]} />
        <Note>Ichimoku lines on the date they are computed (charts usually push the two spans 26 periods ahead to draw the cloud).</Note>
      </>
    )
  },
  PIV: c => <Pivots c={c} />,
  PIVG: c => <Pivots c={c} />,
  GM: c => {
    const m = moneyFlow(c.bars)
    return (
      <>
        <Price c={c} />
        <Lower series={[tail(c.bars, m.cumulative, c.n, 'Money flow', 'stroke-indigo-500')]} />
        <Lower series={[tail(c.bars, m.mfi, c.n, 'MFI 14', 'stroke-amber-500'), level(c.bars, 80, c.n, '80', 'stroke-rose-400'), level(c.bars, 20, c.n, '20', 'stroke-emerald-500')]} H={100} />
        <Note>Money flow: typical price times volume, added on up periods and taken away on down ones (a running total), and the 14-period money flow index.</Note>
      </>
    )
  },
  HVG: c => {
    const per = c.intraday ? undefined : 252
    return (
      <>
        <Price c={c} />
        <Lower legend series={[tail(c.bars, historicalVol(c.closes, 10, per), c.n, '10-day', 'stroke-amber-500'), tail(c.bars, historicalVol(c.closes, 30, per), c.n, '30-day', 'stroke-indigo-500'), tail(c.bars, historicalVol(c.closes, 60, per), c.n, '60-day', 'stroke-foreground')]} H={150} />
        <Note>Historical volatility: the annualised standard deviation of daily log returns over 10, 30 and 60 days, in percent.</Note>
      </>
    )
  },
  NSV: c => {
    const rows = [10, 20, 30, 60, 90, 120, 180, 250].map(w => ({ w, v: historicalVol(c.closes, w)[c.closes.length - 1] }))
    return (
      <Table rows={rows} rowKey={r => String(r.w)} columns={[
        { head: 'Window, trading days', align: 'left', cell: r => r.w },
        { head: 'Volatility, yearly %', cell: r => (r.v == null ? '—' : r.v.toFixed(2)) },
        { head: 'Daily %', cell: r => (r.v == null ? '—' : (r.v / Math.sqrt(252)).toFixed(2)) },
      ]} />
    )
  },
  KAOS: c => {
    const h = hurst(c.closes)
    return (
      <>
        <Price c={c} />
        <p className="text-[13px] tabular-nums">Hurst exponent over the last two years of daily returns: <b className="text-[16px]">{h == null ? '—' : h.toFixed(3)}</b></p>
        <Note>Rescaled-range analysis. About 0.5 is a random walk; above it, moves tend to persist (trend); below, to reverse. Small samples read a little high, so 0.55 is not yet evidence of a trend.</Note>
      </>
    )
  },
  CNDL: c => {
    const found = candlePatterns(c.bars.slice(-c.n)).reverse()
    return (
      <>
        <Candles bars={c.bars.slice(-c.n)} style="candle" />
        {found.length === 0 ? <Note>No patterns in this window.</Note> : (
          <Table rows={found} rowKey={(r, i) => `${r.date}${i}`} columns={[
            { head: 'Date', align: 'left', cell: r => r.date.replace('T', ' ') },
            { head: 'Pattern', align: 'left', cell: r => <b>{r.pattern}</b> },
            { head: 'Reading', align: 'left', cell: r => (r.bullish == null ? 'indecision' : r.bullish ? 'bullish' : 'bearish'), className: r => (r.bullish == null ? '' : r.bullish ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') },
          ]} />
        )}
        <Note>Nison&apos;s definitions. Doji: body under a tenth of the range. Hammer and shooting star: a shadow twice the body after a fall or rise. Engulfing: a body that covers the previous one. Stars: three candles, the middle one small.</Note>
      </>
    )
  },
  PFP: c => {
    const last = c.closes[c.closes.length - 1]
    const box = niceBox(last * 0.01)
    const cols = pointAndFigure(c.closes.slice(-c.n), box, 3)
    return <PointFigure cols={cols} box={box} />
  },
  SEAG: () => null,             // drawn by Seasonal, which needs ten years
  GPCA: () => null,             // drawn by Actions, which needs dividends
  IGPV: c => (
    <>
      <Price c={c} H={240} extra={[tail(c.bars, vwapLine(c.bars), c.n, 'VWAP', 'stroke-amber-500')]} />
      <Note>Volume-weighted average price, restarting each session, from the bars&apos; typical prices.</Note>
    </>
  ),
  TECH: c => (
    <>
      <ChartLegend items={[{ label: 'Close', cls: 'stroke-foreground' }, { label: '50-day', cls: 'stroke-amber-500' }, { label: '200-day', cls: 'stroke-indigo-500' }]} />
      <Price c={c} H={220} extra={[tail(c.bars, sma(c.closes, 50), c.n, '50-day', 'stroke-amber-500'), tail(c.bars, sma(c.closes, 200), c.n, '200-day', 'stroke-indigo-500')]} />
      <Table rows={readings(c.closes)} rowKey={r => r.study} columns={[
        { head: 'Study', align: 'left', cell: r => r.study },
        { head: 'Reading', cell: r => (r.value == null ? '—' : r.value.toFixed(2)) },
        { head: 'Meaning', align: 'left', cell: r => r.meaning },
      ]} />
      <Note>Readings at the last close, {c.bars[c.bars.length - 1].date}. These describe the trend; they are not a forecast.</Note>
    </>
  ),
}

/** Intraday codes and the daily study each one runs. */
const INTRADAY_OF: Record<string, string> = {
  IGPC: 'GPC', IGPO: 'GPO', IBOL: 'BOLL', ICCI: 'CMCI', IDMI: 'DMI', IGOC: 'GOC', IMAC: 'MACD', IMAE: 'MAE',
  IPTS: 'PTPS', IROC: 'ROC', IRSI: 'RSI', ITAS: 'TAS', IWLP: 'WLPR', IGPV: 'IGPV', GIM: 'GM', IGPF: 'IGPF',
}

export const TECHNICAL_CODES = [...Object.keys(STUDIES), ...Object.keys(INTRADAY_OF)]

function niceBox(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? mag * 10
}

function PointFigure({ cols, box }: { cols: { up: boolean; from: number; to: number }[]; box: number }) {
  if (!cols.length) return <Note>Prices have not moved a full box yet.</Note>
  const all = cols.flatMap(c => [c.from, c.to])
  const hi = Math.max(...all), lo = Math.min(...all)
  const levels = Math.round((hi - lo) / box) + 1
  const shown = cols.slice(-40)
  const fmt = (v: number) => v.toFixed(box < 1 ? 2 : 0)
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="font-mono text-[11px] leading-none">
          <tbody>
            {Array.from({ length: Math.min(levels, 60) }, (_, r) => {
              const v = hi - r * box
              return (
                <tr key={r}>
                  <td className="pr-2 text-right text-muted-foreground tabular-nums">{fmt(v)}</td>
                  {shown.map((c, i) => {
                    const top = Math.max(c.from, c.to), bottom = Math.min(c.from, c.to)
                    const on = v <= top + 1e-9 && v >= bottom - 1e-9
                    return <td key={i} className={`w-3 text-center ${c.up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{on ? (c.up ? 'X' : 'O') : ''}</td>
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <Note>Point and figure on closes, box {fmt(box)} (about 1% of the price), three-box reversal; the last {shown.length} columns. Time is left out: a column only turns when price reverses three boxes.</Note>
    </div>
  )
}

function Fibonacci(c: Ctx) {
  const w = c.bars.slice(-c.n)
  const hi = Math.max(...w.map(b => b.high)), lo = Math.min(...w.map(b => b.low))
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
  return (
    <>
      <Price c={c} H={240} extra={ratios.map(r => level(c.bars, hi - (hi - lo) * r, c.n, `${(r * 100).toFixed(1)}%`, 'stroke-amber-500'))} />
      <Table rows={ratios} rowKey={r => String(r)} columns={[
        { head: 'Retracement', align: 'left', cell: r => `${(r * 100).toFixed(1)}%` },
        { head: 'Price', cell: r => price(hi - (hi - lo) * r) },
      ]} />
      <Note>Fibonacci retracements of the window&apos;s range, from its high {price(hi)} down to its low {price(lo)}.</Note>
    </>
  )
}

function Seasonal({ symbol }: { symbol: string }) {
  const { data, error, loading } = useResource<{ bars: Bar[] }>(`/api/terminal/bars/${encodeURIComponent(symbol)}?span=10y`, { freshMs: 6 * 60 * 60_000 })
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const shade = (v: number | null) => v == null ? '' : v >= 3 ? 'bg-emerald-500/30' : v > 0 ? 'bg-emerald-500/12' : v <= -3 ? 'bg-rose-500/30' : 'bg-rose-500/12'
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const s = seasonality(d.bars)
        return (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="text-[11.5px] tabular-nums">
                <thead><tr><th />{months.map(m => <th key={m} className="px-1.5 py-1 font-semibold">{m}</th>)}</tr></thead>
                <tbody>
                  <tr className="border-b border-border">
                    <th className="pr-2 text-left">Average</th>
                    {s.average.map((a, i) => <td key={i} className={`px-1.5 py-1 text-right font-semibold ${shade(a?.mean ?? null)}`}>{a ? a.mean.toFixed(1) : '—'}</td>)}
                  </tr>
                  <tr className="border-b border-border">
                    <th className="pr-2 text-left font-normal text-muted-foreground">Up years</th>
                    {s.average.map((a, i) => <td key={i} className="px-1.5 py-1 text-right text-muted-foreground">{a ? `${Math.round(a.up * 100)}%` : '—'}</td>)}
                  </tr>
                  {s.years.map(([y, row]) => (
                    <tr key={y}>
                      <th className="pr-2 text-left font-normal">{y}</th>
                      {row.map((v, i) => <td key={i} className={`px-1.5 py-1 text-right ${shade(v)}`}>{v == null ? '' : v.toFixed(1)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>Monthly price change in percent over up to ten years, and the average for each calendar month. Ten years is a small sample: a month&apos;s average is rarely significant.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

function Actions(c: Ctx) {
  const { data } = useDividends(c.symbol)
  const from = c.bars[c.bars.length - c.n]?.date ?? ''
  const events = [
    ...(data?.payments ?? []).filter(p => p.date >= from).map(p => ({ date: p.date, what: `Dividend ${p.amount.toFixed(4).replace(/0{1,2}$/, '')}` })),
    ...(data?.splits ?? []).filter(p => p.date >= from).map(p => ({ date: p.date, what: `Split ${p.ratio}` })),
  ].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <>
      <Price c={c} H={220} />
      {events.length === 0 ? <Note>No dividends or splits in this window.</Note> : (
        <Table rows={events} rowKey={(e, i) => `${e.date}${i}`} columns={[
          { head: 'Ex-date', align: 'left', cell: e => e.date },
          { head: 'Action', align: 'left', cell: e => e.what },
          { head: 'Close that day', cell: e => price(c.bars.find(b => b.date >= e.date)?.close) },
        ]} />
      )}
    </>
  )
}

export default function Technical(props: ViewProps) {
  const { command, run } = props
  const sec = command.security!
  const study = INTRADAY_OF[command.fn] ?? command.fn
  const intraday = command.fn in INTRADAY_OF
  const choices = intraday ? INTRADAY : DAILY
  const fallback = intraday ? '5D' : ['NSV', 'KAOS'].includes(command.fn) ? '1Y' : ['PIV', 'PIVG'].includes(command.fn) ? '1M' : '6M'
  const arg = (command.args[0] ?? fallback).toUpperCase()
  const valid = arg in choices
  const { data, error, loading } = useBars(sec.symbol, intraday ? INTRADAY[valid ? arg : fallback] : null)
  if (!valid) return <Fail message={`Period ${command.args[0]} is not available. Use ${Object.keys(choices).join(', ')}.`} />
  if (command.fn === 'SEAG') return <Seasonal symbol={sec.symbol} />

  return (
    <div className="space-y-3">
      {!['NSV', 'KAOS'].includes(command.fn) && (
        <div className="flex flex-wrap gap-1">
          {Object.keys(choices).map(a => (
            <button key={a} onClick={() => run(`${sec.label} ${command.fn} ${a}`)}
              className={`text-[11px] px-2 py-0.5 rounded-full ${a === arg ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{a}</button>
          ))}
        </div>
      )}
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const bars = d.bars
          const n = intraday ? Math.max(10, bars.length - WARMUP) : command.fn === 'KAOS' || command.fn === 'NSV' ? Math.min(bars.length, 252) : DAILY[arg]
          if (bars.length < (intraday ? WARMUP + 10 : n + 30)) return <Note>Not enough history for this study.</Note>
          const c: Ctx = { bars, closes: bars.map(b => b.close), n, intraday, symbol: sec.symbol }
          if (study === 'IGPF') return Fibonacci(c)
          if (study === 'GPCA') return <Actions {...c} />
          return STUDIES[study](c)
        }}
      </Fetched>
    </div>
  )
}
