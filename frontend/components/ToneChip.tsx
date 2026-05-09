interface ToneChipProps {
  polarity: number | null    // -1..+1
  intensity: number | null   //  0..+1
  size?: 'sm' | 'md'
}

interface ChipMeta {
  icon: string
  label: string
  bg: string
  fg: string
}

function classify(polarity: number, intensity: number): ChipMeta {
  // Intensity overrides polarity when high — rage-bait reads as intensity, not polarity
  if (intensity >= 0.66) {
    return { icon: '🔥', label: 'Inflammatory', bg: 'bg-red-100 dark:bg-red-950/40', fg: 'text-red-700 dark:text-red-300' }
  }
  if (intensity >= 0.4) {
    return { icon: '⚡', label: 'Charged', bg: 'bg-orange-100 dark:bg-orange-950/40', fg: 'text-orange-700 dark:text-orange-300' }
  }
  if (polarity >= 0.3) {
    return { icon: '✨', label: 'Positive', bg: 'bg-green-100 dark:bg-green-950/40', fg: 'text-green-700 dark:text-green-300' }
  }
  if (polarity <= -0.3) {
    return { icon: '😟', label: 'Negative', bg: 'bg-slate-200 dark:bg-slate-800', fg: 'text-slate-700 dark:text-slate-300' }
  }
  return { icon: '💼', label: 'Neutral', bg: 'bg-gray-100 dark:bg-gray-800', fg: 'text-gray-600 dark:text-gray-400' }
}

export default function ToneChip({ polarity, intensity, size = 'sm' }: ToneChipProps) {
  if (polarity === null || intensity === null) return null

  const meta = classify(polarity, intensity)
  const padding = size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs'

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md font-medium ${padding} ${meta.bg} ${meta.fg}`}
      title={`Polarity ${polarity.toFixed(2)} · Intensity ${intensity.toFixed(2)}`}
    >
      <span className="text-[1em] leading-none">{meta.icon}</span>
      {meta.label}
    </span>
  )
}
