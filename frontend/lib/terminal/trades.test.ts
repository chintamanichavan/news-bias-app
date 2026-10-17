import { describe, expect, it } from 'vitest'
import { parseTrades } from './trades'

describe('trades', () => {
  it('reads buys and sells', () => {
    expect(parseTrades(['buy', 'aapl', '10', 'SELL', 'KO', '5'])).toEqual({ trades: [{ symbol: 'AAPL', quantity: 10 }, { symbol: 'KO', quantity: -5 }] })
  })
  it('explains what is wrong', () => {
    expect(parseTrades([])).toHaveProperty('error')
    expect(parseTrades(['HOLD', 'AAPL', '1'])).toEqual({ error: 'Expected BUY or SELL, found HOLD.' })
    expect(parseTrades(['BUY', 'AAPL'])).toEqual({ error: 'BUY AAPL needs a quantity above zero.' })
  })
})
