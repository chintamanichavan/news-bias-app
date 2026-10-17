'use client'

// Saves every table on screen in a panel as one CSV: what you see, as shown.

import { download, toCsv } from '@/lib/terminal/csv'

function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map(row => Array.from(row.cells).map(cell => cell.innerText.trim()))
}

export default function ExportButton({ target, name }: { target: React.RefObject<HTMLElement>; name: string }) {
  function save() {
    const tables = Array.from(target.current?.querySelectorAll('table') ?? [])
    if (tables.length === 0) return
    // several tables (e.g. sectors and industries) are stacked, a blank line apart
    const rows = tables.flatMap((t, i) => (i === 0 ? tableRows(t) : [[], ...tableRows(t)]))
    download(name, toCsv(rows))
  }
  return (
    <button onClick={save} title="Save the tables on screen as CSV"
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:text-foreground">
      CSV
    </button>
  )
}
