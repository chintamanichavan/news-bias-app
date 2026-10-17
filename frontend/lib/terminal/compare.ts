// COMP and G take extra securities and a period after the function:
// "AAPL COMP MSFT 10Y", "G AAPL MSFT NVDA 1Y". Raw provider symbols only.

export const SPANS = ['1Y', '3Y', '5Y', '10Y'] as const
export type Span = (typeof SPANS)[number]

export const MAX_SYMBOLS = 8

export function splitArgs(first: string | null, args: string[], defaults: string[] = []):
  { symbols: string[]; span: Span } {
  const spanArg = args.find(a => (SPANS as readonly string[]).includes(a.toUpperCase()))
  const named = args.filter(a => a !== spanArg).map(a => a.toUpperCase())
  const symbols = [first, ...named, ...defaults].filter((s): s is string => !!s)
  const unique = symbols.filter((s, i) => symbols.indexOf(s) === i).slice(0, MAX_SYMBOLS)
  return { symbols: unique, span: (spanArg?.toUpperCase() as Span) ?? '5Y' }
}
