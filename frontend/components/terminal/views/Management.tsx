import { Note, Table } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { big } from '@/lib/terminal/numbers'

const RISK: Record<string, string> = {
  auditRisk: 'Audit', boardRisk: 'Board', compensationRisk: 'Pay', shareHolderRightsRisk: 'Shareholder rights', overallRisk: 'Overall',
}

export default function Management({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="management" missing="No management details are published for this security.">
      {m => (
        <div className="space-y-3">
          <Table
            rows={m.officers}
            rowKey={o => o.name}
            columns={[
              { head: 'Name', align: 'left', cell: o => <b>{o.name}</b> },
              { head: 'Title', align: 'left', cell: o => o.title },
              { head: 'Age', cell: o => o.age ?? '—' },
              { head: 'Pay', cell: o => (o.pay ? `${big(o.pay)}${o.pay_year ? ` (${o.pay_year})` : ''}` : '—') },
            ]}
          />
          {Object.keys(m.governance).length > 0 && (
            <p className="text-[12px] tabular-nums">
              Governance risk, 1 low to 10 high:{' '}
              {Object.entries(m.governance).map(([k, v]) => `${RISK[k] ?? k} ${v}`).join(' · ')}
            </p>
          )}
          <Note>
            {m.employees ? `${m.employees.toLocaleString()} full-time employees. ` : ''}Pay is as last reported in the proxy statement.
          </Note>
        </div>
      )}
    </CompanySection>
  )
}
