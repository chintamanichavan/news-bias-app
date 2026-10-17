import { describe, expect, it } from 'vitest'
import { FUNCTIONS, lookup, resolve } from './functions'

describe('the public inventory', () => {
  it('covers every code on the public lists, once', () => {
    expect(FUNCTIONS.length).toBeGreaterThanOrEqual(1125)
    expect(lookup('CURV')?.status).toBe('alias')
  })

  it('every alias ends at a real function that is not itself an alias', () => {
    for (const f of FUNCTIONS.filter(x => x.status === 'alias')) {
      const end = resolve(f.code)
      expect(end, f.code).toBeDefined()
      expect(end!.status, f.code).not.toBe('alias')
    }
  })

  it('every planned code has a batch and a plan, every impossible one a reason', () => {
    for (const f of FUNCTIONS) {
      if (f.status === 'planned') expect(f.batch && f.why, f.code).toBeTruthy()
      if (f.status === 'impossible') expect(f.why, f.code).toBeTruthy()
    }
  })

  it('aliases resolve to the screen they stand for', () => {
    expect(resolve('CURV')?.code).toBe('GC')
    expect(resolve('GP')?.code).toBe('GP')
  })
})
