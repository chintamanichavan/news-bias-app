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
