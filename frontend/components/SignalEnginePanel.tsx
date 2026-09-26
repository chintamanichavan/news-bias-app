'use client'

// The signal engine's read, on the Markets page: composite sentiment for the
// two verticals and every security carrying signal this cycle, with the
// channel breakdown (news / social / prediction markets / vol regime), the
// social tape, and active weather-risk. Methodology follows the classics —
// Loughran-McDonald finance lexicon, VADER-style social scoring, Antweiler-
// Frank disagreement damping, Baker-Wurgler composite construction.

import { useResource } from '@/lib/useResource'

interface Entity {
  entity: string
  name: string
  asset_class?: string | null
  composite: number
  components: Record<string, number | null>
  inputs: { news_articles: number; social_posts: number }
}

interface Composite { as_of: string | null; entities: Entity[] }

interface SocialData {
  verticals: Record<string, { posts: number; sentiment: number; intensity: number; volume_change: number | null; disagreement: number }>
  symbols: { symbol: string; posts: number; sentiment: number; top_post: { title: string; url: string; platform: string; channel: string } | null }[]
}

interface HazardData {
  risk_index: number
  counts: Record<string, number>
  alerts: { id: string; severity: string; title: string; area: string }[]
}

const CHANNEL_LABEL: Record<string, string> = {
  news: 'News', social: 'Social', prediction: 'Prediction mkts', vol: 'Vol regime', hazards: 'Weather risk',
}

function tone(v: number): string {
  if (v > 0.15) return 'text-emerald-600 dark:text-emerald-400'
  if (v < -0.15) return 'text-red-600 dark:text-red-400'
  return 'text-muted-foreground'
}

function Meter({ value }: { value: number }) {
  const pct = ((value + 1) / 2) * 100
  return (
    <div className="relative h-1.5 rounded-full bg-gradient-to-r from-red-500/50 via-muted to-emerald-500/50 w-full">
      <div className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-foreground shadow"
        style={{ left: `calc(${pct}% - 5px)` }} />
    </div>
  )
}

interface HistoryPoint { taken_at: string; composite: number }

/** Composite time series for one entity — the strategy-research view. */
function Spark({ entity }: { entity: string }) {
  const { data } = useResource<{ history: HistoryPoint[] }>(`/api/signals/composite?entity=${entity}&history_hours=168`)
  const pts = data?.history ?? []
  if (pts.length < 2) return null
  const W = 220, H = 36
  const path = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * W
    const y = H / 2 - p.composite * (H / 2 - 2)
    return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-9 mt-1.5" aria-label={`${entity} composite history`}>
      <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="stroke-border" strokeWidth={0.75} strokeDasharray="2 3" />
      <path d={path} fill="none" className={pts[pts.length - 1].composite >= 0 ? 'stroke-emerald-500' : 'stroke-red-500'} strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  )
}

export default function SignalEnginePanel() {
  const { data: comp } = useResource<Composite>('/api/signals/composite')
  const { data: social } = useResource<SocialData>('/api/signals/social')
  const { data: hazard } = useResource<HazardData>('/api/signals/hazards')

  const entities = comp?.entities ?? []
  const verticals = entities.filter(e => e.entity === 'markets' || e.entity === 'weather')
  const securities = entities.filter(e => e.entity !== 'markets' && e.entity !== 'weather').slice(0, 10)

  if (!entities.length && !social && !hazard) return null

  return (
    <section id="signals" className="scroll-mt-20">
      <div className="flex items-baseline justify-between mb-3 px-1">
        <h2 className="news-section-label">Signal Engine</h2>
        {comp?.as_of && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            cycle {new Date(comp.as_of).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Vertical composites with channel breakdown */}
        <div className="news-card p-5 space-y-5">
          {verticals.length === 0 && (
            <p className="text-sm text-muted-foreground">First engine cycle is still running — check back in a minute.</p>
          )}
          {verticals.map(v => (
            <div key={v.entity}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm font-semibold">{v.name} composite</span>
                <span className={`text-lg font-bold tabular-nums ${tone(v.composite)}`}>
                  {v.composite > 0 ? '+' : ''}{v.composite.toFixed(2)}
                </span>
              </div>
              <Meter value={v.composite} />
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {Object.entries(v.components).map(([k, val]) => (
                  <span key={k} className="text-[11px] text-muted-foreground tabular-nums">
                    {CHANNEL_LABEL[k] ?? k}:{' '}
                    <span className={val == null ? '' : tone(val)}>{val == null ? '—' : (val > 0 ? '+' : '') + val.toFixed(2)}</span>
                  </span>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/80 tabular-nums">
                {v.inputs.news_articles} articles · {v.inputs.social_posts} social posts this window
              </p>
              <Spark entity={v.entity} />
            </div>
          ))}

          {hazard && (
            <div className="pt-3 border-t border-border/60">
              <div className="flex items-baseline justify-between">
                <span className="text-[12px] font-medium">Weather risk index</span>
                <span className="text-sm font-bold tabular-nums">{(hazard.risk_index * 100).toFixed(0)}/100</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {Object.entries(hazard.counts).map(([sev, n]) => `${n} ${sev.toLowerCase()}`).join(' · ') || 'no active alerts'}
              </p>
            </div>
          )}
        </div>

        {/* Per-security signal + social tape */}
        <div className="news-card p-5">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-3">Securities carrying signal</p>
          {securities.length === 0 && <p className="text-sm text-muted-foreground">No per-security signal yet this cycle.</p>}
          <div className="space-y-2">
            {securities.map(s => (
              <div key={s.entity} className="flex items-center gap-3">
                <span className="w-16 shrink-0 text-[12px] font-semibold tabular-nums">{s.entity}</span>
                <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">{s.name}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {s.inputs.news_articles}n·{s.inputs.social_posts}s
                </span>
                <span className={`w-12 text-right text-[12px] font-bold tabular-nums shrink-0 ${tone(s.composite)}`}>
                  {s.composite > 0 ? '+' : ''}{s.composite.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {social && (
            <div className="mt-4 pt-3 border-t border-border/60">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">Social tape (24h)</p>
              {Object.entries(social.verticals).map(([name, v]) => (
                <p key={name} className="text-[11px] text-muted-foreground tabular-nums">
                  {name}: {v.posts} posts · mood <span className={tone(v.sentiment)}>{v.sentiment > 0 ? '+' : ''}{v.sentiment.toFixed(2)}</span>
                  {' '}· disagreement {v.disagreement.toFixed(2)}
                  {v.volume_change != null && <> · volume {v.volume_change > 0 ? '+' : ''}{Math.round(v.volume_change * 100)}%</>}
                </p>
              ))}
              {social.symbols[0]?.top_post && (
                <a href={social.symbols[0].top_post.url} target="_blank" rel="noopener noreferrer"
                  className="block mt-2 text-[12px] text-foreground/85 hover:opacity-70 leading-snug">
                  🔥 &ldquo;{social.symbols[0].top_post.title.slice(0, 90)}{social.symbols[0].top_post.title.length > 90 ? '…' : ''}&rdquo;
                  <span className="text-muted-foreground text-[10px]"> — {social.symbols[0].top_post.platform}/{social.symbols[0].top_post.channel}</span>
                </a>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 px-1 text-[10px] text-muted-foreground/80 leading-relaxed">
        Channels: news sentiment (Tetlock 2007; Loughran–McDonald 2011 lexicon), social mood weighted by volume
        (Bollen et&nbsp;al. 2011; VADER, Hutto–Gilbert 2014) and damped by disagreement (Antweiler–Frank 2004),
        Polymarket drift, VIX regime (Whaley 2000), NWS/USGS weather risk. Composite per Baker–Wurgler (2007).
        Research signal, not financial advice.
      </p>
    </section>
  )
}
