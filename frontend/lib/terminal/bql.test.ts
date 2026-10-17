import { describe, expect, it } from 'vitest'
import { BqlError, parseBql, run } from './bql'
import type { ScreenRow } from './screen'

const row = (symbol: string, over: Partial<ScreenRow>): ScreenRow => ({
  symbol, name: `${symbol} Inc`, price: 10, mkt_cap: 5e9, pe: 20, roe: 15, margin: 10, growth: 5,
  yield: 1, exp_return: 10, chg_1y: 0, vs_high: -10, ...over,
})

const ROWS = [
  row('A', { roe: 30, pe: 12, mkt_cap: 50e9, yield: 0.5 }),
  row('B', { roe: 25, pe: 40, yield: 4 }),
  row('C', { roe: 10, pe: 8, yield: 5 }),
  row('D', { roe: null, pe: 10 }),
]

const err = (q: string) => { try { parseBql(q) } catch (e) { return (e as Error).message } throw new Error('no error') }

describe('BQL', () => {
  it('filters with AND, OR and parentheses, in any case', () => {
    const r = run(parseBql('select symbol where roe > 20 and (pe < 15 or yield >= 3)'), ROWS)
    expect(r.rows.map(x => x[0])).toEqual(['A', 'B'])
    expect(r.matched).toBe(2)
  })

  it('binds AND tighter than OR', () => {
    const r = run(parseBql('SELECT symbol WHERE roe > 20 AND pe < 15 OR yield >= 5'), ROWS)
    expect(r.rows.map(x => x[0])).toEqual(['A', 'C'])
  })

  it('sorts with missing values last and limits', () => {
    const r = run(parseBql('SELECT symbol, roe ORDER BY roe DESC LIMIT 3'), ROWS)
    expect(r.rows).toEqual([['A', 30], ['B', 25], ['C', 10]])
    expect(run(parseBql('SELECT symbol ORDER BY roe'), ROWS).rows.map(x => x[0])).toEqual(['C', 'B', 'A', 'D'])
  })

  it('works in the typed units of market cap and with negatives', () => {
    expect(run(parseBql('SELECT symbol, cap WHERE cap > 10'), ROWS).rows).toEqual([['A', 50]])
    expect(run(parseBql('SELECT symbol WHERE high > -11'), ROWS).matched).toBe(4)
  })

  it('computes totals', () => {
    const r = run(parseBql('SELECT COUNT(*), AVG(pe), MEDIAN(pe), MAX(roe), SUM(cap) WHERE pe < 30'), ROWS)
    expect(r.columns).toEqual(['COUNT(*)', 'AVG(pe)', 'MEDIAN(pe)', 'MAX(roe)', 'SUM(cap)'])
    expect(r.rows[0][0]).toBe(3)
    expect(r.rows[0][1]).toBeCloseTo(10)
    expect(r.rows[0][2]).toBe(10)
    expect(r.rows[0][3]).toBe(30)
    expect(r.rows[0][4]).toBeCloseTo(60)
  })

  it('selects every field with *', () => {
    expect(run(parseBql('SELECT * LIMIT 1'), ROWS).columns).toContain('return')
  })

  it('explains mistakes in plain words with a position', () => {
    expect(err('symbol where pe < 3')).toMatch(/starts with SELECT/)
    expect(err('SELECT beta')).toMatch(/Expected a field but found "BETA"/)
    expect(err('SELECT symbol WHERE pe 3')).toMatch(/Expected a comparison .* after pe/)
    expect(err('SELECT symbol WHERE pe < x')).toMatch(/Expected a number after pe </)
    expect(err('SELECT symbol WHERE (pe < 3')).toMatch(/Expected "\)" at the end/)
    expect(err('SELECT symbol, COUNT(*)')).toMatch(/Mix of totals/)
    expect(err('SELECT AVG(*)')).toMatch(/AVG\(\*\) is not allowed/)
    expect(err('SELECT symbol LIMIT 2.5')).toMatch(/whole number/)
    expect(err('SELECT symbol # 3')).toMatch(/Cannot read "# 3"/)
    expect(err('SELECT symbol ORDER roe')).toMatch(/Expected "BY"/)
    expect(() => parseBql('SELECT symbol WHERE')).toThrow(BqlError)
  })
})
