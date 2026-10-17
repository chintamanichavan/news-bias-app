// Every terminal function, one entry each. The status says whether it works
// today, is planned (with its phase in docs/TERMINAL.md), or cannot be built
// on free data — in which case `why` says what is missing.

export type Status = 'live' | 'planned' | 'impossible'

export interface Fn {
  code: string
  name: string
  group: Group
  /** true when the function needs a security; otherwise it is market-wide */
  security: boolean
  status: Status
  phase?: number
  why?: string
}

export type Group =
  | 'Company'
  | 'Options'
  | 'Markets'
  | 'Rates & FX'
  | 'Economy'
  | 'News'
  | 'Screening'
  | 'Portfolio'
  | 'Trading'
  | 'Tools'

const live = (code: string, name: string, group: Group, security: boolean): Fn =>
  ({ code, name, group, security, status: 'live' })

const planned = (code: string, name: string, group: Group, security: boolean, phase: number): Fn =>
  ({ code, name, group, security, status: 'planned', phase })

const impossible = (code: string, name: string, group: Group, why: string): Fn =>
  ({ code, name, group, security: false, status: 'impossible', why })

const DEALER = 'Dealer quotes are sent privately to Bloomberg; there is no free source.'
const OWN_NEWSROOM = "Bloomberg's own reporters and analysts write it."

export const FUNCTIONS: Fn[] = [
  // Company
  live('DES', 'Description', 'Company', true),
  live('GP', 'Price chart', 'Company', true),
  live('GIP', 'Intraday chart', 'Company', true),
  live('HP', 'Historical prices', 'Company', true),
  live('FA', 'Financial analysis', 'Company', true),
  live('CN', 'Company news', 'Company', true),
  live('BETA', 'Beta and risk', 'Company', true),
  live('EE', 'Earnings estimates', 'Company', true),
  live('ERN', 'Earnings history', 'Company', true),
  live('EVTS', 'Corporate events', 'Company', true),
  live('DVD', 'Dividend history', 'Company', true),
  live('CACS', 'Corporate actions', 'Company', true),
  live('HDS', 'Holders', 'Company', true),
  live('OWN', 'Ownership summary', 'Company', true),
  live('MGMT', 'Management', 'Company', true),
  live('ANR', 'Analyst recommendations', 'Company', true),
  live('RV', 'Relative valuation', 'Company', true),
  live('SI', 'Short interest', 'Company', true),
  live('CF', 'Company filings', 'Company', true),
  live('TRA', 'Total return', 'Company', true),
  live('COMP', 'Comparative returns', 'Company', true),
  live('G', 'Multi-security chart', 'Company', false),
  impossible('ESG', 'ESG scores', 'Company', 'Yahoo stopped publishing them; the rating firms license their scores.'),
  impossible('SPLC', 'Supply chain', 'Company', 'A proprietary supply-chain database.'),
  impossible('CRPR', 'Credit ratings', 'Company', 'Rating agencies license their ratings.'),
  impossible('DDIS', 'Debt distribution', 'Company', 'Bond holdings and terms are not published free.'),
  impossible('BI', 'Bloomberg Intelligence', 'Company', OWN_NEWSROOM),
  impossible('BRC', 'Broker research', 'Company', 'Brokers license their research.'),
  impossible('MA', 'Mergers and acquisitions', 'Company', 'A proprietary deal database.'),

  // Options
  live('OMON', 'Option monitor', 'Options', true),
  live('OV', 'Option valuation', 'Options', true),
  live('OSA', 'Option scenario analysis', 'Options', true),
  live('IVOL', 'Implied volatility', 'Options', true),
  live('HIVG', 'Historical vs implied volatility', 'Options', true),
  live('SKEW', 'Volatility skew', 'Options', true),
  live('OVDV', 'Volatility surface', 'Options', true),

  // Markets
  live('WEI', 'World equity indices', 'Markets', false),
  live('GLCO', 'Commodities', 'Markets', false),
  live('WETR', 'Weather', 'Markets', false),
  live('MOST', 'Most active and movers', 'Markets', false),
  live('MMAP', 'Market heat map', 'Markets', false),
  live('IMAP', 'Industry map', 'Markets', false),
  live('CTM', 'Futures contract tables', 'Markets', false),
  live('IPO', 'IPO calendar', 'Markets', false),
  impossible('MBO', 'Market depth', 'Markets', 'Order-book feeds are licensed by the exchanges.'),
  impossible('BNEF', 'Energy research', 'Markets', OWN_NEWSROOM),

  // Rates & FX
  live('GC', 'Yield curve', 'Rates & FX', false),
  live('BTMM', 'Treasury and money markets', 'Rates & FX', false),
  live('WCRS', 'World currency rates', 'Rates & FX', false),
  live('FXC', 'Currency cross rates', 'Rates & FX', false),
  live('WIRP', 'Rate move probabilities', 'Rates & FX', false),
  impossible('WB', 'World bond prices', 'Rates & FX', DEALER),
  impossible('ALLQ', 'All dealer quotes', 'Rates & FX', DEALER),
  impossible('YAS', 'Bond yield analysis', 'Rates & FX', DEALER),
  impossible('FXFC', 'FX forecasts', 'Rates & FX', 'Bloomberg surveys forecasters itself.'),

  // Economy
  live('ECO', 'Economic calendar', 'Economy', false),
  live('ECST', 'Economic statistics', 'Economy', false),
  impossible('ECFC', "Economists' forecasts", 'Economy', 'Bloomberg surveys economists itself.'),

  // News
  live('N', 'News', 'News', false),
  live('TOP', 'Top stories', 'News', false),
  live('NSE', 'News search', 'News', false),
  impossible('FIRST', 'First Word headlines', 'News', OWN_NEWSROOM),
  impossible('READ', 'Most read', 'News', 'Needs readership across many users.'),
  impossible('TV', 'Bloomberg TV', 'News', 'A licensed broadcast.'),

  // Screening
  live('SECF', 'Security finder', 'Screening', false),
  live('EQS', 'Equity screener', 'Screening', false),
  live('BQL', 'Query language', 'Screening', false),
  impossible('SRCH', 'Bond search', 'Screening', DEALER),
  impossible('FSRC', 'Fund screener', 'Screening', 'Fund holdings and terms are a proprietary database.'),

  // Portfolio
  live('PORT', 'Portfolio', 'Portfolio', false),
  live('PRTU', 'Portfolio upload', 'Portfolio', false),
  live('MARS', 'Scenario and risk', 'Portfolio', false),
  live('ATTR', 'Performance attribution', 'Portfolio', false),

  // Trading
  planned('EMSX', 'Order ticket (paper)', 'Trading', true, 5),
  planned('TCA', 'Trade cost analysis (paper)', 'Trading', false, 5),
  impossible('TSOX', 'Bond trading', 'Trading', DEALER),
  impossible('FXGO', 'FX trading', 'Trading', DEALER),
  impossible('IOI', 'Indications of interest', 'Trading', 'Broker interest is shared only on Bloomberg\'s network.'),

  // Tools
  live('HELP', 'Help', 'Tools', false),
  live('FUNC', 'Function search', 'Tools', false),
  live('W', 'Watchlist monitor', 'Tools', false),
  live('ALRT', 'Alerts', 'Tools', false),
  live('NOTE', 'Notes', 'Tools', false),
  live('EXPT', 'Export to CSV', 'Tools', false),
  live('TEAR', 'Tear sheet', 'Tools', true),
  impossible('IB', 'Instant Bloomberg chat', 'Tools', 'A messaging network; the value is everyone else on it.'),
  impossible('MSG', 'Bloomberg mail', 'Tools', 'A messaging network; the value is everyone else on it.'),
  impossible('BPS', 'People search', 'Tools', 'A proprietary people database.'),
]

const BY_CODE = new Map(FUNCTIONS.map(f => [f.code, f]))

export function lookup(code: string): Fn | undefined {
  return BY_CODE.get(code.toUpperCase())
}

/** Functions whose code or name contains the query, codes first. */
export function searchFunctions(query: string): Fn[] {
  const q = query.trim().toUpperCase()
  if (!q) return FUNCTIONS
  const byCode = FUNCTIONS.filter(f => f.code.startsWith(q))
  const byName = FUNCTIONS.filter(f => !f.code.startsWith(q) && f.name.toUpperCase().includes(q))
  return [...byCode, ...byName]
}
