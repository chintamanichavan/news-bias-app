import { Note, Table } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { big, pct, tone } from '@/lib/terminal/numbers'

const eps = (v: number | null) => (v == null ? '—' : v.toFixed(2))

export default function Estimates({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="estimates" missing="No analyst estimates are published for this security.">
      {rows => (
        <div className="space-y-2">
          <Table
            rows={rows}
            rowKey={r => r.period}
            columns={[
              { head: 'Period', align: 'left', cell: r => <span><b>{r.period}</b> <span className="text-muted-foreground">to {r.end}</span></span> },
              { head: 'EPS est.', cell: r => <b>{eps(r.eps_avg)}</b> },
              { head: 'Low–high', cell: r => `${eps(r.eps_low)}–${eps(r.eps_high)}` },
              { head: 'Year ago', cell: r => eps(r.eps_year_ago) },
              { head: 'EPS growth', cell: r => pct(r.eps_growth_pct), className: r => tone(r.eps_growth_pct) },
              { head: 'Revenue est.', cell: r => big(r.revenue_avg) },
              { head: 'Rev. growth', cell: r => pct(r.revenue_growth_pct), className: r => tone(r.revenue_growth_pct) },
              { head: '90 days ago', cell: r => eps(r.eps_90_days_ago) },
              { head: 'Revisions 30d', cell: r => `${r.revisions_up_30d ?? 0}↑ ${r.revisions_down_30d ?? 0}↓` },
              { head: 'Analysts', cell: r => r.analysts ?? '—' },
            ]}
          />
          <Note>Consensus of the analysts Yahoo collects. &ldquo;90 days ago&rdquo; shows where the estimate was, so you can see it drift.</Note>
        </div>
      )}
    </CompanySection>
  )
}
