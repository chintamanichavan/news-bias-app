import { describe, expect, it } from 'vitest'
import { splitArgs } from './compare'

describe('splitArgs', () => {
  it('puts the panel security first, then the named ones, then defaults', () => {
    expect(splitArgs('AAPL', ['msft'], ['SPY', 'QQQ'])).toEqual({ symbols: ['AAPL', 'MSFT', 'SPY', 'QQQ'], span: '5Y' })
  })
  it('reads a period anywhere and drops repeats', () => {
    expect(splitArgs(null, ['AAPL', '10y', 'AAPL', 'NVDA'])).toEqual({ symbols: ['AAPL', 'NVDA'], span: '10Y' })
  })
  it('caps the number of securities', () => {
    expect(splitArgs(null, 'A B C D E F G H I J'.split(' ')).symbols).toHaveLength(8)
  })
})
