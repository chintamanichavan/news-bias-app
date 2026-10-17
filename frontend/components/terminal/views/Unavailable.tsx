import { Note } from '../kit'
import type { ViewProps } from './types'
import { lookup } from '@/lib/terminal/functions'

const BOND_KEYS = ['CORP', 'GOVT', 'MTGE', 'MUNI', 'PFD', 'MMKT']

/** Why a function or security cannot show anything yet. */
export function reasonFor(fn: string, yellowKey: string | null): string | null {
  const f = lookup(fn)
  if (!f) return `There is no function called ${fn}.`
  if (f.status === 'impossible') return `${f.code} (${f.name}) cannot be built on free data. ${f.why}`
  if (f.security && yellowKey && BOND_KEYS.includes(yellowKey)) {
    return 'Bond and money-market prices come from dealers and are not available free.'
  }
  return null
}

export default function Unavailable({ command }: ViewProps) {
  return <Note>{reasonFor(command.fn, command.security?.key ?? null)}</Note>
}
