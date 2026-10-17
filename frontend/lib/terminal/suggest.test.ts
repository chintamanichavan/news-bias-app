import { describe, expect, it } from 'vitest'
import { suggest } from './suggest'

const apple = [{ symbol: 'AAPL', name: 'Apple Inc.' }, { symbol: 'APLE', name: 'Apple Hospitality' }]

describe('suggest', () => {
  it('offers nothing for an empty line', () => {
    expect(suggest('', apple)).toEqual([])
    expect(suggest('AAPL ', apple)).toEqual([])
  })

  it('offers securities while the first word is typed', () => {
    const s = suggest('appl', apple)
    expect(s.map(x => x.label)).toContain('AAPL')
    expect(s.find(x => x.label === 'AAPL')?.text).toBe('AAPL ')
  })

  it('completes the function after a security, keeping the security', () => {
    const s = suggest('AAPL g', [])
    expect(s[0].label).toBe('G')                     // the exact code comes first
    expect(s).toContainEqual({ text: 'AAPL GP', label: 'GP', detail: 'Price chart' })
    expect(s.every(x => x.text.startsWith('AAPL '))).toBe(true)
  })

  it('puts an exact function code first and offers only live functions', () => {
    expect(suggest('des', apple)[0].label).toBe('DES')
    expect(suggest('IB', []).map(x => x.label)).not.toContain('IB')
  })

  it('never offers more than six', () => {
    expect(suggest('e', Array(10).fill(apple[0])).length).toBeLessThanOrEqual(6)
  })
})
