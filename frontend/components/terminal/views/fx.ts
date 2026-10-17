import { useResource } from '@/lib/useResource'

export interface CurrencyRow {
  code: string; name: string; pair: string; rate: number; as_of: string
  ch_1d: number | null; ch_1w: number | null; ch_1m: number | null; ch_ytd: number | null; ch_1y: number | null
}

export interface FxData {
  currencies: CurrencyRow[]
  cross: { codes: string[]; matrix: (number | null)[][] }
  missing: string[]
}

export function useFx() {
  return useResource<FxData>('/api/terminal/fx')
}

/** Rates near 1 need four places; yen-like rates need two. */
export function rateText(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: v >= 100 ? 2 : 4, maximumFractionDigits: v >= 100 ? 2 : 4 })
}
