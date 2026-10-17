import { describe, expect, it } from 'vitest'
import { bollinger, ema, macd, rsi, sma } from './studies'

// StockCharts' worked RSI example of Wilder's method, at the precision its
// spreadsheet uses (the two-decimal closes it prints give 70.46, not 70.53)
const WILDER = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826,
  45.8931, 46.0328, 45.6140, 46.2820, 46.2820, 46.0028, 46.0328, 46.4116, 46.2222]

describe('studies', () => {
  it('matches the published RSI example', () => {
    const r = rsi(WILDER)
    expect(r[13]).toBeNull()
    expect(r[14]).toBeCloseTo(70.53, 1)
    expect(r[15]).toBeCloseTo(66.32, 1)
    expect(r[17]).toBeCloseTo(69.41, 1)
    expect(r[18]).toBeCloseTo(66.36, 1)
  })

  it('averages line up with their dates', () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5])
    const e = ema([1, 2, 3, 4, 5], 3)
    expect(e.slice(0, 2)).toEqual([null, null])
    expect(e[2]).toBe(2)                          // seeded with the simple average
    expect(e[3]).toBe(3)                          // 4*0.5 + 2*0.5
  })

  it('MACD of a straight line settles to a constant gap and zero histogram', () => {
    const xs = Array.from({ length: 120 }, (_, i) => 100 + i)
    const m = macd(xs)
    expect(m.macd[24]).toBeNull()
    expect(m.macd[119]).toBeCloseTo(7, 1)         // (26-1)/2 - (12-1)/2 for a slope of 1
    expect(m.histogram[119]).toBeCloseTo(0, 3)
  })

  it('Bollinger bands are two population deviations wide', () => {
    const xs = [...Array(19).fill(10), 12]
    const b = bollinger(xs)
    const mean = 10.1, sd = Math.sqrt((19 * 0.01 + 3.61) / 20)
    expect(b.middle[19]).toBeCloseTo(mean, 9)
    expect(b.upper[19]).toBeCloseTo(mean + 2 * sd, 9)
    expect(b.percentB[19]).toBeCloseTo((12 - (mean - 2 * sd)) / (4 * sd), 9)
  })
})
