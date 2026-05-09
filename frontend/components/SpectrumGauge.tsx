'use client'

import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface SpectrumGaugeProps {
  value: number
  min: number
  max: number
  gradient: string                            // CSS gradient for the track background
  needleColor?: (value: number) => string     // optional dynamic needle color
  confidence?: number                         // 0..1 — controls needle opacity
  leftLabel?: string
  centerLabel?: string
  rightLabel?: string
  size?: 'sm' | 'md' | 'lg'
  interactive?: boolean
  onChange?: (value: number) => void
  className?: string
}

const HEIGHTS = { sm: 'h-2', md: 'h-3', lg: 'h-4' } as const
const NEEDLE_SIZES = { sm: 'w-3 h-3', md: 'w-4 h-4', lg: 'w-5 h-5' } as const

export default function SpectrumGauge({
  value,
  min,
  max,
  gradient,
  needleColor,
  confidence = 1,
  leftLabel,
  centerLabel,
  rightLabel,
  size = 'md',
  interactive = false,
  onChange,
  className,
}: SpectrumGaugeProps) {
  const [local, setLocal] = useState(value)
  const trackRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocal(value) }, [value])

  const range = max - min
  const pct = ((local - min) / range) * 100
  const color = needleColor?.(local) ?? 'currentColor'

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = parseFloat(e.target.value)
    setLocal(v)
    onChange?.(v)
  }

  return (
    <div className={cn('w-full select-none', className)}>
      <div className="relative" ref={trackRef}>
        {interactive && (
          <input
            type="range"
            min={min}
            max={max}
            step={(max - min) / 100}
            value={local}
            onChange={handleInputChange}
            className="w-full cursor-pointer opacity-0 absolute inset-0 z-10"
            style={{ height: '100%' }}
          />
        )}
        <div
          className={cn('w-full rounded-full', HEIGHTS[size])}
          style={{ background: gradient }}
        />
        <div
          className={cn(
            'absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border-2 border-white shadow-md transition-all',
            NEEDLE_SIZES[size],
            interactive && 'cursor-grab',
          )}
          style={{
            left: `${Math.max(0, Math.min(100, pct))}%`,
            backgroundColor: color,
            opacity: 0.4 + confidence * 0.6,
          }}
        />
      </div>

      {(leftLabel || centerLabel || rightLabel) && size !== 'sm' && (
        <div className="flex justify-between mt-1 text-[10px] text-muted-foreground">
          <span>{leftLabel}</span>
          {centerLabel && <span>{centerLabel}</span>}
          <span>{rightLabel}</span>
        </div>
      )}
    </div>
  )
}
