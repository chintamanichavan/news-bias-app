import { describe, expect, it } from 'vitest'
import {
  candlePatterns, cci, chaikin, dmi, envelopes, historicalVol, hurst, ichimoku, moneyFlow, obv, parabolicSar,
  intradayVol, pivots, pointAndFigure, roc, seasonality, stochastic, volumeAtPrice, volumeByTime, williamsR, type Ohlcv,
} from './studies'

const bar = (i: number, c: number, spread = 1, v = 100, o = c): Ohlcv =>
  ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: o, high: Math.max(o, c) + spread, low: Math.min(o, c) - spread, close: c, volume: v })
const rising = Array.from({ length: 60 }, (_, i) => bar(i % 28, 100 + i))

describe('range studies', () => {
  it('stochastics and Williams %R by hand', () => {
    // closes 1..14 with high = c+1, low = c-1: range 0..15, last close 14 → %K 14/15
    const b = Array.from({ length: 14 }, (_, i) => bar(i, i + 1))
    expect(stochastic(b, 14, 1).k[13]).toBeCloseTo((14 / 15) * 100, 9)
    expect(williamsR(b)[13]).toBeCloseTo((1 / 15) * -100, 9)
  })

  it('CCI is zero for a flat market and positive in a rise', () => {
    expect(cci(Array.from({ length: 25 }, (_, i) => bar(i, 50)))[24]).toBe(0)
    expect(cci(rising)[59]!).toBeGreaterThan(100)
  })

  it('DMI: a steady rise has +DI above -DI and a strong ADX', () => {
    const d = dmi(rising)
    expect(d.adx[26]).toBeNull()
    expect(d.adx[27]).not.toBeNull()
    expect(d.plus[59]!).toBeGreaterThan(d.minus[59]!)
    expect(d.adx[59]!).toBeGreaterThan(50)
  })

  it('OBV adds volume on up days and subtracts on down days', () => {
    expect(obv([bar(0, 10, 1, 5), bar(1, 11, 1, 7), bar(2, 9, 1, 3), bar(3, 9, 1, 9)])).toEqual([0, 7, 4, 4])
  })

  it('rate of change and envelopes', () => {
    expect(roc([100, 110, 121], 1)).toEqual([null, expect.closeTo(10, 9), expect.closeTo(10, 9)])
    const e = envelopes([10, 10, 10], 3, 5)
    expect(e.upper[2]).toBeCloseTo(10.5, 9)
    expect(e.lower[2]).toBeCloseTo(9.5, 9)
  })

  it('parabolic SAR stays under a rise and flips on a collapse', () => {
    const b = [...rising.slice(0, 30), bar(30, 60, 1)]
    const p = parabolicSar(b)
    expect(p.up[29]).toBe(true)
    expect(p.sar[29]!).toBeLessThan(b[29].low)
    expect(p.up[30]).toBe(false)
    expect(p.sar[30]).toBe(Math.max(...b.slice(0, 30).map(x => x.high)))   // reverses to the extreme point
  })

  it('Chaikin money flow sign follows where closes sit in the range', () => {
    const top = Array.from({ length: 12 }, (_, i) => ({ ...bar(i, 10), close: 11, high: 11, low: 9 }))
    expect(chaikin(top).adl[11]).toBe(1200)
  })

  it('Ichimoku conversion and base lines are range midpoints', () => {
    const i = ichimoku(rising)
    expect(i.conversion[59]).toBeCloseTo(((159 + 1) + (151 - 1)) / 2, 9)
    expect(i.base[59]).toBeCloseTo(((159 + 1) + (134 - 1)) / 2, 9)
    expect(i.spanB[50]).toBeNull()
  })

  it('floor pivots', () => {
    const p = pivots(110, 90, 100)
    expect(p.pivot).toBe(100)
    expect(p).toMatchObject({ r1: 110, s1: 90, r2: 120, s2: 80, r3: 130, s3: 70 })
  })

  it('money flow index is 100 when every day rises', () => {
    expect(moneyFlow(rising).mfi[59]).toBe(100)
  })

  it('Hurst: a seeded random walk near 0.5, a strong trend near 1', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5
    let x = 100
    const walk = Array.from({ length: 2048 }, () => (x *= Math.exp(rand() * 0.02)))
    expect(hurst(walk)!).toBeGreaterThan(0.4)
    expect(hurst(walk)!).toBeLessThan(0.65)
  })

  it('historical volatility of alternating ±1% moves', () => {
    const xs = [100]
    for (let i = 0; i < 40; i++) xs.push(xs[xs.length - 1] * (i % 2 ? 0.99 : 1.01))
    expect(historicalVol(xs, 30)[40]!).toBeCloseTo(Math.sqrt(252) * 1.0, 0)
  })

  it('seasonality averages each calendar month across years', () => {
    const rows = [
      { date: '2024-12-31', close: 100 }, { date: '2025-01-31', close: 110 }, { date: '2025-12-31', close: 100 },
      { date: '2026-01-30', close: 90 },
    ]
    const s = seasonality(rows)
    expect(s.average[0]!.years).toBe(2)
    expect(s.average[0]!.mean).toBeCloseTo((10 + -10) / 2, 9)
    expect(s.average[0]!.up).toBe(0.5)
  })

  it('finds an engulfing candle and a doji', () => {
    const found = candlePatterns([
      { date: 'a', open: 10, high: 10.2, low: 9, close: 9.2, volume: 1 },
      { date: 'b', open: 9.1, high: 10.6, low: 9, close: 10.5, volume: 1 },
      { date: 'c', open: 10, high: 11, low: 9, close: 10.05, volume: 1 },
    ]).map(p => `${p.date} ${p.pattern}`)
    expect(found).toEqual(['b Bullish engulfing', 'c Doji'])
  })

  it('point and figure needs three boxes to reverse', () => {
    // 13 → 11 is only two boxes, so the X column stands; 10 turns it, 9 extends the Os
    expect(pointAndFigure([10, 11, 12, 13, 12, 11], 1, 3)).toEqual([{ up: true, from: 11, to: 13 }])
    expect(pointAndFigure([10, 11, 12, 13, 12, 11, 10, 9], 1, 3))
      .toEqual([{ up: true, from: 11, to: 13 }, { up: false, from: 12, to: 9 }])
    expect(pointAndFigure([10, 10.4, 12.6], 1, 3)).toEqual([{ up: true, from: 11, to: 12 }])
  })
})

describe('intraday analytics', () => {
  const bar = (date: string, p: number, v: number): Ohlcv => ({ date, open: p, high: p, low: p, close: p, volume: v })

  it('volume at price finds the busiest level and a 70% value area', () => {
    const b = [bar('d', 10, 10), bar('d', 11, 70), bar('d', 12, 15), bar('d', 13, 5)]
    const v = volumeAtPrice(b, 3)
    expect(v.total).toBe(100)
    expect(v.poc).toBeCloseTo(11.5, 9)                // the 11–12 bin holds 70
    expect(v.valueLow).toBeCloseTo(11, 9)
    expect(v.valueHigh).toBeCloseTo(12, 9)
  })

  it('volume by time averages past sessions and keeps the last one apart', () => {
    const rows = volumeByTime([bar('2026-10-14T09:30', 1, 100), bar('2026-10-15T09:30', 1, 300), bar('2026-10-16T09:30', 1, 50)])
    expect(rows).toEqual([{ time: '09:30', average: 200, today: 50 }])
  })

  it('intraday volatility skips the overnight gap', () => {
    const v = intradayVol([bar('2026-10-15T15:55', 100, 1), bar('2026-10-16T09:30', 150, 1), bar('2026-10-16T09:35', 151, 1), bar('2026-10-16T09:40', 150, 1)], 2, 252 * 78)
    expect(v[2]).toBeNull()                           // its window reaches back over the night
    expect(v[3]).not.toBeNull()
  })
})
