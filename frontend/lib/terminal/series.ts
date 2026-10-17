// Arithmetic on a price series, shared by GP and HP.

export interface Bar { t: number; o: number | null; h: number | null; l: number | null; c: number; v: number | null }

/** Change from the first to the last close shown. The price API's own
 *  "change" is measured from the start of the range, not from yesterday. */
export function rangeChange(series: Bar[]): number | null {
  const closes = series.map(p => p.c).filter(c => c != null)
  if (closes.length < 2 || !closes[0]) return null
  return (closes[closes.length - 1] / closes[0] - 1) * 100
}

/** Newest first, each day's close against the day before. */
export function withChanges<T extends Bar>(series: T[]): (T & { change: number | null })[] {
  const rows = series.map((p, i) => {
    const prev = series[i - 1]?.c
    return { ...p, change: prev ? (p.c / prev - 1) * 100 : null }
  })
  return rows.reverse()
}
