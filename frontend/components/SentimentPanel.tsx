'use client'

import SpectrumGauge from '@/components/SpectrumGauge'

interface SentimentPanelProps {
  polarity: number    // -1..+1
  intensity: number   //  0..+1
  emotionBreakdown?: Record<string, number> | null
  showLabels?: boolean
}

const POLARITY_GRADIENT =
  'linear-gradient(to right, #475569 0%, #94a3b8 35%, #cbd5e1 50%, #86efac 65%, #16a34a 100%)'
const INTENSITY_GRADIENT =
  'linear-gradient(to right, #3b82f6 0%, #93c5fd 35%, #fde047 65%, #f97316 85%, #dc2626 100%)'

const EMOTION_COLORS: Record<string, string> = {
  anger:        '#dc2626',
  fear:         '#7c3aed',
  joy:          '#facc15',
  sadness:      '#3b82f6',
  disgust:      '#65a30d',
  trust:        '#0ea5e9',
  anticipation: '#f97316',
  surprise:     '#ec4899',
}

const EMOTION_ORDER = ['anger', 'fear', 'joy', 'sadness', 'disgust', 'trust', 'anticipation', 'surprise']

function polarityColor(p: number) {
  if (p >= 0.3) return '#16a34a'
  if (p <= -0.3) return '#475569'
  return '#9ca3af'
}

function intensityColor(i: number) {
  if (i >= 0.66) return '#dc2626'
  if (i >= 0.4) return '#f97316'
  if (i >= 0.2) return '#fde047'
  return '#3b82f6'
}

export default function SentimentPanel({
  polarity,
  intensity,
  emotionBreakdown,
  showLabels = true,
}: SentimentPanelProps) {
  return (
    <div className="space-y-5">
      {/* Polarity */}
      <div>
        {showLabels && (
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Tone</span>
            <span className="text-xs tabular-nums font-mono">
              {polarity > 0 ? '+' : ''}{polarity.toFixed(2)}
            </span>
          </div>
        )}
        <SpectrumGauge
          value={polarity}
          min={-1}
          max={1}
          gradient={POLARITY_GRADIENT}
          needleColor={polarityColor}
          leftLabel="Negative"
          centerLabel="Neutral"
          rightLabel="Positive"
          size="md"
        />
      </div>

      {/* Intensity */}
      <div>
        {showLabels && (
          <div className="flex justify-between items-baseline mb-1.5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Intensity</span>
            <span className="text-xs tabular-nums font-mono">{intensity.toFixed(2)}</span>
          </div>
        )}
        <SpectrumGauge
          value={intensity}
          min={0}
          max={1}
          gradient={INTENSITY_GRADIENT}
          needleColor={intensityColor}
          leftLabel="Calm"
          centerLabel="Moderate"
          rightLabel="Charged"
          size="md"
        />
      </div>

      {/* Emotion breakdown */}
      {emotionBreakdown && (
        <div>
          {showLabels && (
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
              Emotion fingerprint
            </p>
          )}
          <div className="space-y-1.5">
            {EMOTION_ORDER.map(emotion => {
              const value = emotionBreakdown[emotion] ?? 0
              const pct = Math.round(value * 100)
              return (
                <div key={emotion} className="flex items-center gap-2">
                  <span className="w-20 text-xs capitalize text-muted-foreground">{emotion}</span>
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: EMOTION_COLORS[emotion] ?? '#9ca3af',
                      }}
                    />
                  </div>
                  <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">
                    {pct}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
