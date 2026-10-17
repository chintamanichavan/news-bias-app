import { describe, expect, it } from 'vitest'
import { breakEvens, netCost, pnl, positionGreeks, type Leg } from './scenario'
import { price } from './bs'

const m = { spot: 100, days: 30, r: 0.04, q: 0 }
const atExpiry = (spot: number) => ({ spot, daysPassed: 30, volShift: 0 })

describe('scenario', () => {
  it('values a long call at expiry as its payoff less the premium', () => {
    const call: Leg = { kind: 'C', qty: 1, strike: 100, entry: 3, iv: 0.25 }
    expect(pnl([call], m, atExpiry(110))).toBeCloseTo((10 - 3) * 100, 6)
    expect(pnl([call], m, atExpiry(90))).toBeCloseTo(-300, 6)
    expect(breakEvens([call], m, 70, 130)[0]).toBeCloseTo(103, 1)
    expect(netCost([call])).toBe(300)
  })

  it('bounds a bull call spread on both sides', () => {
    const legs: Leg[] = [
      { kind: 'C', qty: 1, strike: 95, entry: 7, iv: 0.25 },
      { kind: 'C', qty: -1, strike: 105, entry: 2, iv: 0.25 },
    ]
    expect(pnl(legs, m, atExpiry(150))).toBeCloseTo((10 - 5) * 100, 6)   // capped gain
    expect(pnl(legs, m, atExpiry(50))).toBeCloseTo(-500, 6)              // capped loss
    expect(netCost(legs)).toBe(500)
  })

  it('makes a covered call short delta less than the stock alone', () => {
    const legs: Leg[] = [
      { kind: 'S', qty: 100, strike: 0, entry: 100, iv: 0 },
      { kind: 'C', qty: -1, strike: 105, entry: 1.5, iv: 0.25 },
    ]
    const g = positionGreeks(legs, m)
    expect(g.delta).toBeGreaterThan(0)
    expect(g.delta).toBeLessThan(100)
    expect(g.theta).toBeGreaterThan(0)          // the sold call earns time decay
  })

  it('is flat today at entry when entry is the model price', () => {
    const iv = 0.3
    const entry = price('P', { s: 100, k: 95, t: 30 / 365, r: 0.04, q: 0, vol: iv })
    const put: Leg = { kind: 'P', qty: 2, strike: 95, entry, iv }
    expect(pnl([put], m, { spot: 100, daysPassed: 0, volShift: 0 })).toBeCloseTo(0, 6)
    expect(pnl([put], m, { spot: 100, daysPassed: 0, volShift: 0.1 })).toBeGreaterThan(0)   // long vol gains
  })

  it('finds both break-evens of a straddle', () => {
    const legs: Leg[] = [
      { kind: 'C', qty: 1, strike: 100, entry: 3, iv: 0.25 },
      { kind: 'P', qty: 1, strike: 100, entry: 3, iv: 0.25 },
    ]
    const be = breakEvens(legs, m, 70, 130)
    expect(be).toHaveLength(2)
    expect(be[0]).toBeCloseTo(94, 1)
    expect(be[1]).toBeCloseTo(106, 1)
  })
})
