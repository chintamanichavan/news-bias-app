// PRTU: holdings pasted or uploaded as text. Accepts CSV with or without a
// header (symbol, quantity, cost, date) and plain "AAPL 10 150" lines.

export interface HoldingInput { symbol: string; quantity: number; cost: number | null; opened: string | null }

export type ParsedHoldings = { rows: HoldingInput[]; errors: string[] }

const HEADER = /^\s*(symbol|ticker)\b/i

export function parseHoldings(text: string): ParsedHoldings {
  const rows: HoldingInput[] = []
  const errors: string[] = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#') || (i === 0 && HEADER.test(line))) return
    const parts = line.split(/[,\t;]|\s+/).map(p => p.trim()).filter(Boolean)
    const [symbol, qty, cost, opened] = parts
    const quantity = Number(qty?.replace(/,/g, ''))
    const price = cost === undefined || cost === '' ? null : Number(cost.replace(/[$,]/g, ''))
    if (!symbol || !/^[A-Za-z0-9.^=-]{1,24}$/.test(symbol)) return errors.push(`Line ${i + 1}: "${line}" has no security.`)
    if (!Number.isFinite(quantity) || quantity === 0) return errors.push(`Line ${i + 1}: the quantity for ${symbol} is not a number.`)
    if (price !== null && !(price >= 0)) return errors.push(`Line ${i + 1}: the cost for ${symbol} is not a price.`)
    if (opened && !/^\d{4}-\d{2}-\d{2}$/.test(opened)) return errors.push(`Line ${i + 1}: write the date as YYYY-MM-DD.`)
    rows.push({ symbol: symbol.toUpperCase(), quantity, cost: price, opened: opened ?? null })
  })
  return { rows, errors }
}
