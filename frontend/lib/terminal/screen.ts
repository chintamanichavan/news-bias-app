// EQS conditions as typed: "PE<15 ROE>20 CAP>=10". Pure, so it is tested
// on its own; the screen applies the result to the rows it already holds.

export interface ScreenRow {
  symbol: string; name: string; price: number
  mkt_cap: number | null; pe: number | null; roe: number | null; margin: number | null
  growth: number | null; yield: number | null; exp_return: number | null
  chg_1y: number | null; vs_high: number | null
}

type NumericKey = Exclude<keyof ScreenRow, 'symbol' | 'name'>

/** typed name -> row field, and the factor from typed units to stored ones */
export const FIELDS: Record<string, { key: NumericKey; label: string; scale: number }> = {
  PRICE: { key: 'price', label: 'Price', scale: 1 },
  CAP: { key: 'mkt_cap', label: 'Market cap ($B)', scale: 1e9 },
  PE: { key: 'pe', label: 'P/E', scale: 1 },
  ROE: { key: 'roe', label: 'ROE %', scale: 1 },
  MARGIN: { key: 'margin', label: 'Net margin %', scale: 1 },
  GROWTH: { key: 'growth', label: 'Revenue growth %/yr', scale: 1 },
  YIELD: { key: 'yield', label: 'Dividend yield %', scale: 1 },
  RETURN: { key: 'exp_return', label: 'Expected return %/yr', scale: 1 },
  CHG: { key: 'chg_1y', label: '1-year change %', scale: 1 },
  HIGH: { key: 'vs_high', label: 'From 52-week high %', scale: 1 },
}

export interface Condition { field: string; op: '<' | '<=' | '>' | '>=' | '='; value: number }

export function parseConditions(text: string): { conditions: Condition[] } | { error: string } {
  const conditions: Condition[] = []
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    const m = /^([A-Z]+)(<=|>=|<|>|=)(-?\d+(?:\.\d+)?)$/.exec(word)
    if (!m) return { error: `"${word}" is not a condition. Write it like PE<15 or ROE>20.` }
    if (!FIELDS[m[1]]) return { error: `Unknown field ${m[1]}. Fields: ${Object.keys(FIELDS).join(', ')}.` }
    conditions.push({ field: m[1], op: m[2] as Condition['op'], value: Number(m[3]) })
  }
  return { conditions }
}

function holds(v: number, op: Condition['op'], target: number): boolean {
  switch (op) {
    case '<': return v < target
    case '<=': return v <= target
    case '>': return v > target
    case '>=': return v >= target
    case '=': return Math.abs(v - target) < 1e-9
  }
}

/** Rows meeting every condition. A row missing a field fails that condition. */
export function applyConditions(rows: ScreenRow[], conditions: Condition[]): ScreenRow[] {
  return rows.filter(r => conditions.every(c => {
    const f = FIELDS[c.field]
    const v = r[f.key]
    return v != null && holds(v, c.op, c.value * f.scale)
  }))
}

/** Sorted copy; missing values always last, whichever the direction. */
export function sortBy(rows: ScreenRow[], key: NumericKey, descending: boolean): ScreenRow[] {
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key]
    if (x == null) return y == null ? 0 : 1
    if (y == null) return -1
    return descending ? y - x : x - y
  })
}
