import { describe, expect, it } from 'vitest'
import { fileName, objectsToCsv, toCsv } from './csv'

describe('csv', () => {
  it('quotes only what needs quoting', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"', null, 3.5]])).toBe('a,"b,c","say ""hi""",,3.5\r\n')
    expect(toCsv([['line\nbreak']])).toBe('"line\nbreak"\r\n')
  })
  it('turns objects into a header and rows', () => {
    expect(objectsToCsv([{ symbol: 'AAPL', pe: 30 }, { symbol: 'MSFT', pe: null }])).toBe('symbol,pe\r\nAAPL,30\r\nMSFT,\r\n')
    expect(objectsToCsv([])).toBe('')
  })
  it('makes safe file names', () => {
    expect(fileName('AAPL US EQUITY GP 5Y')).toBe('AAPL-US-EQUITY-GP-5Y')
    expect(fileName('EQS PE<15 ROE>20')).toBe('EQS-PE-15-ROE-20')
    expect(fileName('  ')).toBe('artha')
  })
})
