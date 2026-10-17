// TRA, COMP and G read one endpoint: period returns and growth of 100.

import { useResource } from '@/lib/useResource'
import type { Span } from '@/lib/terminal/compare'

type Period = { price_pct: number; total_pct: number; income_pct: number; per_year_pct: number | null } | null

export interface ReturnSeries {
  symbol: string; missing?: boolean; currency?: string | null
  periods?: Record<'1m' | '3m' | 'ytd' | '1y' | '3y' | '5y' | '10y', Period>
  total?: { t: string; v: number }[]; price?: { t: string; v: number }[]
}

export function useReturns(symbols: string[], span: Span) {
  const url = symbols.length
    ? `/api/terminal/returns?symbols=${encodeURIComponent(symbols.join(','))}&span=${span.toLowerCase()}`
    : null
  return useResource<{ span: string; series: ReturnSeries[] }>(url, { freshMs: 30 * 60_000 })
}

export const PERIODS: ['1m' | '3m' | 'ytd' | '1y' | '3y' | '5y' | '10y', string][] = [
  ['1m', '1 month'], ['3m', '3 months'], ['ytd', 'This year'], ['1y', '1 year'], ['3y', '3 years'], ['5y', '5 years'], ['10y', '10 years'],
]

export const LINE_COLOURS = [
  'stroke-foreground', 'stroke-sky-500', 'stroke-amber-500', 'stroke-emerald-500',
  'stroke-fuchsia-500', 'stroke-red-500', 'stroke-indigo-500', 'stroke-lime-600',
]
