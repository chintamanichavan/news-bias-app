// The command grammar:   [SECURITY [EXCHANGE] [YELLOW KEY]] FUNCTION [ARGS]
// See docs/TERMINAL.md. Parsing is pure, so it is tested on its own.

import { lookup } from './functions'

export const YELLOW_KEYS = [
  'EQUITY', 'CORP', 'GOVT', 'MTGE', 'MMKT', 'MUNI', 'PFD', 'COMDTY', 'INDEX', 'CURNCY',
] as const
export type YellowKey = (typeof YELLOW_KEYS)[number]

export interface Security {
  /** what the user typed, normalised: "VOD LN EQUITY" */
  label: string
  /** the data provider's symbol: "VOD.L" */
  symbol: string
  key: YellowKey | null
}

export interface Command {
  fn: string
  security: Security | null
  args: string[]
}

export type Parsed = { ok: true; command: Command } | { ok: false; error: string }

/** Bloomberg exchange codes to the provider's suffix. US listings have none. */
const EXCHANGE_SUFFIX: Record<string, string> = {
  US: '', UN: '', UW: '', UQ: '',
  LN: '.L', JP: '.T', JT: '.T', GR: '.DE', GY: '.DE', FP: '.PA', NA: '.AS',
  SM: '.MC', IM: '.MI', SW: '.SW', HK: '.HK', CN: '.TO', AU: '.AX',
  IN: '.NS', IB: '.BO', KS: '.KS', TT: '.TW', SP: '.SI', BZ: '.SA',
}

const INDEX_SYMBOL: Record<string, string> = {
  SPX: '^GSPC', INDU: '^DJI', CCMP: '^IXIC', NDX: '^NDX', RTY: '^RUT', VIX: '^VIX',
  UKX: '^FTSE', DAX: '^GDAXI', CAC: '^FCHI', SX5E: '^STOXX50E', NKY: '^N225',
  HSI: '^HSI', SHCOMP: '000001.SS', SENSEX: '^BSESN', NIFTY: '^NSEI', AS51: '^AXJO',
  SPTSX: '^GSPTSE', KOSPI: '^KS11',
}

/** Generic first-month futures: Bloomberg "CL1" is the provider's "CL=F". */
const COMDTY_SYMBOL: Record<string, string> = {
  CL1: 'CL=F', CO1: 'BZ=F', NG1: 'NG=F', HO1: 'HO=F', XB1: 'RB=F',
  GC1: 'GC=F', SI1: 'SI=F', HG1: 'HG=F', PL1: 'PL=F', PA1: 'PA=F',
  C1: 'ZC=F', W1: 'ZW=F', S1: 'ZS=F', KC1: 'KC=F', SB1: 'SB=F', CT1: 'CT=F',
  ES1: 'ES=F', NQ1: 'NQ=F', TY1: 'ZN=F', US1: 'ZB=F',
}

const CRYPTO_SYMBOL: Record<string, string> = {
  XBTUSD: 'BTC-USD', XETUSD: 'ETH-USD', XSOUSD: 'SOL-USD',
}

const isYellowKey = (t: string): t is YellowKey => (YELLOW_KEYS as readonly string[]).includes(t)

function providerSymbol(ticker: string, exchange: string | null, key: YellowKey | null): string | null {
  const t = ticker.replace('/', '-')
  switch (key) {
    case 'INDEX':
      return INDEX_SYMBOL[t] ?? (t.startsWith('^') ? t : `^${t}`)
    case 'CURNCY':
      if (CRYPTO_SYMBOL[t]) return CRYPTO_SYMBOL[t]
      return /^[A-Z]{6}$/.test(t) ? `${t}=X` : t
    case 'COMDTY':
      return COMDTY_SYMBOL[t] ?? t
    case 'EQUITY':
    case null: {
      if (exchange === null) return t
      const suffix = EXCHANGE_SUFFIX[exchange]
      return suffix === undefined ? null : t + suffix
    }
    default:
      // Corp, Govt, Mtge, Muni, Pfd, Mmkt: the grammar accepts them; the
      // functions explain that bond data is not available free.
      return t
  }
}

function security(tokens: string[], key: YellowKey | null): Security | { error: string } {
  if (tokens.length === 0) return { error: 'Which security? Type it before the yellow key.' }
  if (tokens.length > 2) return { error: `Too many words before ${key ?? 'the function'}.` }
  const [ticker, exchange = null] = tokens
  const symbol = providerSymbol(ticker, exchange, key)
  if (symbol === null) return { error: `Unknown exchange code ${exchange}.` }
  return { label: [...tokens, ...(key ? [key] : [])].join(' '), symbol, key }
}

function fnAndArgs(rest: string[]): { fn: string; args: string[] } | { error: string } {
  if (rest.length === 0) return { fn: 'DES', args: [] }
  const [fn, ...args] = rest
  if (!lookup(fn)) return { error: `Unknown function ${fn}. Try FUNC to search.` }
  return { fn, args }
}

export function parse(input: string): Parsed {
  const tokens = input.trim().toUpperCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return { ok: false, error: 'Type a security, a function, or both.' }

  const yellow = tokens.findIndex(isYellowKey)
  if (yellow >= 0) {
    const sec = security(tokens.slice(0, yellow), tokens[yellow] as YellowKey)
    if ('error' in sec) return { ok: false, error: sec.error }
    const rest = fnAndArgs(tokens.slice(yellow + 1))
    if ('error' in rest) return { ok: false, error: rest.error }
    return { ok: true, command: { fn: rest.fn, security: sec, args: rest.args } }
  }

  if (lookup(tokens[0])) {
    return { ok: true, command: { fn: tokens[0], security: null, args: tokens.slice(1) } }
  }

  const sec = security(tokens.slice(0, 1), null)
  if ('error' in sec) return { ok: false, error: sec.error }
  const rest = fnAndArgs(tokens.slice(1))
  if ('error' in rest) return { ok: false, error: rest.error }
  return { ok: true, command: { fn: rest.fn, security: sec, args: rest.args } }
}

/** The command as it would be typed, for history lists and the URL. */
export function format(c: Command): string {
  return [c.security?.label, c.fn, ...c.args].filter(Boolean).join(' ')
}
