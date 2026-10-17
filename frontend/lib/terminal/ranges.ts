// Chart and history periods. The price endpoint serves exactly these ranges,
// so anything else is refused rather than quietly rounded.

export type Range = '1d' | '5d' | '1mo' | '6mo' | '1y' | '5y'

const BY_ARG: Record<string, Range> = {
  '1D': '1d', '5D': '5d', '1M': '1mo', '6M': '6mo', '1Y': '1y', '5Y': '5y',
}

export const RANGE_ARGS = Object.keys(BY_ARG)

export function rangeFor(args: string[], fallback: Range): { range: Range } | { error: string } {
  const arg = args[0]
  if (!arg) return { range: fallback }
  const range = BY_ARG[arg.toUpperCase()]
  return range ? { range } : { error: `Period ${arg} is not available. Use ${RANGE_ARGS.join(', ')}.` }
}

export function argFor(range: Range): string {
  return Object.entries(BY_ARG).find(([, r]) => r === range)![0]
}
