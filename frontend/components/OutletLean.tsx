'use client'

import SpectrumGauge from '@/components/SpectrumGauge'
import { cn } from '@/lib/utils'

interface OutletLeanProps {
  /** The outlet's AllSides rating on the -2..+2 scale sources.json uses. */
  score: number
  /** Its AllSides label — left / lean_left / center / lean_right / right. */
  label: string
  /** Outlet name, for the caption. */
  outlet?: string
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  onChange?: (score: number) => void
  className?: string
}

/**
 * Where a *publisher* sits on the political spectrum, per AllSides.
 *
 * This was BiasGauge, fed a per-article `bias_score` and a "78% confidence"
 * readout. Both were fiction: the model's dominant feature was this very
 * rating, so the number it produced was the outlet's rating plus rounding
 * error, and the confidence was its certainty about a lookup it could not get
 * wrong. The rating is worth showing — it just has to be labelled as what it
 * is, so nothing here mentions confidence or "this article".
 */
const LEAN_GRADIENT =
  'linear-gradient(to right, #1a56db 0%, #76a9fa 25%, #9ca3af 50%, #f87171 75%, #dc2626 100%)'

const LABELS: Record<string, string> = {
  left: 'Left',
  lean_left: 'Lean left',
  center: 'Center',
  lean_right: 'Lean right',
  right: 'Right',
}

function leanColor(score: number) {
  if (score <= -1.4) return '#1a56db'
  if (score <= -0.4) return '#76a9fa'
  if (score <= 0.4) return '#9ca3af'
  if (score <= 1.4) return '#f87171'
  return '#dc2626'
}

export default function OutletLean({
  score,
  label,
  outlet,
  size = 'md',
  interactive = false,
  onChange,
  className,
}: OutletLeanProps) {
  const text = LABELS[label] ?? label.replace(/_/g, ' ')
  const color = leanColor(score)

  return (
    <div className={cn('w-full', className)}>
      <SpectrumGauge
        value={score}
        min={-2}
        max={2}
        gradient={LEAN_GRADIENT}
        needleColor={leanColor}
        leftLabel="Left"
        centerLabel="Center"
        rightLabel="Right"
        size={size}
        interactive={interactive}
        onChange={onChange}
      />

      {size !== 'sm' && (
        <div className="flex items-center gap-2 mt-1 text-xs">
          <span className="font-semibold" style={{ color }}>{text}</span>
          <span className="text-muted-foreground">
            {outlet ? `AllSides rating for ${outlet}` : 'AllSides publisher rating'}
          </span>
          {interactive && (
            <span className="ml-auto tabular-nums font-mono">
              {score > 0 ? '+' : ''}{score.toFixed(1)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
