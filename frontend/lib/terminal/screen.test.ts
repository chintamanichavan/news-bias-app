import { describe, expect, it } from 'vitest'
import { applyConditions, parseConditions, sortBy, type ScreenRow } from './screen'

const row = (symbol: string, over: Partial<ScreenRow>): ScreenRow => ({
  symbol, name: symbol, price: 10, mkt_cap: 5e9, pe: 20, roe: 15, margin: 10, growth: 5,
  yield: 1, exp_return: 10, chg_1y: 0, vs_high: -10, ...over,
})

describe('screen', () => {
  it('parses conditions in any case, and refuses the rest in plain words', () => {
    expect(parseConditions('pe<15 roe>=20 cap>10')).toEqual({ conditions: [
      { field: 'PE', op: '<', value: 15 }, { field: 'ROE', op: '>=', value: 20 }, { field: 'CAP', op: '>', value: 10 },
    ] })
    expect(parseConditions('')).toEqual({ conditions: [] })
    expect(parseConditions('chg>-20')).toEqual({ conditions: [{ field: 'CHG', op: '>', value: -20 }] })
    const bad = parseConditions('PE 15')
    expect('error' in bad && bad.error).toMatch(/"PE" is not a condition/)
    const unknown = parseConditions('BETA<1')
    expect('error' in unknown && unknown.error).toMatch(/Unknown field BETA/)
  })

  it('applies every condition, in typed units, and drops missing values', () => {
    const rows = [row('A', { pe: 12, mkt_cap: 20e9 }), row('B', { pe: 30 }), row('C', { pe: null }), row('D', { pe: 10, mkt_cap: 2e9 })]
    const parsed = parseConditions('PE<15 CAP>10')
    if ('error' in parsed) throw new Error(parsed.error)
    expect(applyConditions(rows, parsed.conditions).map(r => r.symbol)).toEqual(['A'])
  })

  it('sorts either way with missing values last', () => {
    const rows = [row('A', { roe: 10 }), row('B', { roe: null }), row('C', { roe: 30 })]
    expect(sortBy(rows, 'roe', true).map(r => r.symbol)).toEqual(['C', 'A', 'B'])
    expect(sortBy(rows, 'roe', false).map(r => r.symbol)).toEqual(['A', 'C', 'B'])
  })
})
