// WACC, DCF and DDM take their assumptions as pairs after the function:
// "AAPL DCF G 8 TG 2 WACC 9". Rates are in percent, beta is a number.

const KEYS: Record<string, string> = {
  G: 'growth', TG: 'terminal_growth', DG: 'dividend_growth', BETA: 'beta', ERP: 'erp', RF: 'rf', WACC: 'wacc', KE: 'ke',
}

export const ARG_HELP = 'G growth %, TG terminal growth %, DG dividend growth %, BETA, ERP %, RF risk-free %, WACC %, KE cost of equity %'

export function valuationQuery(args: string[]): { query: string } | { error: string } {
  const params = new URLSearchParams()
  for (let i = 0; i < args.length; i += 2) {
    const key = KEYS[args[i].toUpperCase()]
    if (!key) return { error: `Unknown assumption ${args[i]}. Use ${ARG_HELP}.` }
    const v = Number(args[i + 1])
    if (args[i + 1] === undefined || !Number.isFinite(v)) return { error: `${args[i].toUpperCase()} needs a number after it.` }
    params.set(key, String(v))
  }
  const q = params.toString()
  return { query: q ? `?${q}` : '' }
}
