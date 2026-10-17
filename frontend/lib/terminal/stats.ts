// Returns, regression and correlation for HRA and CORR.

export interface Close { date: string; close: number }

/** Simple returns over each step, keyed by the date they end on. */
export function returnsByDate(rows: Close[], every = 1): Map<string, number> {
  const out = new Map<string, number>()
  for (let i = every; i < rows.length; i += every) out.set(rows[i].date, rows[i].close / rows[i - every].close - 1)
  return out
}

/** Weekly closes: the last trading day of each ISO week. */
export function weekly(rows: Close[]): Close[] {
  const key = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`)
    const monday = new Date(t.getTime() - ((t.getUTCDay() + 6) % 7) * 86_400_000)
    return monday.toISOString().slice(0, 10)
  }
  const out: Close[] = []
  for (const r of rows) {
    if (out.length && key(out[out.length - 1].date) === key(r.date)) out[out.length - 1] = r
    else out.push(r)
  }
  return out
}

/** Pairs of (x, y) on the dates both series have. */
export function aligned(x: Map<string, number>, y: Map<string, number>): { date: string; x: number; y: number }[] {
  return Array.from(x).filter(([d]) => y.has(d)).map(([date, v]) => ({ date, x: v, y: y.get(date)! }))
}

export function correlation(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

/** Ordinary least squares of y on x: y = alpha + beta x. */
export function regress(xs: number[], ys: number[]) {
  const n = xs.length
  if (n < 3) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2
  }
  if (!sxx) return null
  const beta = sxy / sxx
  const alpha = my - beta * mx
  const sse = syy - beta * sxy
  const r2 = syy ? 1 - sse / syy : 0
  const seBeta = Math.sqrt(Math.max(sse, 0) / (n - 2) / sxx)
  return { beta, alpha, r2, correlation: correlation(xs, ys), seBeta, t: seBeta ? beta / seBeta : null, n }
}

/** Blume's adjustment, the "adjusted beta" Bloomberg shows: two thirds raw,
 *  one third the market's 1, since betas drift toward 1 over time. */
export const adjustedBeta = (raw: number) => (2 / 3) * raw + 1 / 3
