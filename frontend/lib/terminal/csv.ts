// CSV for EXPT and every panel's export button.

type Cell = string | number | boolean | null | undefined

/** RFC 4180: fields with a comma, quote or line break are quoted, and
 *  quotes inside them doubled. Missing values become empty fields. */
export function toCsv(rows: Cell[][]): string {
  const field = (v: Cell) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(field).join(',')).join('\r\n') + '\r\n'
}

/** Rows of objects to CSV, one column per key of the first row. */
export function objectsToCsv(rows: Record<string, Cell>[]): string {
  if (rows.length === 0) return ''
  const keys = Object.keys(rows[0])
  return toCsv([keys, ...rows.map(r => keys.map(k => r[k]))])
}

/** "AAPL US EQUITY GP 5Y" -> "AAPL-US-EQUITY-GP-5Y" */
export const fileName = (text: string) => text.trim().replace(/[^A-Za-z0-9.=^-]+/g, '-').replace(/^-|-$/g, '') || 'artha'

export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${fileName(name)}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
