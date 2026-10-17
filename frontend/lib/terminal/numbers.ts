// Number formatting for dense terminal tables. '—' always means "no value".

const DASH = '—'

export function big(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}K`
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH
  // fixed places so a column of prices lines up: 4 below 10 (currencies), else 2
  const digits = Math.abs(v) < 10 ? 4 : 2
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** a percentage already in percent units: 3.21 -> "+3.21%" */
export function pct(v: number | null | undefined, signed = true): string {
  if (v == null || !Number.isFinite(v)) return DASH
  const s = v.toFixed(2)
  return `${signed && v > 0 ? '+' : ''}${s}%`
}

/** a ratio as a percentage: 0.0321 -> "3.21%" */
export function ratioPct(v: number | null | undefined): string {
  return v == null ? DASH : pct(v * 100, false)
}

export function tone(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
}

/** unix seconds or an ISO string -> "16 Oct 2026" */
export function day(t: number | string | null | undefined): string {
  if (t == null) return DASH
  // a bare "2026-10-16" is a calendar day, not midnight UTC (which is the
  // day before in Chicago)
  const plain = typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t)
  const d = typeof t === 'number' ? new Date(t * 1000)
    : plain ? new Date(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)))
    : new Date(t)
  if (Number.isNaN(d.getTime())) return DASH
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
