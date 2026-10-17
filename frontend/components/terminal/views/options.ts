// OMON, OV and OSA read the chain endpoint: one expiry at a time, with the
// model's implied volatility and greeks on every contract.

import { useResource } from '@/lib/useResource'

export interface Side {
  symbol: string; bid: number | null; ask: number | null; last: number | null; mid: number | null
  volume: number | null; open_interest: number | null; iv: number | null; yahoo_iv: number | null
  in_the_money: boolean | null; delta?: number; gamma?: number; theta?: number; vega?: number
}

export interface Chain {
  symbol: string; spot: number; currency: string | null; expirations: number[]
  expiry: number; years: number; rate: number; dividend_yield: number
  rows: { strike: number; call?: Side; put?: Side }[]
}

export function useChain(symbol: string, expiry: number | null) {
  const url = `/api/terminal/options/${encodeURIComponent(symbol)}${expiry ? `?expiry=${expiry}` : ''}`
  return useResource<Chain>(url, { freshMs: 5 * 60_000 })
}

/** Option prices are quoted to the cent, whatever their size. */
export const premium = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2))

/** unix seconds of an expiry -> "2026-12-18" (Yahoo gives midnight UTC) */
export const expiryDate = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10)

/** "18 Dec 26" */
export const expiryLabel = (epoch: number) =>
  new Date(epoch * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })

/** The strikes nearest the spot, `each` either side. */
export function around<T extends { strike: number }>(rows: T[], spot: number, each: number): T[] {
  if (rows.length === 0) return rows
  let at = 0
  rows.forEach((r, i) => { if (Math.abs(r.strike - spot) < Math.abs(rows[at].strike - spot)) at = i })
  return rows.slice(Math.max(0, at - each), at + each + 1)
}

/** The first expiry at least `days` away, else the last one. */
export function expiryAtLeast(expirations: number[], days: number, now = Date.now() / 1000): number | null {
  return expirations.find(e => e - now >= days * 86400) ?? expirations[expirations.length - 1] ?? null
}
