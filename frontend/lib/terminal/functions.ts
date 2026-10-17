// Every terminal function, one entry each. The ones written here by hand
// are live or impossible; inventory.ts, generated from the public list of
// Bloomberg codes in docs/terminal-inventory.tsv, adds the rest: codes that
// are the same as another (alias), codes still to build (planned, with a
// plan in `why`), and codes that cannot be built on free data (with why).

import { INVENTORY } from './inventory'

export type Status = 'live' | 'alias' | 'planned' | 'impossible'

export interface Fn {
  code: string
  name: string
  group: Group
  /** true when the function needs a security; otherwise it is market-wide */
  security: boolean
  status: Status
  why?: string
  /** for an alias, the code it stands for, with any arguments (NRG is "FUNC energy") */
  target?: string
  /** for a planned code, the batch it will be built with */
  batch?: string
}

export type Group =
  | 'Company'
  | 'Options'
  | 'Markets'
  | 'Rates & FX'
  | 'Economy'
  | 'News'
  | 'Screening'
  | 'Technical'
  | 'Fixed income'
  | 'Credit'
  | 'Commodities'
  | 'Funds'
  | 'Deals'
  | 'Portfolio'
  | 'Trading'
  | 'Tools'

const live = (code: string, name: string, group: Group, security: boolean): Fn =>
  ({ code, name, group, security, status: 'live' })

const impossible = (code: string, name: string, group: Group, why: string): Fn =>
  ({ code, name, group, security: false, status: 'impossible', why })

const DEALER = 'Dealer quotes are sent privately to Bloomberg; there is no free source.'
const OWN_NEWSROOM = "Bloomberg's own reporters and analysts write it."

const BY_HAND: Fn[] = [
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
  live('EEG', 'Earnings estimate trend', 'Company', true),
  live('EERM', 'Estimate revisions', 'Company', true),
  live('EM', 'Earnings matrix: actuals against estimates', 'Company', true),
  live('MYE', 'My earnings estimates', 'Company', true),
  live('ACDR', 'Earnings calendar', 'Markets', false),
  live('SURP', 'Earnings surprises', 'Markets', false),
  live('EA', 'Earnings season by sector', 'Markets', false),
  live('CACT', 'Dividend and split calendar', 'Markets', false),
  live('CDR', 'Market holidays', 'Markets', false),
  live('EVTS', 'Corporate events', 'Company', true),
  live('DVD', 'Dividend history', 'Company', true),
  live('CACS', 'Corporate actions', 'Company', true),
  live('HDS', 'Holders', 'Company', true),
  live('OWN', 'Ownership summary', 'Company', true),
  live('MGMT', 'Management', 'Company', true),
  live('INSD', 'Insider transactions', 'Company', true),
  live('GPTR', 'Insider trades chart', 'Company', true),
  live('SIA', 'Short interest history', 'Company', true),
  live('SPOS', 'UK short positions', 'Company', false),
  live('FLNG', '13F holdings of a manager', 'Company', false),
  live('PHDC', 'Holdings search (13F)', 'Company', false),
  live('CFS', 'Filing search', 'Company', false),
  live('EDGS', 'EDGAR filing search', 'Company', false),
  live('ACF', 'Advanced filing search', 'Company', false),
  live('CFA', 'Filing search, advanced', 'Company', false),
  live('DSCO', 'Document search (proxies, annual reports)', 'Company', false),
  live('ANR', 'Analyst recommendations', 'Company', true),
  live('RV', 'Relative valuation', 'Company', true),
  live('WACC', 'Cost of capital', 'Company', true),
  live('DCF', 'Discounted cash flow', 'Company', true),
  live('DDM', 'Dividend discount model', 'Company', true),
  live('ARD', 'As-reported financials', 'Company', true),
  live('EV', 'Enterprise value bridge', 'Company', true),
  live('CAST', 'Capital structure', 'Credit', true),
  live('DLIS', 'Debt maturities', 'Credit', true),
  live('AZS', 'Altman Z-score', 'Credit', true),
  live('DRSK', 'Default risk (Merton)', 'Credit', true),
  live('DRAM', 'Default risk monitor', 'Credit', false),
  live('GF', 'Graph fundamentals', 'Company', true),
  live('GRET', 'P/E history', 'Company', true),
  live('PEBD', 'P/E bands', 'Company', true),
  live('BNKF', 'Bankruptcy filings', 'Credit', false),
  live('CL', 'Litigation in filings', 'Company', false),
  live('SI', 'Short interest', 'Company', true),
  live('CF', 'Company filings', 'Company', true),
  live('TRA', 'Total return', 'Company', true),
  live('COMP', 'Comparative returns', 'Company', true),
  live('HRA', 'Historical regression', 'Company', true),
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
  live('VM', 'Volatility monitor', 'Options', false),
  live('OVI', 'Unusual option activity', 'Options', false),
  live('MOSO', 'Most active options', 'Options', false),
  live('CWS', 'Covered call calculator', 'Options', true),
  live('OSCH', 'Option search', 'Options', true),
  live('VSV', 'Variance swap strike', 'Options', true),
  live('VCAL', 'Implied earnings moves', 'Options', false),
  live('CDVM', 'Commodity volatility', 'Options', false),
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
  live('WB', 'World bond yields', 'Rates & FX', false),
  live('BTMM', 'Treasury and money markets', 'Rates & FX', false),
  live('WCRS', 'World currency rates', 'Rates & FX', false),
  live('FXC', 'Currency cross rates', 'Rates & FX', false),
  live('WIRP', 'Rate move probabilities', 'Rates & FX', false),
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
  live('CORR', 'Correlation matrix', 'Markets', false),
  live('MOV', 'Index movers', 'Markets', false),
  live('MEMB', 'Index members and weights', 'Markets', false),
  live('GWGT', 'Index sector weights', 'Markets', false),
  live('MRR', 'Members ranked by return', 'Markets', false),
  live('WEIB', 'Market breadth', 'Markets', false),
  live('LVI', 'Unusual volume', 'Markets', false),
  live('WEIF', 'World equity index futures', 'Markets', false),
  live('GMM', 'Global macro movers', 'Markets', false),
  live('IRR', 'World indices ranked by yearly return', 'Markets', false),
  live('MRV', 'Market valuation by country', 'Markets', false),
  live('GRR', 'Sectors and industries ranked by return', 'Markets', false),
  live('HALT', 'Trading halts', 'Markets', false),
  live('CRYP', 'Cryptocurrency monitor', 'Rates & FX', false),
  live('FX24', 'FX moves by trading session', 'Rates & FX', false),
  live('FXCA', 'Currency converter', 'Rates & FX', false),

  // Technical: daily studies
  live('GPC', 'Candlestick chart', 'Technical', true),
  live('GPO', 'Bar chart (open, high, low, close)', 'Technical', true),
  live('GPL', 'Price chart, log scale', 'Technical', true),
  live('GPCA', 'Price chart with corporate actions', 'Technical', true),
  live('VBAR', 'Price and volume bars', 'Technical', true),
  live('TECH', 'Technical summary', 'Technical', true),
  live('RSI', 'Relative strength index', 'Technical', true),
  live('MACD', 'Moving average convergence/divergence', 'Technical', true),
  live('BOLL', 'Bollinger bands', 'Technical', true),
  live('MAE', 'Moving average envelopes', 'Technical', true),
  live('TAS', 'Stochastics', 'Technical', true),
  live('WLPR', 'Williams %R', 'Technical', true),
  live('CMCI', 'Commodity channel index', 'Technical', true),
  live('DMI', 'Directional movement index', 'Technical', true),
  live('OBV', 'On-balance volume', 'Technical', true),
  live('ROC', 'Rate of change', 'Technical', true),
  live('PTPS', 'Parabolic stop and reverse', 'Technical', true),
  live('CHKO', 'Chaikin oscillator', 'Technical', true),
  live('GOC', 'Ichimoku chart', 'Technical', true),
  live('PIV', 'Pivot points', 'Technical', true),
  live('PIVG', 'Pivot points chart', 'Technical', true),
  live('GM', 'Price and money flow', 'Technical', true),
  live('HVG', 'Historical volatility chart', 'Technical', true),
  live('NSV', 'Historical volatility monitor', 'Technical', true),
  live('KAOS', 'Hurst exponent', 'Technical', true),
  live('CNDL', 'Candlestick patterns', 'Technical', true),
  live('PFP', 'Point and figure chart', 'Technical', true),
  live('SEAG', 'Seasonality', 'Technical', true),
  // Technical: intraday
  live('GIPS', 'Intraday chart (compressed)', 'Technical', true),
  live('GIPW', 'Intraday chart (sliding window)', 'Technical', true),
  live('IGPC', 'Intraday candlestick chart', 'Technical', true),
  live('IGPO', 'Intraday bar chart', 'Technical', true),
  live('IGPV', 'Intraday price and VWAP', 'Technical', true),
  live('IGPF', 'Intraday Fibonacci lines', 'Technical', true),
  live('IBOL', 'Intraday Bollinger bands', 'Technical', true),
  live('ICCI', 'Intraday commodity channel index', 'Technical', true),
  live('IDMI', 'Intraday directional movement', 'Technical', true),
  live('IGOC', 'Intraday Ichimoku chart', 'Technical', true),
  live('IMAC', 'Intraday MACD', 'Technical', true),
  live('IMAE', 'Intraday moving average envelopes', 'Technical', true),
  live('IPTS', 'Intraday parabolic SAR', 'Technical', true),
  live('IROC', 'Intraday rate of change', 'Technical', true),
  live('IRSI', 'Intraday relative strength index', 'Technical', true),
  live('ITAS', 'Intraday stochastics', 'Technical', true),
  live('IWLP', 'Intraday Williams %R', 'Technical', true),
  live('GIM', 'Intraday money flow', 'Technical', true),
  live('VWAP', 'VWAP dashboard', 'Technical', true),
  live('VAP', 'Volume at price', 'Technical', true),
  live('AVGV', 'Average volume by time of day', 'Technical', true),
  live('GIV', 'Intraday volatility', 'Technical', true),
  live('HVT', 'Historical volatility table', 'Technical', true),
  // Technical: two or more securities
  live('HS', 'Historical spread and ratio', 'Technical', true),
  live('HSP', 'Spread graph', 'Technical', true),
  live('HSE', 'Spread and ratio graph', 'Technical', true),
  live('HSN', 'Normalised spread (z-score)', 'Technical', true),
  live('SGP', 'Price spread of two securities', 'Technical', true),
  live('GR', 'Ratio graph', 'Technical', true),
  live('SGIP', 'Intraday spread', 'Technical', true),
  live('ISGP', 'Intraday spread, 30 days', 'Technical', true),
  live('GV', 'Volatility comparison', 'Technical', true),
  live('MGR', 'Relative performance of several securities', 'Technical', false),

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
  live('EMSX', 'Order ticket (paper)', 'Trading', false),
  live('TCA', 'Trade cost analysis (paper)', 'Trading', false),
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

export const FUNCTIONS: Fn[] = [...BY_HAND, ...INVENTORY]

const BY_CODE = new Map(FUNCTIONS.map(f => [f.code, f]))

export function lookup(code: string): Fn | undefined {
  return BY_CODE.get(code.toUpperCase())
}

/** The function a code finally means, following aliases (CURV is GC). */
export function resolve(code: string): Fn | undefined {
  return resolveWithArgs(code).fn
}

/** As resolve, plus the arguments the alias carries. */
export function resolveWithArgs(code: string): { fn: Fn | undefined; args: string[] } {
  let f = lookup(code)
  let args: string[] = []
  for (let hops = 0; f?.status === 'alias' && hops < 4; hops++) {
    const [target, ...rest] = f.target!.split(' ')
    if (rest.length) args = rest
    f = lookup(target)
  }
  return { fn: f, args }
}

/** Functions whose code or name contains the query, codes first. */
export function searchFunctions(query: string): Fn[] {
  const q = query.trim().toUpperCase()
  if (!q) return FUNCTIONS
  const byCode = FUNCTIONS.filter(f => f.code.startsWith(q))
  const byName = FUNCTIONS.filter(f => !f.code.startsWith(q) && f.name.toUpperCase().includes(q))
  return [...byCode, ...byName]
}
