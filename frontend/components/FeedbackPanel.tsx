'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import BiasGauge from '@/components/BiasGauge'
import SpectrumGauge from '@/components/SpectrumGauge'

type Dimension = 'bias' | 'sentiment' | 'intensity'

interface FeedbackPanelProps {
  articleId: string
  bias: { score: number; confidence: number }
  sentiment: { polarity: number; intensity: number }
}

interface PerDimState {
  state: 'idle' | 'disagreed' | 'submitted'
  userValue: number
}

const POLARITY_GRADIENT =
  'linear-gradient(to right, #475569 0%, #94a3b8 35%, #cbd5e1 50%, #86efac 65%, #16a34a 100%)'
const INTENSITY_GRADIENT =
  'linear-gradient(to right, #3b82f6 0%, #93c5fd 35%, #fde047 65%, #f97316 85%, #dc2626 100%)'

const DIMENSION_LABEL: Record<Dimension, string> = {
  bias: 'Bias',
  sentiment: 'Tone',
  intensity: 'Intensity',
}

export default function FeedbackPanel({ articleId, bias, sentiment }: FeedbackPanelProps) {
  const [active, setActive] = useState<Dimension>('bias')
  const [loading, setLoading] = useState(false)
  const [perDim, setPerDim] = useState<Record<Dimension, PerDimState>>({
    bias:      { state: 'idle', userValue: bias.score },
    sentiment: { state: 'idle', userValue: sentiment.polarity },
    intensity: { state: 'idle', userValue: sentiment.intensity },
  })

  const current = perDim[active]
  const predicted = active === 'bias' ? bias.score
                  : active === 'sentiment' ? sentiment.polarity
                  : sentiment.intensity

  function patch(dim: Dimension, p: Partial<PerDimState>) {
    setPerDim(prev => ({ ...prev, [dim]: { ...prev[dim], ...p } }))
  }

  async function submit(type: 'thumbs_up' | 'thumbs_down' | 'slider', value: number) {
    setLoading(true)
    // For thumbs_up the user agrees → user_score = predicted
    const userScore = type === 'thumbs_up' ? predicted : value

    // FastAPI bias gauge accepts -5..+5; sentiment/intensity are -1..+1 / 0..+1.
    // Backend Field validates with ge=-5/le=5, so values in [-1,1] pass without scaling.
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          article_id: articleId,
          predicted_score: predicted,
          user_score: userScore,
          feedback_type: type,
          dimension: active,
        }),
      })
      if (!res.ok) throw new Error('Server error')
      const data = await res.json()
      patch(active, { state: 'submitted' })
      toast.success(
        data.retrain_triggered
          ? `${DIMENSION_LABEL[active]} model is retraining…`
          : `${DIMENSION_LABEL[active]} feedback saved (${data.feedback_count_since_retrain}/50 to next retrain)`
      )
    } catch {
      toast.error('Failed to submit feedback')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border -mx-5 px-5 pb-3">
        {(['bias', 'sentiment', 'intensity'] as Dimension[]).map(d => {
          const isActive = active === d
          const submitted = perDim[d].state === 'submitted'
          return (
            <button
              key={d}
              onClick={() => setActive(d)}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1.5
                ${isActive ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}
            >
              {DIMENSION_LABEL[d]}
              {submitted && <span className="text-[10px]">✓</span>}
            </button>
          )
        })}
      </div>

      {/* Submitted state */}
      {current.state === 'submitted' ? (
        <div className="text-center py-3">
          <p className="text-sm font-medium">Thanks — your {DIMENSION_LABEL[active].toLowerCase()} feedback was saved.</p>
          <button
            className="text-xs text-muted-foreground hover:text-foreground mt-1"
            onClick={() => patch(active, { state: 'idle' })}
          >
            Adjust again
          </button>
        </div>
      ) : (
        <>
          {/* Prediction display */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Our {DIMENSION_LABEL[active].toLowerCase()} estimate:
            </p>
            {active === 'bias' && (
              <BiasGauge score={bias.score} confidence={bias.confidence} size="md" />
            )}
            {active === 'sentiment' && (
              <SpectrumGauge
                value={sentiment.polarity}
                min={-1}
                max={1}
                gradient={POLARITY_GRADIENT}
                leftLabel="Negative"
                centerLabel="Neutral"
                rightLabel="Positive"
                size="md"
              />
            )}
            {active === 'intensity' && (
              <SpectrumGauge
                value={sentiment.intensity}
                min={0}
                max={1}
                gradient={INTENSITY_GRADIENT}
                leftLabel="Calm"
                centerLabel="Moderate"
                rightLabel="Charged"
                size="md"
              />
            )}
          </div>

          {/* Idle: thumbs */}
          {current.state === 'idle' && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={loading}
                onClick={() => submit('thumbs_up', predicted)}>
                Looks right
              </Button>
              <Button size="sm" variant="outline" disabled={loading}
                onClick={() => patch(active, { state: 'disagreed', userValue: predicted })}>
                Adjust it
              </Button>
            </div>
          )}

          {/* Disagreed: slider */}
          {current.state === 'disagreed' && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Drag to where it should be:</p>
              {active === 'bias' && (
                <BiasGauge
                  score={current.userValue}
                  confidence={1}
                  size="lg"
                  interactive
                  onChange={v => patch(active, { userValue: v })}
                />
              )}
              {active === 'sentiment' && (
                <SpectrumGauge
                  value={current.userValue}
                  min={-1}
                  max={1}
                  gradient={POLARITY_GRADIENT}
                  leftLabel="Negative"
                  centerLabel="Neutral"
                  rightLabel="Positive"
                  size="lg"
                  interactive
                  onChange={v => patch(active, { userValue: v })}
                />
              )}
              {active === 'intensity' && (
                <SpectrumGauge
                  value={current.userValue}
                  min={0}
                  max={1}
                  gradient={INTENSITY_GRADIENT}
                  leftLabel="Calm"
                  centerLabel="Moderate"
                  rightLabel="Charged"
                  size="lg"
                  interactive
                  onChange={v => patch(active, { userValue: v })}
                />
              )}
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={loading}
                  onClick={() => submit('slider', current.userValue)}>
                  Submit
                </Button>
                <Button size="sm" variant="ghost" disabled={loading}
                  onClick={() => patch(active, { state: 'idle' })}>
                  Cancel
                </Button>
                <span className="ml-auto text-xs tabular-nums font-mono">
                  {current.userValue > 0 && active !== 'intensity' ? '+' : ''}
                  {current.userValue.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
