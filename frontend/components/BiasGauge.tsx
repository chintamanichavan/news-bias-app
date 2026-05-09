'use client'

import SpectrumGauge from '@/components/SpectrumGauge'
import { cn } from '@/lib/utils'

interface BiasGaugeProps {
  score: number
  confidence: number
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  onChange?: (score: number) => void
  className?: string
}

const BIAS_GRADIENT =
  'linear-gradient(to right, #1a56db 0%, #76a9fa 25%, #9ca3af 50%, #f87171 75%, #dc2626 100%)'

function biasLabel(score: number) {
  if (score <= -3.5) return 'Far Left'
  if (score <= -1) return 'Left'
  if (score <= 1) return 'Center'
  if (score <= 3.5) return 'Right'
  return 'Far Right'
}

function biasColor(score: number) {
  if (score <= -3.5) return '#1a56db'
  if (score <= -1) return '#76a9fa'
  if (score <= 1) return '#9ca3af'
  if (score <= 3.5) return '#f87171'
  return '#dc2626'
}

export default function BiasGauge({
  score,
  confidence,
  size = 'md',
  interactive = false,
  onChange,
  className,
}: BiasGaugeProps) {
  const label = biasLabel(score)
  const color = biasColor(score)

  return (
    <div className={cn('w-full', className)}>
      <SpectrumGauge
        value={score}
        min={-5}
        max={5}
        gradient={BIAS_GRADIENT}
        needleColor={biasColor}
        confidence={confidence}
        leftLabel="Left"
        centerLabel="Center"
        rightLabel="Right"
        size={size}
        interactive={interactive}
        onChange={onChange}
      />

      {size !== 'sm' && (
        <div className="flex items-center gap-2 mt-1 text-xs">
          <span className="font-semibold" style={{ color }}>{label}</span>
          <span className="text-muted-foreground">
            {Math.round(confidence * 100)}% confidence
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
