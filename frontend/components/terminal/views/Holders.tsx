import { Note, Table } from '../kit'
import { CompanySection, type Owner } from './company'
import type { ViewProps } from './types'
import { big, day, pct, tone } from '@/lib/terminal/numbers'

function OwnerTable({ title, rows }: { title: string; rows: Owner[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <p className="news-section-label mb-1">{title}</p>
      <Table
        rows={rows}
        rowKey={o => o.holder}
        columns={[
          { head: 'Holder', align: 'left', cell: o => o.holder },
          { head: 'Held', cell: o => pct(o.pct, false) },
          { head: 'Shares', cell: o => big(o.shares) },
          { head: 'Value', cell: o => big(o.value) },
          { head: 'Change', cell: o => pct(o.change_pct), className: o => tone(o.change_pct) },
          { head: 'As of', cell: o => day(o.as_of) },
        ]}
      />
    </div>
  )
}

export default function Holders({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="holders" missing="No holder filings are published for this security.">
      {h => (
        <div className="space-y-4">
          <OwnerTable title="Largest institutions" rows={h.institutions} />
          <OwnerTable title="Largest funds" rows={h.funds} />
          <Note>From quarterly 13F and fund filings, so a quarter or more old. OWN has insiders.</Note>
        </div>
      )}
    </CompanySection>
  )
}
