import { describe, expect, it } from 'vitest'
import { greeks, parseContract, price } from './bs'
import { around, expiryAtLeast, expiryDate } from '../../components/terminal/views/options'

const hull = { s: 42, k: 40, t: 0.5, r: 0.1, q: 0, vol: 0.2 }

describe('Black-Scholes in the browser', () => {
  it('matches the textbook example', () => {
    expect(price('C', hull)).toBeCloseTo(4.76, 2)
    expect(price('P', hull)).toBeCloseTo(0.81, 2)
    expect(greeks('C', hull).delta).toBeCloseTo(0.7791, 3)
  })

  it('keeps put-call parity with dividends', () => {
    const x = { s: 100, k: 95, t: 0.75, r: 0.04, q: 0.02, vol: 0.3 }
    expect(price('C', x) - price('P', x)).toBeCloseTo(100 * Math.exp(-0.02 * 0.75) - 95 * Math.exp(-0.04 * 0.75), 5)
  })

  it('agrees with a finite-difference delta and goes to intrinsic at zero vol', () => {
    const x = { s: 100, k: 100, t: 0.5, r: 0.03, q: 0.01, vol: 0.25 }
    const h = 1e-3
    const fd = (price('P', { ...x, s: 100 + h }) - price('P', { ...x, s: 100 - h })) / (2 * h)
    expect(greeks('P', x).delta).toBeCloseTo(fd, 4)
    expect(price('C', { ...x, s: 120, vol: 0 })).toBeGreaterThan(19)
    expect(price('P', { ...x, s: 120, vol: 0 })).toBe(0)
  })

  it('reads standard option symbols', () => {
    expect(parseContract('AAPL261218C00345000')).toEqual({ root: 'AAPL', expiry: '2026-12-18', kind: 'C', strike: 345 })
    expect(parseContract('spy270115p00512500')).toEqual({ root: 'SPY', expiry: '2027-01-15', kind: 'P', strike: 512.5 })
    expect(parseContract('AAPL')).toBeNull()
  })
})

describe('chain helpers', () => {
  it('keeps the strikes nearest the spot', () => {
    const rows = [90, 95, 100, 105, 110, 115].map(strike => ({ strike }))
    expect(around(rows, 104, 1).map(r => r.strike)).toEqual([100, 105, 110])
    expect(around(rows, 80, 1).map(r => r.strike)).toEqual([90, 95])
  })
  it('finds an expiry far enough away and names it as a date', () => {
    const now = 1_000_000
    expect(expiryAtLeast([now + 5 * 86400, now + 30 * 86400, now + 60 * 86400], 25, now)).toBe(now + 30 * 86400)
    expect(expiryAtLeast([now + 5 * 86400], 25, now)).toBe(now + 5 * 86400)
    expect(expiryDate(1797552000)).toBe('2026-12-18')
  })
})
