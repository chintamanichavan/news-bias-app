'use client'

// Moonlitt's eclipse tracker: upcoming lunar + solar eclipses with type and
// visibility, and a small animated preview of a total lunar eclipse (the
// umbra sweep that makes a blood moon).

import { useMemo } from 'react'
import { upcomingEclipses } from '@/lib/astro'

interface Props { now: string }

function EclipsePreview() {
  // Moon disc slides through the umbra; CSS keyframes live in globals via
  // inline <style> to keep the effect self-contained.
  return (
    <svg viewBox="0 0 120 60" className="w-32 h-16 shrink-0" aria-label="Lunar eclipse preview">
      <style>{`
        @keyframes cl-umbra { 0%,100% { transform: translateX(-34px) } 50% { transform: translateX(34px) } }
        .cl-umbra { animation: cl-umbra 7s ease-in-out infinite }
      `}</style>
      <defs>
        <clipPath id="eclMoon"><circle cx={60} cy={30} r={16} /></clipPath>
        <radialGradient id="eclShadow">
          <stop offset="55%" stopColor="#7f1d1d" />
          <stop offset="100%" stopColor="#450a0a" stopOpacity="0.95" />
        </radialGradient>
      </defs>
      <circle cx={60} cy={30} r={16} className="fill-yellow-100 stroke-stone-400/60" strokeWidth={0.75} />
      <g clipPath="url(#eclMoon)">
        <circle cx={60} cy={30} r={22} fill="url(#eclShadow)" className="cl-umbra" />
      </g>
    </svg>
  )
}

export default function EclipsesCard({ now }: Props) {
  const eclipses = useMemo(() => upcomingEclipses(new Date(now), 6), [now])

  return (
    <div>
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
        Eclipses
      </h2>

      <div className="flex items-start gap-5">
        <EclipsePreview />
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          During a total lunar eclipse the moon crosses Earth&rsquo;s umbra and turns
          red — a <span className="text-foreground font-medium">blood moon</span>. Sunlight
          bent through our atmosphere is what tints it.
        </p>
      </div>

      <div className="mt-4 divide-y divide-border/60">
        {eclipses.map(e => (
          <div key={e.date + e.kind} className="py-2.5 flex items-baseline gap-3">
            <div className="w-20 shrink-0 text-sm font-semibold tabular-nums">
              {new Date(e.date + 'T12:00').toLocaleDateString([], { month: 'short', day: 'numeric', year: '2-digit' })}
            </div>
            <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded
              ${e.kind === 'lunar' ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
              {e.type} {e.kind}
            </span>
            <div className="text-[12px] text-muted-foreground leading-snug">{e.visibility}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground/80">Catalog through 2029 · times are the UTC day of greatest eclipse.</p>
    </div>
  )
}
