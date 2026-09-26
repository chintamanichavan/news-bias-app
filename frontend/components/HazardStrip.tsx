'use client'

// Active NWS alerts + recent M4.5+ quakes from the hazard signal feed, shown
// as a strip under the weather hero. Severity drives the tint.

import { useState } from 'react'
import { useResource } from '@/lib/useResource'

interface Hazard {
  id: string
  kind: 'alert' | 'quake'
  severity: string
  title: string
  area: string
}

interface HazardData {
  risk_index: number
  counts: Record<string, number>
  alerts: Hazard[]
  quakes: Hazard[]
}

const SEV_TINT: Record<string, string> = {
  Extreme: 'bg-red-500/12 text-red-700 dark:text-red-300 border-red-500/30',
  Severe: 'bg-orange-500/12 text-orange-700 dark:text-orange-300 border-orange-500/30',
  Moderate: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/25',
}

export default function HazardStrip() {
  const { data } = useResource<HazardData>('/api/signals/hazards')
  const [open, setOpen] = useState(false)
  if (!data || (data.alerts.length === 0 && data.quakes.length === 0)) return null

  const items = [...data.alerts, ...data.quakes]
  const shown = open ? items : items.slice(0, 3)
  const total = Object.values(data.counts).reduce((a, b) => a + b, 0)

  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <p className="news-section-label">Active hazards</p>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {total} active · risk {(data.risk_index * 100).toFixed(0)}/100
        </span>
      </div>
      <div className="space-y-1.5">
        {shown.map(h => (
          <div key={h.id}
            className={`flex items-baseline gap-2.5 text-[13px] px-3 py-2 rounded-lg border ${SEV_TINT[h.severity] ?? 'bg-muted/40 text-muted-foreground border-border/60'}`}>
            <span className="font-semibold shrink-0">{h.title}</span>
            <span className="min-w-0 truncate opacity-80">{h.area}</span>
          </div>
        ))}
      </div>
      {items.length > 3 && (
        <button onClick={() => setOpen(o => !o)}
          className="mt-1.5 text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2">
          {open ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </section>
  )
}
