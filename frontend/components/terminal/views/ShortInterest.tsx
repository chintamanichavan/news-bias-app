import { Kv, Note } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { big, day, pct, tone } from '@/lib/terminal/numbers'

export default function ShortInterest({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="short_interest"
      missing="No short interest is published for this security. It is reported for US listings only.">
      {s => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">
            <b>{big(s.shares_short)}</b> shares sold short, <b>{pct(s.pct_of_float, false)}</b> of the float,{' '}
            <span className={tone(-(s.change_pct ?? 0))}>{pct(s.change_pct)} since {day(s.prior_as_of)}</span>.
          </p>
          <Kv data={{ days_to_cover: s.days_to_cover, pct_of_shares_pct: s.pct_of_shares, float: s.float, prior_month: s.prior_month }} />
          <Note>
            As of {day(s.as_of)}; exchanges publish short interest twice a month, about two weeks late. Days to cover is
            short shares divided by average daily volume.
          </Note>
        </div>
      )}
    </CompanySection>
  )
}
