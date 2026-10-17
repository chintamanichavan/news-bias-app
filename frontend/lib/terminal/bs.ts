// Black-Scholes-Merton in the browser, for OV and OSA to answer "what if"
// without a round trip. Same formulas as ml-service/terminal/options.py and
// tested against the same textbook values.

export type Kind = 'C' | 'P'

const MIN_T = 1 / (365 * 24)

function cdf(x: number): number {
  // Abramowitz and Stegun 7.1.26 for erf; error below 1.5e-7
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
    * Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

const pdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)

export interface Inputs { s: number; k: number; t: number; r: number; q: number; vol: number }

function d1d2({ s, k, t, r, q, vol }: Inputs): [number, number] {
  const d1 = (Math.log(s / k) + (r - q + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t))
  return [d1, d1 - vol * Math.sqrt(t)]
}

export function price(kind: Kind, input: Inputs): number {
  const x = { ...input, t: Math.max(input.t, MIN_T) }
  if (x.vol <= 0) {
    const fwd = x.s * Math.exp(-x.q * x.t) - x.k * Math.exp(-x.r * x.t)
    return Math.max(kind === 'C' ? fwd : -fwd, 0)
  }
  const [d1, d2] = d1d2(x)
  return kind === 'C'
    ? x.s * Math.exp(-x.q * x.t) * cdf(d1) - x.k * Math.exp(-x.r * x.t) * cdf(d2)
    : x.k * Math.exp(-x.r * x.t) * cdf(-d2) - x.s * Math.exp(-x.q * x.t) * cdf(-d1)
}

/** Delta, gamma, theta per calendar day, vega per volatility point. */
export function greeks(kind: Kind, input: Inputs) {
  const x = { ...input, t: Math.max(input.t, MIN_T) }
  const [d1, d2] = d1d2(x)
  const dq = Math.exp(-x.q * x.t), dr = Math.exp(-x.r * x.t)
  const gamma = dq * pdf(d1) / (x.s * x.vol * Math.sqrt(x.t))
  const vega = x.s * dq * pdf(d1) * Math.sqrt(x.t) / 100
  const decay = -x.s * dq * pdf(d1) * x.vol / (2 * Math.sqrt(x.t))
  const delta = kind === 'C' ? dq * cdf(d1) : -dq * cdf(-d1)
  const theta = kind === 'C'
    ? decay - x.r * x.k * dr * cdf(d2) + x.q * x.s * dq * cdf(d1)
    : decay + x.r * x.k * dr * cdf(-d2) - x.q * x.s * dq * cdf(-d1)
  return { delta, gamma, theta: theta / 365, vega }
}

export interface Contract { root: string; expiry: string; kind: Kind; strike: number }

/** "AAPL261218C00345000" -> AAPL, 2026-12-18, call, 345. The standard
 *  (OCC) symbol: root, YYMMDD, C or P, strike times 1000 in 8 digits. */
export function parseContract(symbol: string): Contract | null {
  const m = /^([A-Z.]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(symbol.toUpperCase())
  if (!m) return null
  return { root: m[1], expiry: `20${m[2]}-${m[3]}-${m[4]}`, kind: m[5] as Kind, strike: Number(m[6]) / 1000 }
}
