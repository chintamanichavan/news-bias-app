import { Kv, Note, Table } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { big, day } from '@/lib/terminal/numbers'

export default function Ownership({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="ownership" missing="No ownership details are published for this security.">
      {o => (
        <div className="space-y-4">
          <Kv data={{ ...o.split, ...(o.insider_six_months ? {
            insider_buys_6m: o.insider_six_months.buys, insider_sells_6m: o.insider_six_months.sells,
            insider_net_shares_6m: o.insider_six_months.net_shares,
          } : {}) }} />
          {o.trades.length > 0 && (
            <div>
              <p className="news-section-label mb-1">Recent insider trades</p>
              <Table
                rows={o.trades}
                rowKey={(t, i) => `${t.date}-${t.name}-${i}`}
                columns={[
                  { head: 'Date', align: 'left', cell: t => day(t.date) },
                  { head: 'Insider', align: 'left', cell: t => <span>{t.name} <span className="text-muted-foreground">{t.role}</span></span> },
                  { head: 'What', align: 'left', cell: t => t.text ?? '—' },
                  { head: 'Shares', cell: t => big(t.shares) },
                  { head: 'Value', cell: t => big(t.value) },
                ]}
              />
            </div>
          )}
          <Note>Insider trades come from Form 4 filings; CF lists the filings themselves.</Note>
        </div>
      )}
    </CompanySection>
  )
}
