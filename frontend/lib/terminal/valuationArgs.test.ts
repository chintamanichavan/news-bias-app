import { describe, expect, it } from 'vitest'
import { valuationQuery } from './valuationArgs'

describe('valuation arguments', () => {
  it('turns pairs into a query', () => {
    expect(valuationQuery([])).toEqual({ query: '' })
    expect(valuationQuery(['g', '8', 'WACC', '9.5', 'BETA', '1.1'])).toEqual({ query: '?growth=8&wacc=9.5&beta=1.1' })
  })

  it('refuses unknown names and missing numbers', () => {
    expect(valuationQuery(['X', '1'])).toHaveProperty('error')
    expect(valuationQuery(['G'])).toEqual({ error: 'G needs a number after it.' })
    expect(valuationQuery(['G', 'fast'])).toEqual({ error: 'G needs a number after it.' })
  })
})
