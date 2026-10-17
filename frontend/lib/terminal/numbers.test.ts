import { describe, expect, it } from 'vitest'
import { big, day, pct, price, ratioPct } from './numbers'
import { argFor, rangeFor } from './ranges'
import { heat } from '../../components/terminal/views/Heatmap'
import { movesText } from '../../components/terminal/views/Wirp'
import { rateText } from '../../components/terminal/views/fx'

describe('numbers', () => {
  it('shortens large values', () => {
    expect(big(3.42e12)).toBe('3.42T')
    expect(big(-2.5e9)).toBe('-2.50B')
    expect(big(59_852_690)).toBe('59.9M')
    expect(big(12_345)).toBe('12.3K')
    expect(big(950)).toBe('950')
  })

  it('shows a dash for missing values', () => {
    for (const f of [big, price, pct, ratioPct]) expect(f(null)).toBe('—')
    expect(big(NaN)).toBe('—')
    expect(day('not a date')).toBe('—')
  })

  it('formats prices and percentages', () => {
    expect(price(343.46)).toBe('343.46')
    expect(price(1.08421)).toBe('1.0842')
    expect(price(1.127)).toBe('1.1270')
    expect(pct(3.211)).toBe('+3.21%')
    expect(pct(-0.5)).toBe('-0.50%')
    expect(pct(2, false)).toBe('2.00%')
    expect(ratioPct(0.0321)).toBe('3.21%')
  })

  it('formats days from seconds or text', () => {
    expect(day('2026-10-16')).toBe('16 Oct 2026')
    expect(day(Date.UTC(2026, 9, 16, 12) / 1000)).toBe('16 Oct 2026')
  })
})

describe('ranges', () => {
  it('maps periods and refuses the rest', () => {
    expect(rangeFor([], '1y')).toEqual({ range: '1y' })
    expect(rangeFor(['5y'], '1y')).toEqual({ range: '5y' })
    expect(rangeFor(['1M'], '1y')).toEqual({ range: '1mo' })
    const bad = rangeFor(['10Y'], '1y')
    expect('error' in bad && bad.error).toMatch(/10Y is not available/)
    expect(argFor('6mo')).toBe('6M')
  })
})


describe('heat', () => {
  it('scales strength with the size of the move and caps at 3%', () => {
    expect(heat(null)).toContain('0.15')
    expect(heat(0)).toContain('145')
    expect(heat(-1)).toContain('0 72% 50%')
    expect(heat(3)).toBe(heat(9))
    expect(heat(1.5)).toBe('hsl(145 63% 38% / 0.51)')
    expect(heat(15, 30)).toBe(heat(1.5))   // half of a wider full scale
  })
})

describe('movesText', () => {
  it('reads quarter-point moves in words', () => {
    expect(movesText(0.02)).toBe('none')
    expect(movesText(0.4)).toBe('0.4 hike')
    expect(movesText(-1)).toBe('1.0 cut')
    expect(movesText(-2.3)).toBe('2.3 cuts')
  })
})

describe('rateText', () => {
  it('uses four places near 1 and two for large rates', () => {
    expect(rateText(1.12435)).toBe('1.1244')
    expect(rateText(157.987)).toBe('157.99')
    expect(rateText(null)).toBe('—')
  })
})
