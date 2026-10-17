// The Lab dossier (/api/lab/SYMBOL) feeds DES, FA and BETA. Only the fields
// those screens read are typed here; useResource shares one fetch.

import { useResource } from '@/lib/useResource'

type Numbers = Record<string, number | null>

export interface Dossier {
  error?: string
  symbol: string
  name: string | null
  asset_class: string | null
  observations: number
  span: { from: string; to: string }
  price: { last: number; vs_52w_high_pct: number; vs_52w_low_pct: number; trend: string }
  moments: { ann_return_pct: number; ann_vol_pct: number; skewness: number; excess_kurtosis: number }
  risk_adjusted: {
    sharpe: number | null; sortino: number | null; max_drawdown_pct: number
    drawdown_days: number; calmar: number | null
  }
  tails: { var_95_pct: number; var_99_pct: number; cvar_95_pct: number; cvar_99_pct: number }
  relative: { benchmark: string; beta: number | null; correlation: number | null }
  rolling_vol_30d: { date: string; vol: number }[]
  profile: {
    identity: {
      long_name: string | null; exchange: string | null; currency: string | null
      quote_type: string | null; sector: string | null; industry: string | null
      country: string | null; employees: number | null; summary: string | null
    }
    valuation: Numbers
    dividends: Record<string, number | string | null>
    profitability: Numbers
    growth: Numbers
    balance: Numbers
    analyst: Record<string, number | string | null>
    shares: Numbers
    calendar: { next_earnings: string | null }
    trading: Numbers
  } | null
  fundamentals_history: {
    span_years: number
    fiscal_years: Numbers[]
    cagr: Numbers
    shares_change_pct: number | null
  } | null
}

export function useDossier(symbol: string) {
  return useResource<Dossier>(`/api/lab/${encodeURIComponent(symbol)}`, { freshMs: 5 * 60_000 })
}
