import { Card, CardContent } from '@/components/ui/card'

interface Stats {
  current_version: number
  current_accuracy: number | null
  total_feedback: number
  feedback_since_retrain: number
  next_retrain_at: number
  versions: { version: number; trained_at: string; feedback_count: number; accuracy: number | null; mae: number | null }[]
  sentiment: {
    current_version: number
    polarity_accuracy: number | null
    intensity_accuracy: number | null
    total_feedback: number
    feedback_since_retrain: number
    next_retrain_at: number
    versions: { version: number; trained_at: string; feedback_count: number; polarity_accuracy: number | null; intensity_accuracy: number | null }[]
  }
}

async function getStats(): Promise<Stats | null> {
  try {
    const base = process.env.ML_SERVICE_URL ?? 'http://localhost:8421'
    const res = await fetch(`${base}/stats`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

function pct(n: number | null) {
  return n === null ? '—' : `${(n * 100).toFixed(1)}%`
}

interface ProgressBarProps { current: number; total: number; label: string }

function ProgressBar({ current, total, label }: ProgressBarProps) {
  const p = Math.min(100, (current / total) * 100)
  return (
    <div>
      <div className="flex justify-between text-sm mb-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground tabular-nums">{current} / {total}</span>
      </div>
      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${p}%` }} />
      </div>
    </div>
  )
}

export default async function StatsPage() {
  const stats = await getStats()

  if (!stats) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center text-muted-foreground">
        <p>ML service unavailable. Make sure it is running on port 8000.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold mb-1">Model Stats</h1>
      <p className="text-sm text-muted-foreground mb-10">
        Both models improve automatically as users submit feedback (50 corrections trigger a retrain).
      </p>

      {/* ────── Bias Model ────── */}
      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-blue-500 rounded-full inline-block" />
          Bias Model
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Version', value: `v${stats.current_version}` },
            { label: 'Accuracy', value: pct(stats.current_accuracy) },
            { label: 'Feedback', value: String(stats.total_feedback) },
            { label: 'Until retrain', value: stats.next_retrain_at === 0 ? 'Training…' : String(stats.next_retrain_at) },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-xl font-bold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <ProgressBar current={stats.feedback_since_retrain} total={50} label="Progress to next bias retrain" />

        {stats.versions.length > 0 && (
          <div className="mt-5 rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Version', 'Trained', 'Feedback', 'Accuracy', 'MAE'].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...stats.versions].reverse().map(v => (
                  <tr key={v.version} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">v{v.version}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(v.trained_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{v.feedback_count}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(v.accuracy)}</td>
                    <td className="px-4 py-2 tabular-nums">{v.mae !== null ? v.mae.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ────── Sentiment Model ────── */}
      <section>
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-orange-500 rounded-full inline-block" />
          Sentiment Model
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Version', value: `v${stats.sentiment.current_version}` },
            { label: 'Polarity acc.', value: pct(stats.sentiment.polarity_accuracy) },
            { label: 'Intensity acc.', value: pct(stats.sentiment.intensity_accuracy) },
            { label: 'Feedback', value: String(stats.sentiment.total_feedback) },
          ].map(({ label, value }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground mb-1">{label}</p>
                <p className="text-xl font-bold tabular-nums">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <ProgressBar current={stats.sentiment.feedback_since_retrain} total={50} label="Progress to next sentiment retrain" />

        {stats.sentiment.versions.length > 0 && (
          <div className="mt-5 rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  {['Version', 'Trained', 'Feedback', 'Polarity acc.', 'Intensity acc.'].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[...stats.sentiment.versions].reverse().map(v => (
                  <tr key={v.version} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-medium">v{v.version}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(v.trained_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{v.feedback_count}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(v.polarity_accuracy)}</td>
                    <td className="px-4 py-2 tabular-nums">{pct(v.intensity_accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
