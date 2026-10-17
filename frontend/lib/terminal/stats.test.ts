import { describe, expect, it } from 'vitest'
import { adjustedBeta, aligned, correlation, regress, returnsByDate, weekly } from './stats'

describe('stats', () => {
  it('recovers a known line exactly', () => {
    const xs = [0.01, -0.02, 0.03, 0.005, -0.01]
    const r = regress(xs, xs.map(x => 0.001 + 1.5 * x))!
    expect(r.beta).toBeCloseTo(1.5, 12)
    expect(r.alpha).toBeCloseTo(0.001, 12)
    expect(r.r2).toBeCloseTo(1, 12)
    expect(r.correlation).toBeCloseTo(1, 12)
  })

  it('matches a hand-worked regression', () => {
    // x 1..5, y 2,4,5,4,5: beta 0.6, alpha 2.2, r² 0.6
    const r = regress([1, 2, 3, 4, 5], [2, 4, 5, 4, 5])!
    expect(r.beta).toBeCloseTo(0.6, 12)
    expect(r.alpha).toBeCloseTo(2.2, 12)
    expect(r.r2).toBeCloseTo(0.6, 12)
    expect(r.seBeta).toBeCloseTo(Math.sqrt(2.4 / 3 / 10), 12)
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12)
  })

  it('aligns returns on shared dates and takes the last close of each week', () => {
    const a = returnsByDate([{ date: 'd1', close: 100 }, { date: 'd2', close: 110 }, { date: 'd3', close: 99 }])
    expect(a.get('d2')).toBeCloseTo(0.1, 12)
    const b = new Map([['d3', 0.5]])
    expect(aligned(a, b)).toEqual([{ date: 'd3', x: a.get('d3'), y: 0.5 }])
    const w = weekly([{ date: '2026-10-12', close: 1 }, { date: '2026-10-16', close: 2 }, { date: '2026-10-19', close: 3 }])
    expect(w.map(r => r.close)).toEqual([2, 3])          // Mon 12 to Fri 16 is one week
    expect(adjustedBeta(1.3)).toBeCloseTo(1.2, 12)
  })
})
