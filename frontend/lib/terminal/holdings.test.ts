import { describe, expect, it } from 'vitest'
import { parseHoldings } from './holdings'

describe('parseHoldings', () => {
  it('reads CSV with a header, plain lines and tabs', () => {
    const { rows, errors } = parseHoldings('symbol,quantity,cost,date\nAAPL,10,150.5,2024-01-02\nko 40 $60\nVOD.L\t100')
    expect(errors).toEqual([])
    expect(rows).toEqual([
      { symbol: 'AAPL', quantity: 10, cost: 150.5, opened: '2024-01-02' },
      { symbol: 'KO', quantity: 40, cost: 60, opened: null },
      { symbol: 'VOD.L', quantity: 100, cost: null, opened: null },
    ])
  })
  it('allows shorts, skips blank and comment lines', () => {
    expect(parseHoldings('# my book\n\nTSLA -5 200').rows).toEqual([{ symbol: 'TSLA', quantity: -5, cost: 200, opened: null }])
  })
  it('reports bad lines by number and keeps the good ones', () => {
    const { rows, errors } = parseHoldings('AAPL ten\nMSFT 3 -1\nNVDA 2 100 02/01/2024\nGOOG 1')
    expect(rows.map(r => r.symbol)).toEqual(['GOOG'])
    expect(errors).toEqual([
      'Line 1: the quantity for AAPL is not a number.',
      'Line 2: the cost for MSFT is not a price.',
      'Line 3: write the date as YYYY-MM-DD.',
    ])
  })
})
