// Suggestions under the command line: functions for the word being typed,
// and securities while the first word is still being typed.

import { searchFunctions } from './functions'

export interface SecurityHit { symbol: string; name: string }

export interface Suggestion {
  /** the whole command line after choosing this */
  text: string
  label: string
  detail: string
}

const MAX = 6

export function suggest(input: string, hits: SecurityHit[]): Suggestion[] {
  const words = input.trimStart().split(/\s+/)
  const last = words[words.length - 1] ?? ''
  if (!last) return []
  const before = words.slice(0, -1).join(' ')
  const prefix = before ? `${before} ` : ''

  const fns: Suggestion[] = searchFunctions(last)
    .filter(f => f.status === 'live')
    .slice(0, MAX)
    .map(f => ({ text: `${prefix}${f.code}`, label: f.code, detail: f.name }))

  const secs: Suggestion[] = words.length === 1
    ? hits.slice(0, MAX).map(h => ({ text: `${h.symbol} `, label: h.symbol, detail: h.name }))
    : []

  // an exact function code first, then securities, then the other functions
  const exact = fns.filter(f => f.label === last.toUpperCase())
  const rest = fns.filter(f => f.label !== last.toUpperCase())
  return [...exact, ...secs, ...rest].slice(0, MAX)
}
