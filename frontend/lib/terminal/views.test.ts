import { describe, expect, it } from 'vitest'
import { FUNCTIONS } from './functions'
import { LIVE_VIEWS } from '../../components/terminal/views'
import { reasonFor } from '../../components/terminal/views/Unavailable'

describe('views', () => {
  it('has a screen for every live function and none for the rest', () => {
    const live = FUNCTIONS.filter(f => f.status === 'live').map(f => f.code).sort()
    expect([...LIVE_VIEWS].sort()).toEqual(live)
  })

  it('explains planned, impossible and bond requests', () => {
    expect(reasonFor('DES', 'EQUITY')).toBeNull()
    expect(reasonFor('TCA', null)).toMatch(/phase 5/)
    expect(reasonFor('IB', null)).toMatch(/messaging network/)
    expect(reasonFor('DES', 'CORP')).toMatch(/dealers/)
    expect(reasonFor('WEI', 'CORP')).toBeNull()
  })
})
