// BQL: a small SQL-style query language over the EQS table.
//
//   SELECT symbol, pe, roe WHERE roe > 20 AND (pe < 15 OR yield >= 3)
//   ORDER BY roe DESC LIMIT 20
//   SELECT COUNT(*), AVG(pe), MEDIAN(roe) WHERE cap > 10
//
// A recursive-descent parser over tokens, then a plain evaluator. Every
// error says what was expected and where.

import type { ScreenRow } from './screen'

export const FIELDS: Record<string, { key: keyof ScreenRow; label: string; scale?: number }> = {
  SYMBOL: { key: 'symbol', label: 'Symbol' },
  NAME: { key: 'name', label: 'Name' },
  PRICE: { key: 'price', label: 'Price' },
  CAP: { key: 'mkt_cap', label: 'Market cap ($B)', scale: 1e9 },
  PE: { key: 'pe', label: 'P/E' },
  ROE: { key: 'roe', label: 'ROE %' },
  MARGIN: { key: 'margin', label: 'Net margin %' },
  GROWTH: { key: 'growth', label: 'Revenue growth %' },
  YIELD: { key: 'yield', label: 'Dividend yield %' },
  RETURN: { key: 'exp_return', label: 'Expected return %' },
  CHG: { key: 'chg_1y', label: '1-year change %' },
  HIGH: { key: 'vs_high', label: 'From 52-week high %' },
}

const AGGREGATES = ['COUNT', 'AVG', 'MEDIAN', 'MIN', 'MAX', 'SUM'] as const
type Aggregate = (typeof AGGREGATES)[number]

export type Item = { field: string } | { agg: Aggregate; field: string | '*' }
export type Expr =
  | { op: 'AND' | 'OR'; left: Expr; right: Expr }
  | { cmp: '<' | '<=' | '>' | '>=' | '=' | '!='; field: string; value: number }
export interface Query { select: Item[]; where: Expr | null; order: { field: string; desc: boolean } | null; limit: number | null }

type Token = { kind: 'word' | 'number' | 'op' | 'punct'; text: string; at: number }

export class BqlError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = []
  // one token at the start of what is left, each time
  const re = /^\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(<=|>=|!=|<>|[<>=])|([(),*-]))/
  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    if (/^\s*$/.test(rest)) break
    const m = re.exec(rest)
    if (!m) throw new BqlError(`Cannot read "${rest.trim().slice(0, 12)}" at character ${i + 1}.`)
    const at = i + m[0].length - (m[1] ?? m[2] ?? m[3] ?? m[4]).length
    if (m[1]) out.push({ kind: 'number', text: m[1], at })
    else if (m[2]) out.push({ kind: 'word', text: m[2].toUpperCase(), at })
    else if (m[3]) out.push({ kind: 'op', text: m[3] === '<>' ? '!=' : m[3], at })
    else out.push({ kind: 'punct', text: m[4], at })
    i += m[0].length
  }
  return out
}

class Parser {
  private i = 0
  constructor(private tokens: Token[]) {}

  private peek(): Token | undefined { return this.tokens[this.i] }
  private next(): Token | undefined { return this.tokens[this.i++] }
  private where(): string {
    const t = this.peek()
    return t ? `at "${t.text}" (character ${t.at + 1})` : 'at the end'
  }
  private word(w: string): boolean {
    if (this.peek()?.kind === 'word' && this.peek()!.text === w) { this.i++; return true }
    return false
  }
  private expect(text: string) {
    if (this.peek()?.text !== text) throw new BqlError(`Expected "${text}" ${this.where()}.`)
    this.i++
  }
  private field(): string {
    const t = this.next()
    if (!t || t.kind !== 'word' || !FIELDS[t.text]) {
      throw new BqlError(`Expected a field ${t ? `but found "${t.text}" (character ${t.at + 1})` : 'at the end'}. Fields: ${Object.keys(FIELDS).join(', ').toLowerCase()}.`)
    }
    return t.text
  }

  query(): Query {
    if (!this.word('SELECT')) throw new BqlError(`A query starts with SELECT.`)
    const select = [this.item()]
    while (this.peek()?.text === ',') { this.i++; select.push(this.item()) }
    const where = this.word('WHERE') ? this.or() : null
    let order: Query['order'] = null
    if (this.word('ORDER')) {
      if (!this.word('BY')) throw new BqlError(`Expected "BY" after ORDER ${this.where()}.`)
      const field = this.field()
      const desc = this.word('DESC')
      if (!desc) this.word('ASC')   // ascending is the default; the word is optional
      order = { field, desc }
    }
    let limit: number | null = null
    if (this.word('LIMIT')) {
      const t = this.next()
      if (t?.kind !== 'number' || !Number.isInteger(Number(t.text))) throw new BqlError(`LIMIT needs a whole number ${this.where()}.`)
      limit = Number(t.text)
    }
    if (this.peek()) throw new BqlError(`Unexpected "${this.peek()!.text}" (character ${this.peek()!.at + 1}).`)
    const aggs = select.filter(s => 'agg' in s).length
    if (aggs && aggs !== select.length) throw new BqlError('Mix of totals (COUNT, AVG …) and plain fields: use one or the other.')
    return { select, where, order, limit }
  }

  private item(): Item {
    const t = this.peek()
    if (t?.kind === 'word' && (AGGREGATES as readonly string[]).includes(t.text) && this.tokens[this.i + 1]?.text === '(') {
      this.i += 2
      let field: string
      if (this.peek()?.text === '*') {
        if (t.text !== 'COUNT') throw new BqlError(`${t.text}(*) is not allowed; name a field.`)
        this.i++
        field = '*'
      } else field = this.field()
      this.expect(')')
      return { agg: t.text as Aggregate, field }
    }
    if (t?.text === '*') { this.i++; return { field: '*' } }
    return { field: this.field() }
  }

  private or(): Expr {
    let left = this.and()
    while (this.word('OR')) left = { op: 'OR', left, right: this.and() }
    return left
  }

  private and(): Expr {
    let left = this.atom()
    while (this.word('AND')) left = { op: 'AND', left, right: this.atom() }
    return left
  }

  private atom(): Expr {
    if (this.peek()?.text === '(') {
      this.i++
      const e = this.or()
      this.expect(')')
      return e
    }
    const field = this.field()
    const op = this.next()
    if (op?.kind !== 'op') throw new BqlError(`Expected a comparison (<, <=, >, >=, =, !=) after ${field.toLowerCase()} ${this.where()}.`)
    let sign = 1
    if (this.peek()?.text === '-') { this.i++; sign = -1 }
    const v = this.next()
    if (v?.kind !== 'number') throw new BqlError(`Expected a number after ${field.toLowerCase()} ${op.text} ${this.where()}.`)
    return { cmp: op.text as '<', field, value: sign * Number(v.text) }
  }
}

export function parseBql(src: string): Query {
  return new Parser(tokenize(src)).query()
}

function value(row: ScreenRow, field: string): number | string | null {
  const f = FIELDS[field]
  return (row[f.key] as number | string | null | undefined) ?? null
}

function test(e: Expr, row: ScreenRow): boolean {
  if ('op' in e) return e.op === 'AND' ? test(e.left, row) && test(e.right, row) : test(e.left, row) || test(e.right, row)
  const v = value(row, e.field)
  if (typeof v !== 'number') return false
  const target = e.value * (FIELDS[e.field].scale ?? 1)
  switch (e.cmp) {
    case '<': return v < target
    case '<=': return v <= target
    case '>': return v > target
    case '>=': return v >= target
    case '=': return v === target
    case '!=': return v !== target
  }
}

function total(agg: Aggregate, values: number[]): number | null {
  if (agg === 'COUNT') return values.length
  if (values.length === 0) return null
  if (agg === 'SUM') return values.reduce((a, b) => a + b, 0)
  if (agg === 'AVG') return values.reduce((a, b) => a + b, 0) / values.length
  if (agg === 'MIN') return Math.min(...values)
  if (agg === 'MAX') return Math.max(...values)
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface Result { columns: string[]; rows: (string | number | null)[][]; matched: number }

export function run(q: Query, rows: ScreenRow[]): Result {
  let hits = q.where ? rows.filter(r => test(q.where!, r)) : rows
  if (q.select.every(s => 'agg' in s)) {
    const items = q.select as { agg: Aggregate; field: string }[]
    const columns = items.map(s => `${s.agg}(${s.field === '*' ? '*' : s.field.toLowerCase()})`)
    const out = items.map(s => {
      if (s.field === '*') return hits.length
      const vals = hits.map(r => value(r, s.field)).filter((v): v is number => typeof v === 'number')
      const t = total(s.agg, vals)
      return t != null && s.agg !== 'COUNT' && FIELDS[s.field].scale ? t / FIELDS[s.field].scale! : t
    })
    return { columns, rows: [out], matched: hits.length }
  }
  if (q.order) {
    const { field, desc } = q.order
    hits = [...hits].sort((a, b) => {
      const x = value(a, field), y = value(b, field)
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))
      return desc ? -c : c
    })
  }
  const fields = q.select.flatMap(s => ((s as { field: string }).field === '*' ? Object.keys(FIELDS) : [(s as { field: string }).field]))
  const shown = q.limit != null ? hits.slice(0, q.limit) : hits
  return {
    columns: fields.map(f => f.toLowerCase()),
    rows: shown.map(r => fields.map(f => {
      const v = value(r, f)
      return typeof v === 'number' && FIELDS[f].scale ? v / FIELDS[f].scale! : v
    })),
    matched: hits.length,
  }
}
