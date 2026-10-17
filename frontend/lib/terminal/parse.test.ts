import { describe, expect, it } from 'vitest'
import { FUNCTIONS, lookup, searchFunctions } from './functions'
import { format, parse } from './parse'

function ok(input: string) {
  const p = parse(input)
  if (!p.ok) throw new Error(`expected "${input}" to parse: ${p.error}`)
  return p.command
}

function err(input: string): string {
  const p = parse(input)
  if (p.ok) throw new Error(`expected "${input}" to fail`)
  return p.error
}

describe('parse', () => {
  it('reads security, yellow key and function', () => {
    const c = ok('aapl us equity des')
    expect(c.fn).toBe('DES')
    expect(c.security).toEqual({ label: 'AAPL US EQUITY', symbol: 'AAPL', key: 'EQUITY' })
    expect(c.args).toEqual([])
  })

  it('opens the description when only a security is given', () => {
    expect(ok('AAPL').fn).toBe('DES')
    expect(ok('VOD LN EQUITY').fn).toBe('DES')
  })

  it('passes arguments through', () => {
    expect(ok('AAPL GP 5Y').args).toEqual(['5Y'])
    expect(ok('HELP DES')).toEqual({ fn: 'HELP', security: null, args: ['DES'] })
  })

  it('leaves the security empty for a bare function', () => {
    expect(ok('WEI')).toEqual({ fn: 'WEI', security: null, args: [] })
    expect(ok('GP 1Y').security).toBeNull()
  })

  it('translates exchanges, indices, currencies and futures', () => {
    expect(ok('VOD LN EQUITY').security?.symbol).toBe('VOD.L')
    expect(ok('7203 JP EQUITY').security?.symbol).toBe('7203.T')
    expect(ok('BRK/B US EQUITY').security?.symbol).toBe('BRK-B')
    expect(ok('SPX INDEX GP').security?.symbol).toBe('^GSPC')
    expect(ok('XYZ INDEX').security?.symbol).toBe('^XYZ')
    expect(ok('EURUSD CURNCY GP').security?.symbol).toBe('EURUSD=X')
    expect(ok('XBTUSD CURNCY').security?.symbol).toBe('BTC-USD')
    expect(ok('CL1 COMDTY HP').security?.symbol).toBe('CL=F')
  })

  it('accepts raw provider symbols', () => {
    expect(ok('^GSPC GP').security?.symbol).toBe('^GSPC')
    expect(ok('EURUSD=X').security?.symbol).toBe('EURUSD=X')
    expect(ok('btc-usd gp').security?.symbol).toBe('BTC-USD')
  })

  it('reports mistakes in plain words', () => {
    expect(err('')).toMatch(/Type a security/)
    expect(err('AAPL XYZQ')).toMatch(/Unknown function XYZQ/)
    expect(err('EQUITY DES')).toMatch(/Which security/)
    expect(err('A B C EQUITY')).toMatch(/Too many words/)
    expect(err('VOD ZZ EQUITY')).toMatch(/Unknown exchange code ZZ/)
    expect(err('AAPL US EQUITY NOPE')).toMatch(/Unknown function NOPE/)
  })

  it('round-trips through format', () => {
    for (const input of ['AAPL US EQUITY GP 5Y', 'WEI', 'EURUSD CURNCY HP', 'HELP DES']) {
      expect(format(ok(input))).toBe(input)
    }
  })
})

describe('functions', () => {
  it('has unique codes, and every impossible one says why', () => {
    const codes = FUNCTIONS.map(f => f.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const f of FUNCTIONS) {
      if (f.status === 'impossible') expect(f.why, f.code).toBeTruthy()
      if (f.status === 'planned') expect(f.phase, f.code).toBeGreaterThan(1)
    }
  })

  it('looks codes up in any case and searches names', () => {
    expect(lookup('gp')?.name).toBe('Price chart')
    expect(searchFunctions('GP')[0].code).toBe('GP')
    expect(searchFunctions('dividend').map(f => f.code)).toContain('DVD')
    expect(searchFunctions('').length).toBe(FUNCTIONS.length)
  })
})
