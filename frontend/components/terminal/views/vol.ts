// IVOL, HIVG, SKEW and OVDV read one volatility summary per security.

import { useResource } from '@/lib/useResource'

export interface SkewRow {
  expiry: number; days: number; atm: number | null
  put_25d: number | null; call_25d: number | null; risk_reversal: number | null; butterfly: number | null
  smile: { moneyness: number; iv: number; strike: number }[]
}

export interface Vol {
  symbol: string; spot: number; iv30: number | null
  realized: Record<string, number | null>
  term: { days: number; atm: number }[]
  skew: SkewRow[]
  moneyness: number[]
  surface: { expiry: number; days: number; iv: (number | null)[] }[]
  put_call: { volume: number | null; open_interest: number | null }
  realized_30d: { t: string; v: number }[]
  iv_history: { date: string; iv30: number }[]
}

export function useVol(symbol: string) {
  return useResource<Vol>(`/api/terminal/vol/${encodeURIComponent(symbol)}`, { freshMs: 10 * 60_000 })
}

export const volPct = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`)
export const volPts = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}`)
