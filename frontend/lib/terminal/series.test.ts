import { describe, expect, it } from 'vitest'
import { rangeChange, withChanges, type Bar } from './series'

const bar = (t: number, c: number): Bar => ({ t, o: c, h: c, l: c, c, v: 100 })

describe('series', () => {
  it('measures change from first to last close', () => {
    expect(rangeChange([bar(1, 100), bar(2, 90), bar(3, 110)])).toBeCloseTo(10)
    expect(rangeChange([bar(1, 100)])).toBeNull()
    expect(rangeChange([])).toBeNull()
  })

  it('lists newest first with the change from the day before', () => {
    const rows = withChanges([bar(1, 100), bar(2, 110), bar(3, 99)])
    expect(rows.map(r => r.t)).toEqual([3, 2, 1])
    expect(rows[0].change).toBeCloseTo(-10)
    expect(rows[1].change).toBeCloseTo(10)
    expect(rows[2].change).toBeNull()
  })
})
