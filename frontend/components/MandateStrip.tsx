'use client'

// The two-tier capital mandate — "long term wealthy, short term rich" — with
// each book's live status and the firewall between them. Rendered on both
// money pages so neither tier is ever looked at without its counterpart and
// the rules that keep them separate.

import { useResource } from '@/lib/useResource'

interface Gate { cleared: boolean; reason?: string }
interface MandateStatus {
  workspace_available?: boolean
  watchlist_names?: number
  alpha_gate?: Gate
  paper_equity?: number | null
  paper_cash?: number | null
}
interface Mandate {
  key: 'wealth' | 'rich'
  name: string
  objective: string
  horizon: string
  vehicle: string
  status?: MandateStatus
}
interface MandatesData { tagline: string; mandates: Mandate[]; firewall: string[] }

function statusLine(m: Mandate): string {
  if (m.key === 'wealth') {
    if (!m.status?.workspace_available) return 'workspace offline'
    return `${m.status.watchlist_names ?? 0} businesses under research`
  }
  const gate = m.status?.alpha_gate
  const eq = m.status?.paper_equity
  const gateTxt = gate?.cleared ? 'alpha gate OPEN' : 'alpha gate closed — book holds cash'
  return eq != null ? `${gateTxt} · paper equity $${eq.toLocaleString()}` : gateTxt
}

export default function MandateStrip({ active }: { active: 'wealth' | 'rich' }) {
  const { data } = useResource<MandatesData>('/api/mandates')
  if (!data) return null

  return (
    <section className="mt-6">
      <p className="news-section-label mb-3">Mandates · {data.tagline}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {data.mandates.map(m => (
          <div key={m.key}
            className={`news-card p-4 border ${m.key === active
              ? 'border-[hsl(var(--accent-news))]/50'
              : 'border-border opacity-80'}`}>
            <div className="flex items-baseline justify-between">
              <span className="font-bold">{m.name}</span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {m.key === active ? 'this page' : m.key === 'wealth' ? 'portfolio' : 'strategy'}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground leading-snug">{m.objective}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
              <span className="uppercase tracking-wider text-[9.5px] mr-1.5">{m.horizon}</span>
              {statusLine(m)}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground leading-relaxed">
        <span className="uppercase tracking-wider text-[9.5px] font-semibold mr-1.5">Firewall</span>
        {data.firewall.join(' ')}
      </p>
    </section>
  )
}
