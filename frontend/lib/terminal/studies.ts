// Technical studies on a close series, by the textbook definitions:
// Wilder's RSI (his smoothing, not a plain average), MACD from EMAs seeded
// with a simple average, Bollinger bands at two population standard
// deviations. Each returns one value per input, null until it has enough
// history, so it lines up with the dates it came from.

export type Line = (number | null)[]

export function sma(xs: number[], n: number): Line {
  let sum = 0
  return xs.map((x, i) => {
    sum += x
    if (i >= n) sum -= xs[i - n]
    return i >= n - 1 ? sum / n : null
  })
}

/** Exponential average with weight 2/(n+1), started from the simple
 *  average of the first n values. */
export function ema(xs: (number | null)[], n: number): Line {
  const k = 2 / (n + 1)
  const out: Line = []
  let prev: number | null = null
  let seed: number[] = []
  for (const x of xs) {
    if (x == null) { out.push(null); continue }
    if (prev == null) {
      seed.push(x)
      if (seed.length === n) {
        prev = seed.reduce((a, b) => a + b, 0) / n
        seed = []
        out.push(prev)
      } else out.push(null)
      continue
    }
    prev = x * k + prev * (1 - k)
    out.push(prev)
  }
  return out
}

/** Wilder's relative strength index. */
export function rsi(xs: number[], n = 14): Line {
  const out: Line = xs.map(() => null)
  if (xs.length <= n) return out
  let gain = 0, loss = 0
  for (let i = 1; i <= n; i++) {
    const d = xs[i] - xs[i - 1]
    if (d > 0) gain += d; else loss -= d
  }
  gain /= n; loss /= n
  const value = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss))
  out[n] = value()
  for (let i = n + 1; i < xs.length; i++) {
    const d = xs[i] - xs[i - 1]
    gain = (gain * (n - 1) + Math.max(d, 0)) / n
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n
    out[i] = value()
  }
  return out
}

export function macd(xs: number[], fast = 12, slow = 26, signal = 9): { macd: Line; signal: Line; histogram: Line } {
  const f = ema(xs, fast), s = ema(xs, slow)
  const line = xs.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null))
  const sig = ema(line, signal)
  return { macd: line, signal: sig, histogram: line.map((m, i) => (m != null && sig[i] != null ? m - sig[i]! : null)) }
}

export function bollinger(xs: number[], n = 20, k = 2): { middle: Line; upper: Line; lower: Line; percentB: Line } {
  const middle = sma(xs, n)
  const sd = xs.map((_, i) => {
    const m = middle[i]
    if (m == null) return null
    let v = 0
    for (let j = i - n + 1; j <= i; j++) v += (xs[j] - m) ** 2
    return Math.sqrt(v / n)
  })
  const upper = middle.map((m, i) => (m == null ? null : m + k * sd[i]!))
  const lower = middle.map((m, i) => (m == null ? null : m - k * sd[i]!))
  const percentB = xs.map((x, i) => (upper[i] == null || upper[i] === lower[i] ? null : (x - lower[i]!) / (upper[i]! - lower[i]!)))
  return { middle, upper, lower, percentB }
}

const last = (l: Line) => l[l.length - 1] ?? null

/** One reading of each study at the latest close, with its usual meaning. */
export function readings(xs: number[]) {
  const r = last(rsi(xs))
  const m = macd(xs)
  const b = bollinger(xs)
  const s50 = last(sma(xs, 50)), s200 = last(sma(xs, 200))
  const price = xs[xs.length - 1]
  return [
    { study: 'RSI (14)', value: r, meaning: r == null ? '' : r >= 70 ? 'overbought (70 or more)' : r <= 30 ? 'oversold (30 or less)' : 'neutral' },
    { study: 'MACD (12, 26, 9)', value: last(m.histogram), meaning: last(m.histogram) == null ? '' : last(m.histogram)! > 0 ? 'MACD above its signal line' : 'MACD below its signal line' },
    { study: 'Bollinger %B (20, 2)', value: last(b.percentB), meaning: last(b.percentB) == null ? '' : last(b.percentB)! > 1 ? 'above the upper band' : last(b.percentB)! < 0 ? 'below the lower band' : 'inside the bands' },
    { study: 'Price vs 50-day average', value: s50 == null ? null : (price / s50 - 1) * 100, meaning: s50 == null ? '' : price > s50 ? 'above' : 'below' },
    { study: 'Price vs 200-day average', value: s200 == null ? null : (price / s200 - 1) * 100, meaning: s200 == null ? '' : price > s200 ? 'above' : 'below' },
    { study: '50-day vs 200-day', value: s50 == null || s200 == null ? null : (s50 / s200 - 1) * 100, meaning: s50 == null || s200 == null ? '' : s50 > s200 ? 'golden cross (50 above 200)' : 'death cross (50 below 200)' },
  ]
}

// ── studies on high, low, close and volume ──────────────────────────────────

export interface Ohlcv { date: string; open: number; high: number; low: number; close: number; volume: number | null }

const highest = (xs: number[], i: number, n: number) => Math.max(...xs.slice(i - n + 1, i + 1))
const lowest = (xs: number[], i: number, n: number) => Math.min(...xs.slice(i - n + 1, i + 1))

/** Lane's stochastics: %K is where the close sits in the n-day range, %D
 *  its 3-day average (the slow version smooths %K by 3 first). */
export function stochastic(b: Ohlcv[], n = 14, smooth = 3): { k: Line; d: Line } {
  const h = b.map(x => x.high), l = b.map(x => x.low)
  const fast: Line = b.map((x, i) => {
    if (i < n - 1) return null
    const hh = highest(h, i, n), ll = lowest(l, i, n)
    return hh === ll ? 50 : ((x.close - ll) / (hh - ll)) * 100
  })
  const avg = (line: Line, m: number): Line => line.map((_, i) => {
    const w = line.slice(i - m + 1, i + 1)
    return i < m - 1 || w.some(v => v == null) ? null : (w as number[]).reduce((a, v) => a + v, 0) / m
  })
  const k = avg(fast, smooth)
  return { k, d: avg(k, 3) }
}

/** Williams %R: 0 at the top of the n-day range, -100 at the bottom. */
export function williamsR(b: Ohlcv[], n = 14): Line {
  const h = b.map(x => x.high), l = b.map(x => x.low)
  return b.map((x, i) => {
    if (i < n - 1) return null
    const hh = highest(h, i, n), ll = lowest(l, i, n)
    return hh === ll ? -50 : ((hh - x.close) / (hh - ll)) * -100
  })
}

/** Lambert's commodity channel index on the typical price. */
export function cci(b: Ohlcv[], n = 20): Line {
  const tp = b.map(x => (x.high + x.low + x.close) / 3)
  const m = sma(tp, n)
  return tp.map((t, i) => {
    if (m[i] == null) return null
    let dev = 0
    for (let j = i - n + 1; j <= i; j++) dev += Math.abs(tp[j] - m[i]!)
    dev /= n
    return dev === 0 ? 0 : (t - m[i]!) / (0.015 * dev)
  })
}

/** Wilder's directional movement: +DI, -DI and ADX, all smoothed his way. */
export function dmi(b: Ohlcv[], n = 14): { plus: Line; minus: Line; adx: Line } {
  const plus: Line = b.map(() => null), minus: Line = b.map(() => null), adx: Line = b.map(() => null)
  let tr = 0, pdm = 0, mdm = 0
  const dx: number[] = []
  let adxPrev: number | null = null
  for (let i = 1; i < b.length; i++) {
    const up = b[i].high - b[i - 1].high, down = b[i - 1].low - b[i].low
    const p = up > down && up > 0 ? up : 0, m = down > up && down > 0 ? down : 0
    const t = Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close))
    if (i <= n) { tr += t; pdm += p; mdm += m } else { tr = tr - tr / n + t; pdm = pdm - pdm / n + p; mdm = mdm - mdm / n + m }
    if (i < n) continue
    const pdi = tr ? (pdm / tr) * 100 : 0, mdi = tr ? (mdm / tr) * 100 : 0
    plus[i] = pdi; minus[i] = mdi
    dx.push(pdi + mdi ? (Math.abs(pdi - mdi) / (pdi + mdi)) * 100 : 0)
    if (dx.length === n) adxPrev = dx.reduce((a, v) => a + v, 0) / n
    else if (dx.length > n) adxPrev = (adxPrev! * (n - 1) + dx[dx.length - 1]) / n
    if (adxPrev != null) adx[i] = adxPrev
  }
  return { plus, minus, adx }
}

/** Granville's on-balance volume: volume added on up closes, taken away on down. */
export function obv(b: Ohlcv[]): Line {
  let total = 0
  return b.map((x, i) => {
    if (i > 0) total += x.close > b[i - 1].close ? x.volume ?? 0 : x.close < b[i - 1].close ? -(x.volume ?? 0) : 0
    return total
  })
}

/** Percentage change over n periods. */
export const roc = (xs: number[], n = 12): Line => xs.map((x, i) => (i < n ? null : (x / xs[i - n] - 1) * 100))

/** Moving average envelopes: the n-day average and bands a fixed percent away. */
export function envelopes(xs: number[], n = 20, pct = 2.5): { middle: Line; upper: Line; lower: Line } {
  const middle = sma(xs, n)
  return { middle, upper: middle.map(m => (m == null ? null : m * (1 + pct / 100))), lower: middle.map(m => (m == null ? null : m * (1 - pct / 100))) }
}

/** Wilder's parabolic stop and reverse, step 0.02 up to 0.2. Returns the
 *  stop for each bar and whether the trend is up. */
export function parabolicSar(b: Ohlcv[], step = 0.02, max = 0.2): { sar: Line; up: (boolean | null)[] } {
  const sar: Line = b.map(() => null), up: (boolean | null)[] = b.map(() => null)
  if (b.length < 2) return { sar, up }
  let long = b[1].close >= b[0].close
  let ep = long ? Math.max(b[0].high, b[1].high) : Math.min(b[0].low, b[1].low)
  let s = long ? Math.min(b[0].low, b[1].low) : Math.max(b[0].high, b[1].high)
  let af = step
  for (let i = 1; i < b.length; i++) {
    if (i > 1) {
      s = s + af * (ep - s)
      // the stop may not move inside the last two bars' range
      s = long ? Math.min(s, b[i - 1].low, b[i - 2].low) : Math.max(s, b[i - 1].high, b[i - 2].high)
      if (long && b[i].low < s) { long = false; s = ep; ep = b[i].low; af = step }
      else if (!long && b[i].high > s) { long = true; s = ep; ep = b[i].high; af = step }
      else if (long && b[i].high > ep) { ep = b[i].high; af = Math.min(af + step, max) }
      else if (!long && b[i].low < ep) { ep = b[i].low; af = Math.min(af + step, max) }
    }
    sar[i] = s; up[i] = long
  }
  return { sar, up }
}

/** Accumulation/distribution line and Chaikin's oscillator (3- less 10-day EMA). */
export function chaikin(b: Ohlcv[], fast = 3, slow = 10): { adl: Line; oscillator: Line } {
  let total = 0
  const adl = b.map(x => {
    const range = x.high - x.low
    total += range ? (((x.close - x.low) - (x.high - x.close)) / range) * (x.volume ?? 0) : 0
    return total
  })
  const f = ema(adl, fast), s = ema(adl, slow)
  return { adl, oscillator: adl.map((_, i) => (f[i] != null && s[i] != null ? f[i]! - s[i]! : null)) }
}

/** Ichimoku: conversion (9), base (26), the two cloud spans (drawn 26 ahead
 *  by convention; here kept on the date they are computed), and the lagging line. */
export function ichimoku(b: Ohlcv[]): { conversion: Line; base: Line; spanA: Line; spanB: Line } {
  const h = b.map(x => x.high), l = b.map(x => x.low)
  const mid = (n: number): Line => b.map((_, i) => (i < n - 1 ? null : (highest(h, i, n) + lowest(l, i, n)) / 2))
  const conversion = mid(9), base = mid(26), long = mid(52)
  const spanA = conversion.map((c, i) => (c == null || base[i] == null ? null : (c + base[i]!) / 2))
  return { conversion, base, spanA, spanB: long }
}

/** Classic floor-trader pivots from one period's high, low and close. */
export function pivots(high: number, low: number, close: number) {
  const p = (high + low + close) / 3
  return { r3: high + 2 * (p - low), r2: p + (high - low), r1: 2 * p - low, pivot: p, s1: 2 * p - high, s2: p - (high - low), s3: low - 2 * (high - p) }
}

/** Money flow: typical price times volume, signed by the day's direction,
 *  and the 14-day money flow index built from it. */
export function moneyFlow(b: Ohlcv[], n = 14): { flow: Line; cumulative: Line; mfi: Line } {
  const tp = b.map(x => (x.high + x.low + x.close) / 3)
  const flow: Line = b.map((_, i) => (i === 0 ? 0 : tp[i] > tp[i - 1] ? tp[i] * (b[i].volume ?? 0) : tp[i] < tp[i - 1] ? -tp[i] * (b[i].volume ?? 0) : 0))
  let sum = 0
  const cumulative = flow.map(f => (sum += f ?? 0))
  const mfi: Line = b.map((_, i) => {
    if (i < n) return null
    let pos = 0, neg = 0
    for (let j = i - n + 1; j <= i; j++) { const f = flow[j]!; if (f > 0) pos += f; else neg -= f }
    return neg === 0 ? 100 : 100 - 100 / (1 + pos / neg)
  })
  return { flow, cumulative, mfi }
}

/** Hurst exponent by rescaled-range analysis of log returns: about 0.5 for
 *  a random walk, above for trending, below for mean-reverting. */
export function hurst(xs: number[]): number | null {
  const r = xs.slice(1).map((x, i) => Math.log(x / xs[i]))
  if (r.length < 64) return null
  const points: [number, number][] = []
  for (let size = 8; size <= r.length / 2; size *= 2) {
    const rs: number[] = []
    for (let start = 0; start + size <= r.length; start += size) {
      const w = r.slice(start, start + size)
      const m = w.reduce((a, v) => a + v, 0) / size
      let cum = 0, lo = 0, hi = 0, sq = 0
      for (const v of w) { cum += v - m; lo = Math.min(lo, cum); hi = Math.max(hi, cum); sq += (v - m) ** 2 }
      const sd = Math.sqrt(sq / size)
      if (sd > 0) rs.push((hi - lo) / sd)
    }
    if (rs.length) points.push([Math.log(size), Math.log(rs.reduce((a, v) => a + v, 0) / rs.length)])
  }
  if (points.length < 3) return null
  const mx = points.reduce((a, p) => a + p[0], 0) / points.length, my = points.reduce((a, p) => a + p[1], 0) / points.length
  let sxy = 0, sxx = 0
  for (const [x, y] of points) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2 }
  return sxy / sxx
}

/** Annualised close-to-close volatility over a rolling window. */
export function historicalVol(xs: number[], n = 30, periodsPerYear = 252): Line {
  const r = xs.map((x, i) => (i === 0 ? 0 : Math.log(x / xs[i - 1])))
  return xs.map((_, i) => {
    if (i < n) return null
    const w = r.slice(i - n + 1, i + 1)
    const m = w.reduce((a, v) => a + v, 0) / n
    return Math.sqrt((w.reduce((a, v) => a + (v - m) ** 2, 0) / (n - 1)) * periodsPerYear) * 100
  })
}

/** Average monthly return by calendar month, and each year's months. */
export function seasonality(rows: { date: string; close: number }[]) {
  const lastByMonth = new Map<string, number>()
  for (const r of rows) lastByMonth.set(r.date.slice(0, 7), r.close)
  const months = Array.from(lastByMonth.entries())
  const byYear = new Map<number, (number | null)[]>()
  for (let i = 1; i < months.length; i++) {
    const [ym, close] = months[i]
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1
    if (!byYear.has(y)) byYear.set(y, Array(12).fill(null))
    byYear.get(y)![m] = (close / months[i - 1][1] - 1) * 100
  }
  const average = Array.from({ length: 12 }, (_, m) => {
    const v = Array.from(byYear.values()).map(r => r[m]).filter((x): x is number => x != null)
    return v.length ? { mean: v.reduce((a, x) => a + x, 0) / v.length, up: v.filter(x => x > 0).length / v.length, years: v.length } : null
  })
  return { years: Array.from(byYear.entries()).sort((a, b) => b[0] - a[0]), average }
}

/** Candle patterns by Nison's definitions, with the thresholds stated:
 *  a doji's body is under a tenth of its range; a hammer's lower shadow is
 *  at least twice its body with little upper shadow, after a fall. */
export function candlePatterns(b: Ohlcv[]): { date: string; pattern: string; bullish: boolean | null }[] {
  const out: { date: string; pattern: string; bullish: boolean | null }[] = []
  const body = (x: Ohlcv) => Math.abs(x.close - x.open)
  const range = (x: Ohlcv) => x.high - x.low
  const fell = (i: number) => i >= 5 && b[i - 1].close < b[i - 5].close
  const rose = (i: number) => i >= 5 && b[i - 1].close > b[i - 5].close
  for (let i = 1; i < b.length; i++) {
    const x = b[i], p = b[i - 1], r = range(x)
    if (!r) continue
    const lower = Math.min(x.open, x.close) - x.low, upper = x.high - Math.max(x.open, x.close)
    if (body(x) <= 0.1 * r) out.push({ date: x.date, pattern: 'Doji', bullish: null })
    else if (lower >= 2 * body(x) && upper <= 0.25 * body(x) && fell(i)) out.push({ date: x.date, pattern: 'Hammer', bullish: true })
    else if (upper >= 2 * body(x) && lower <= 0.25 * body(x) && rose(i)) out.push({ date: x.date, pattern: 'Shooting star', bullish: false })
    if (p.close < p.open && x.close > x.open && x.open <= p.close && x.close >= p.open && body(x) > body(p))
      out.push({ date: x.date, pattern: 'Bullish engulfing', bullish: true })
    if (p.close > p.open && x.close < x.open && x.open >= p.close && x.close <= p.open && body(x) > body(p))
      out.push({ date: x.date, pattern: 'Bearish engulfing', bullish: false })
    if (i >= 2) {
      const a = b[i - 2]
      const small = body(p) <= 0.3 * body(a)
      if (a.close < a.open && small && x.close > x.open && x.close > (a.open + a.close) / 2 && body(a) > 0.6 * range(a))
        out.push({ date: x.date, pattern: 'Morning star', bullish: true })
      if (a.close > a.open && small && x.close < x.open && x.close < (a.open + a.close) / 2 && body(a) > 0.6 * range(a))
        out.push({ date: x.date, pattern: 'Evening star', bullish: false })
    }
  }
  return out
}

/** Point and figure on closes. Box prices are multiples of `box`: an X
 *  column fills every box at or below the price, an O column every box at
 *  or above it, and a column turns only after `reversal` boxes against it. */
export function pointAndFigure(xs: number[], box: number, reversal = 3): { up: boolean; from: number; to: number }[] {
  const cols: { up: boolean; from: number; to: number }[] = []
  if (!xs.length || box <= 0) return cols
  const floor = (v: number) => Math.floor(v / box + 1e-9) * box
  const ceil = (v: number) => Math.ceil(v / box - 1e-9) * box
  const start = xs[0]
  for (const x of xs.slice(1)) {
    const c = cols[cols.length - 1]
    if (!c) {
      if (floor(x) >= floor(start) + box) cols.push({ up: true, from: floor(start) + box, to: floor(x) })
      else if (ceil(x) <= ceil(start) - box) cols.push({ up: false, from: ceil(start) - box, to: ceil(x) })
      continue
    }
    if (c.up) {
      if (floor(x) > c.to) c.to = floor(x)
      else if (ceil(x) <= c.to - reversal * box) cols.push({ up: false, from: c.to - box, to: ceil(x) })
    } else {
      if (ceil(x) < c.to) c.to = ceil(x)
      else if (floor(x) >= c.to + reversal * box) cols.push({ up: true, from: c.to + box, to: floor(x) })
    }
  }
  return cols
}

// ── intraday analytics ───────────────────────────────────────────────────────

/** Volume traded at each price level (bars' typical prices in equal bins),
 *  the busiest level (point of control) and the value area: the levels
 *  around it holding 70% of the volume. */
export function volumeAtPrice(b: Ohlcv[], bins = 30) {
  const tp = b.map(x => (x.high + x.low + x.close) / 3)
  const lo = Math.min(...b.map(x => x.low)), hi = Math.max(...b.map(x => x.high))
  const width = (hi - lo) / bins || 1
  const levels = Array.from({ length: bins }, (_, i) => ({ low: lo + i * width, high: lo + (i + 1) * width, volume: 0 }))
  tp.forEach((p, i) => { levels[Math.min(bins - 1, Math.floor((p - lo) / width))].volume += b[i].volume ?? 0 })
  const total = levels.reduce((a, l) => a + l.volume, 0)
  let poc = 0
  levels.forEach((l, i) => { if (l.volume > levels[poc].volume) poc = i })
  let a = poc, z = poc, inside = levels[poc].volume
  while (inside < 0.7 * total && (a > 0 || z < bins - 1)) {
    const down = a > 0 ? levels[a - 1].volume : -1, up = z < bins - 1 ? levels[z + 1].volume : -1
    if (up >= down) inside += levels[++z].volume; else inside += levels[--a].volume
  }
  return { levels, poc: (levels[poc].low + levels[poc].high) / 2, valueLow: levels[a].low, valueHigh: levels[z].high, total }
}

/** Average volume in each time-of-day slot across past sessions, and the
 *  last session's volume in the same slots. Dates are 'YYYY-MM-DDTHH:MM'. */
export function volumeByTime(b: Ohlcv[]) {
  const last = b[b.length - 1].date.slice(0, 10)
  const slots = new Map<string, { sum: number; days: number; today: number | null }>()
  for (const x of b) {
    const t = x.date.slice(11, 16)
    const s = slots.get(t) ?? { sum: 0, days: 0, today: null }
    if (x.date.slice(0, 10) === last) s.today = x.volume ?? 0
    else { s.sum += x.volume ?? 0; s.days += 1 }
    slots.set(t, s)
  }
  return Array.from(slots.entries()).sort((p, q) => p[0].localeCompare(q[0]))
    .map(([time, s]) => ({ time, average: s.days ? s.sum / s.days : null, today: s.today }))
}

/** Rolling realised volatility of bar returns, annualised by bars per year,
 *  never across the gap between sessions. */
export function intradayVol(b: Ohlcv[], window: number, barsPerYear: number): Line {
  const r = b.map((x, i) => (i === 0 || x.date.slice(0, 10) !== b[i - 1].date.slice(0, 10) ? null : Math.log(x.close / b[i - 1].close)))
  return b.map((_, i) => {
    const w = r.slice(Math.max(0, i - window + 1), i + 1)
    if (i < window - 1 || w.some(v => v == null)) return null
    const xs = w as number[]
    const m = xs.reduce((s, v) => s + v, 0) / xs.length
    return Math.sqrt((xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)) * barsPerYear) * 100
  })
}
