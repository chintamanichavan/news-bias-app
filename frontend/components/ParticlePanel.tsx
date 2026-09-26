'use client'

// Particle-style story tools: bullet key points, heuristic 5Ws, and
// "ask a question" — extractive answers quoted verbatim from the story
// group's own articles, with the outlet named. No LLM anywhere: the app's
// premise is classical ML, and these panels say what they are.

import { useEffect, useState } from 'react'

interface ParticleData {
  key_points: string[]
  five_ws: { who: string | null; what: string | null; when: string | null; where: string | null; why: string | null }
  topics: string[]
  symbols: string[]
}

interface Answer {
  source: string
  sentence: string
  score: number
}

type Style = 'bullets' | '5ws'

export default function ParticlePanel({ articleId }: { articleId: string }) {
  const [data, setData] = useState<ParticleData | null>(null)
  const [style, setStyle] = useState<Style>('bullets')
  const [question, setQuestion] = useState('')
  const [answers, setAnswers] = useState<Answer[] | null>(null)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/articles/${articleId}/particle`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [articleId])

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    if (question.trim().length < 3 || asking) return
    setAsking(true)
    setAskError(null)
    try {
      const res = await fetch(`/api/articles/${articleId}/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim() }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d = await res.json()
      setAnswers(d.answers ?? [])
    } catch {
      setAskError('Could not search the story right now.')
    } finally {
      setAsking(false)
    }
  }

  if (!data || (!data.key_points.length && !data.topics.length)) return null

  const ws = data.five_ws
  const wRows: [string, string | null][] = [
    ['Who', ws.who], ['What', ws.what], ['When', ws.when], ['Where', ws.where], ['Why', ws.why],
  ]

  return (
    <section className="news-card p-6 sm:p-7 mb-8">
      <div className="flex items-center justify-between mb-4">
        <p className="news-section-label">The story in brief</p>
        <div className="flex gap-1">
          {(['bullets', '5ws'] as Style[]).map(s => (
            <button key={s} onClick={() => setStyle(s)}
              className={`text-[11px] px-2.5 py-0.5 rounded-full transition-colors ${
                style === s ? 'bg-foreground text-background font-medium' : 'text-muted-foreground hover:bg-muted'
              }`}>
              {s === 'bullets' ? 'Key points' : 'The 5 Ws'}
            </button>
          ))}
        </div>
      </div>

      {style === 'bullets' ? (
        <ul className="space-y-2.5">
          {data.key_points.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-foreground/90">
              <span className="text-muted-foreground mt-0.5 shrink-0">›</span>
              {p}
            </li>
          ))}
        </ul>
      ) : (
        <dl className="space-y-2.5">
          {wRows.map(([label, val]) => (
            <div key={label} className="flex gap-3 text-[14px] leading-relaxed">
              <dt className="w-14 shrink-0 text-[11px] uppercase tracking-wider text-muted-foreground pt-0.5">{label}</dt>
              <dd className="text-foreground/90">{val ?? <span className="text-muted-foreground/60">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}

      {(data.topics.length > 0 || data.symbols.length > 0) && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {data.topics.map(t => (
            <span key={t} className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{t}</span>
          ))}
          {data.symbols.map(s => (
            <span key={s} className="text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 tabular-nums">{s}</span>
          ))}
        </div>
      )}

      {/* Ask */}
      <form onSubmit={ask} className="mt-5 pt-4 border-t border-border/60">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="Ask this story a question…"
            maxLength={300}
            className="flex-1 text-[14px] bg-transparent border border-border rounded-full px-4 py-2 outline-none focus:border-foreground/40 placeholder:text-muted-foreground/70"
          />
          <button
            type="submit"
            disabled={asking || question.trim().length < 3}
            className="text-[13px] font-medium px-4 py-2 rounded-full bg-foreground text-background disabled:opacity-40 hover:opacity-85"
          >
            {asking ? '…' : 'Ask'}
          </button>
        </div>
        {askError && <p className="mt-2 text-[12px] text-red-500">{askError}</p>}
        {answers && (
          <div className="mt-3 space-y-2.5">
            {answers.length === 0 && (
              <p className="text-[13px] text-muted-foreground">Nothing in this story&rsquo;s coverage answers that directly.</p>
            )}
            {answers.map((a, i) => (
              <blockquote key={i} className="text-[14px] leading-relaxed border-l-2 border-border pl-3">
                &ldquo;{a.sentence}&rdquo;
                <span className="block mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">— {a.source}</span>
              </blockquote>
            ))}
            <p className="text-[11px] text-muted-foreground/80">
              Sentences retrieved verbatim from this story&rsquo;s coverage — nothing is generated. Questions stay on your device&rsquo;s connection to your own server.
            </p>
          </div>
        )}
      </form>
    </section>
  )
}
