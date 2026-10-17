// PSH takes trades on the command line: "PSH BUY AAPL 10 SELL KO 5".

import { argSymbol } from './parse'

export type Trade = { symbol: string; quantity: number }

export function parseTrades(args: string[]): { trades: Trade[] } | { error: string } {
  const trades: Trade[] = []
  for (let i = 0; i < args.length; i += 3) {
    const side = args[i]?.toUpperCase()
    const qty = Number(args[i + 2])
    if (side !== 'BUY' && side !== 'SELL') return { error: `Expected BUY or SELL, found ${args[i]}.` }
    if (!args[i + 1]) return { error: `${side} needs a security.` }
    if (!(qty > 0)) return { error: `${side} ${args[i + 1].toUpperCase()} needs a quantity above zero.` }
    trades.push({ symbol: argSymbol(args[i + 1]), quantity: side === 'BUY' ? qty : -qty })
  }
  return trades.length ? { trades } : { error: 'Give a trade: PSH BUY AAPL 10 SELL KO 5.' }
}
