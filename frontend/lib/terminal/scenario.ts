// OSA: the value of an option position under a move in the underlying,
// the passage of time and a shift in volatility. Pure, so it is tested.

import { greeks, price, type Kind } from './bs'

export const MULTIPLIER = 100   // shares per listed US option contract

export interface Leg {
  /** 'S' is the stock itself, held as `qty` shares */
  kind: Kind | 'S'
  /** contracts (or shares for stock); negative when sold */
  qty: number
  strike: number
  /** price paid or received per share, at entry */
  entry: number
  /** implied volatility at entry */
  iv: number
}

export interface Market { spot: number; days: number; r: number; q: number }

export interface Move { spot: number; daysPassed: number; volShift: number }

function legValue(leg: Leg, m: Market, move: Move): number {
  if (leg.kind === 'S') return move.spot
  const left = m.days - move.daysPassed
  // at expiry a contract is worth exactly what it pays; the pricing
  // model's minimum-time guard would add a sliver of time value
  if (left <= 0) return Math.max(leg.kind === 'C' ? move.spot - leg.strike : leg.strike - move.spot, 0)
  const t = left / 365
  return price(leg.kind, { s: move.spot, k: leg.strike, t, r: m.r, q: m.q, vol: Math.max(leg.iv + move.volShift, 0) })
}

const units = (leg: Leg) => (leg.kind === 'S' ? leg.qty : leg.qty * MULTIPLIER)

/** Profit or loss of the whole position, in money, after the move. */
export function pnl(legs: Leg[], m: Market, move: Move): number {
  return legs.reduce((sum, leg) => sum + units(leg) * (legValue(leg, m, move) - leg.entry), 0)
}

/** What it costs to put on: positive is money paid, negative money received. */
export const netCost = (legs: Leg[]) => legs.reduce((s, leg) => s + units(leg) * leg.entry, 0)

/** Position delta (in shares), gamma, theta per day and vega per vol point, in money. */
export function positionGreeks(legs: Leg[], m: Market) {
  return legs.reduce((acc, leg) => {
    if (leg.kind === 'S') return { ...acc, delta: acc.delta + leg.qty }
    const g = greeks(leg.kind, { s: m.spot, k: leg.strike, t: m.days / 365, r: m.r, q: m.q, vol: leg.iv })
    const n = units(leg)
    return { delta: acc.delta + n * g.delta, gamma: acc.gamma + n * g.gamma, theta: acc.theta + n * g.theta, vega: acc.vega + n * g.vega }
  }, { delta: 0, gamma: 0, theta: 0, vega: 0 })
}

/** Underlying prices where the P/L at expiry crosses zero, found on a grid
 *  and refined by linear interpolation. */
export function breakEvens(legs: Leg[], m: Market, lo: number, hi: number, steps = 400): number[] {
  const at = (s: number) => pnl(legs, m, { spot: s, daysPassed: m.days, volShift: 0 })
  const out: number[] = []
  let prevS = lo, prev = at(lo)
  for (let i = 1; i <= steps; i++) {
    const s = lo + ((hi - lo) * i) / steps
    const v = at(s)
    if (prev === 0) out.push(prevS)
    else if (Math.sign(v) !== Math.sign(prev) && v !== 0) out.push(prevS + (s - prevS) * (-prev / (v - prev)))
    prevS = s
    prev = v
  }
  return out
}
