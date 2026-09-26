'use client'

// Moonlitt's lunar traditions: Chinese moon festivals, the year of full-moon
// names, the next blue moon, and where the moon sits — tropical sign vs the
// actual constellation.

import { useMemo } from 'react'
import { chineseFestivals, nextBlueMoon, lunarPhase, moonConstellation, fullMoonName } from '@/lib/astro'

interface Props { now: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function TraditionsCard({ now }: Props) {
  const nowDate = useMemo(() => new Date(now), [now])
  const festivals = useMemo(() => chineseFestivals(nowDate, 4), [nowDate])
  const blue = useMemo(() => nextBlueMoon(nowDate), [nowDate])
  const phase = useMemo(() => lunarPhase(nowDate), [nowDate])
  const constellation = useMemo(() => moonConstellation(nowDate), [nowDate])

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Lunar Traditions
      </h2>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Chinese moon festivals</p>
          <div className="space-y-1.5">
            {festivals.length ? festivals.map(f => (
              <div key={f.name} className="flex items-baseline justify-between gap-3 text-sm">
                <span>{f.name}</span>
                <span className="text-muted-foreground tabular-nums text-[12px]">
                  {f.date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
            )) : <p className="text-[12px] text-muted-foreground">Chinese calendar unavailable in this browser.</p>}
          </div>

          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-5 mb-2">Where the moon is</p>
          <div className="text-sm">
            <span className="font-semibold">{phase.zodiac}</span>
            <span className="text-muted-foreground"> (tropical sign)</span>
          </div>
          <div className="text-sm">
            <span className="font-semibold">{constellation}</span>
            <span className="text-muted-foreground"> (constellation)</span>
          </div>
          {blue && (
            <>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-5 mb-1">Next blue moon</p>
              <div className="text-sm font-semibold tabular-nums">
                {blue.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' })}
                <span className="text-muted-foreground font-normal text-[12px]"> — second full moon that month</span>
              </div>
            </>
          )}
        </div>

        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Full moon names</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {MONTHS.map((m, i) => {
              const isThisMonth = i === nowDate.getMonth()
              return (
                <div key={m} className={`flex items-baseline justify-between text-[12px] ${isThisMonth ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
                  <span>{m}</span>
                  <span>{fullMoonName(new Date(2026, i, 15))}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
