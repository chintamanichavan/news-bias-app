'use client'

// The signal engine's read: compact composite cards whose expanded views
// carry the full information — per-vertical history with channel breakdowns,
// the complete per-security signal table, the whole social tape. Every
// security links to its Lab dossier.

import ExpandableCard from '@/components/ExpandableCard'
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

function Spark({ entity, W = 220, H = 36, labeled = false }: { entity: string; W?: number; H?: number; labeled?: boolean }) {
  const { data } = useResource<{ history: HistoryPoint[] }>(`/api/signals/composite?entity=${entity}&history_hours=168`)
  const pts = data?.history ?? []
  if (pts.length < 2) return labeled ? <p className="text-[11px] text-muted-foreground">history accumulating…</p> : null
  const vals = pts.map(p => p.composite)
  const lo = Math.min(...vals, 0), hi = Math.max(...vals, 0)
  const span = hi - lo || 1
  const path = pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${((i / (pts.length - 1)) * W).toFixed(1)} ${(H - 4 - ((p.composite - lo) / span) * (H - 8)).toFixed(1)}`).join(' ')
  const zeroY = H - 4 - ((0 - lo) / span) * (H - 8)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H > 60 ? undefined : '2.25rem' }}>
      <line x1={0} x2={W} y1={zeroY} y2={zeroY} className="stroke-border" strokeWidth={0.75} strokeDasharray="2 3" />
      {labeled && <>
        <text x={2} y={10} fontSize={9} className="fill-muted-foreground tabular-nums">{hi.toFixed(2)}</text>
        <text x={2} y={H - 6} fontSize={9} className="fill-muted-foreground tabular-nums">{lo.toFixed(2)}</text>
      </>}
      <path d={path} fill="none" strokeWidth={1.5} strokeLinecap="round"
        className={vals[vals.length - 1] >= 0 ? 'stroke-emerald-500' : 'stroke-red-500'} />
    </svg>
  )
}

function VerticalBlock({ v, big = false }: { v: Entity; big?: boolean }) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-sm font-semibold">{v.name} composite</span>
        <span className={`${big ? 'text-2xl' : 'text-lg'} font-bold tabular-nums ${tone(v.composite)}`}>
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
      <Spark entity={v.entity} W={big ? 720 : 220} H={big ? 140 : 36} labeled={big} />
    </div>
  )
}

function SecurityRow({ s, detailed = false }: { s: Entity; detailed?: boolean }) {
  return (
    <a href={`/lab?symbol=${encodeURIComponent(s.entity)}`}
      className="flex items-center gap-3 rounded px-1 -mx-1 hover:bg-muted/40 transition-colors"
      title={`Open ${s.entity} in the Research Lab`}>
      <span className="w-16 shrink-0 text-[12px] font-semibold tabular-nums">{s.entity}</span>
      <span className="flex-1 min-w-0 text-[11px] text-muted-foreground truncate">{s.name}</span>
      {detailed && (
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 hidden sm:inline">
          news {s.components.news != null ? (s.components.news > 0 ? '+' : '') + s.components.news.toFixed(2) : '·'}
          {' '}· social {s.components.social != null ? (s.components.social > 0 ? '+' : '') + s.components.social.toFixed(2) : '·'}
        </span>
      )}
      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
        {s.inputs.news_articles}n·{s.inputs.social_posts}s
      </span>
      <span className={`w-12 text-right text-[12px] font-bold tabular-nums shrink-0 ${tone(s.composite)}`}>
        {s.composite > 0 ? '+' : ''}{s.composite.toFixed(2)}
      </span>
    </a>
  )
}

export default function SignalEnginePanel() {
  const { data: comp } = useResource<Composite>('/api/signals/composite')
  const { data: social } = useResource<SocialData>('/api/signals/social')
  const { data: hazard } = useResource<HazardData>('/api/signals/hazards')

  const entities = comp?.entities ?? []
  const verticals = entities.filter(e => e.entity === 'markets' || e.entity === 'weather')
  const securities = entities.filter(e => e.entity !== 'markets' && e.entity !== 'weather')

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

      <div className="grid lg:grid-cols-2 gap-4 items-start">
        {/* Vertical composites */}
        <ExpandableCard title="Composites · markets & weather" expandedTitle="Composites — 7-day history and channels"
          expanded={
            <div className="space-y-8">
              {verticals.map(v => <VerticalBlock key={v.entity} v={v} big />)}
              {hazard && (
                <div className="pt-4 border-t border-border/60">
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-sm font-semibold">Weather risk index</span>
                    <span className="text-xl font-bold tabular-nums">{(hazard.risk_index * 100).toFixed(0)}/100</span>
                  </div>
                  <p className="text-[12px] text-muted-foreground mb-2">
                    {Object.entries(hazard.counts).map(([sev, n]) => `${n} ${sev.toLowerCase()}`).join(' · ') || 'no active alerts'}
                  </p>
                  {hazard.alerts.slice(0, 6).map(a => (
                    <p key={a.id} className="text-[12px] leading-snug py-0.5">
                      <span className="font-semibold">{a.title}</span>
                      <span className="text-muted-foreground"> — {a.area}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>}>
          <div className="space-y-5 mt-1">
            {verticals.length === 0 && (
              <p className="text-sm text-muted-foreground">First engine cycle is still running — check back in a minute.</p>
            )}
            {verticals.map(v => <VerticalBlock key={v.entity} v={v} />)}
            {hazard && (
              <div className="pt-3 border-t border-border/60 flex items-baseline justify-between">
                <span className="text-[12px] font-medium">Weather risk index</span>
                <span className="text-sm font-bold tabular-nums">{(hazard.risk_index * 100).toFixed(0)}/100</span>
              </div>
            )}
          </div>
        </ExpandableCard>

        {/* Per-security signal + social tape */}
        <ExpandableCard title="Securities carrying signal" expandedTitle={`Securities carrying signal — all ${securities.length} this cycle`}
          expanded={
            <div className="space-y-6">
              <div className="space-y-1.5">
                {securities.map(s => <SecurityRow key={s.entity} s={s} detailed />)}
                {securities.length === 0 && <p className="text-sm text-muted-foreground">No per-security signal this cycle.</p>}
              </div>
              {social && (
                <div className="pt-4 border-t border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Social tape · 24h</p>
                  {Object.entries(social.verticals).map(([name, v]) => (
                    <p key={name} className="text-[12px] text-muted-foreground tabular-nums">
                      {name}: {v.posts} posts · mood <span className={tone(v.sentiment)}>{v.sentiment > 0 ? '+' : ''}{v.sentiment.toFixed(2)}</span>
                      {' '}· intensity {v.intensity.toFixed(2)} · disagreement {v.disagreement.toFixed(2)}
                      {v.volume_change != null && <> · volume {v.volume_change > 0 ? '+' : ''}{Math.round(v.volume_change * 100)}%</>}
                    </p>
                  ))}
                  <div className="mt-3 space-y-2">
                    {social.symbols.map(s => (
                      <div key={s.symbol} className="text-[12px] tabular-nums">
                        <a href={`/lab?symbol=${encodeURIComponent(s.symbol)}`} className="font-semibold hover:underline">{s.symbol}</a>
                        <span className="text-muted-foreground"> · {s.posts} posts · mood </span>
                        <span className={tone(s.sentiment)}>{s.sentiment > 0 ? '+' : ''}{s.sentiment.toFixed(2)}</span>
                        {s.top_post && (
                          <a href={s.top_post.url} target="_blank" rel="noopener noreferrer"
                            className="block text-foreground/80 hover:opacity-70 truncate">
                            “{s.top_post.title.slice(0, 110)}{s.top_post.title.length > 110 ? '…' : ''}”
                            <span className="text-muted-foreground text-[10px]"> — {s.top_post.platform}/{s.top_post.channel}</span>
                          </a>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>}>
          <div className="mt-1">
            {securities.length === 0 && <p className="text-sm text-muted-foreground">No per-security signal yet this cycle.</p>}
            <div className="space-y-2">
              {securities.slice(0, 10).map(s => <SecurityRow key={s.entity} s={s} />)}
            </div>
            {social && (
              <p className="mt-3 pt-3 border-t border-border/60 text-[11px] text-muted-foreground tabular-nums">
                social 24h: {Object.entries(social.verticals).map(([n, v]) =>
                  `${n} ${v.posts} posts, mood ${v.sentiment > 0 ? '+' : ''}${v.sentiment.toFixed(2)}`).join(' · ')}
              </p>
            )}
          </div>
        </ExpandableCard>
      </div>

      <p className="mt-2 px-1 text-[10px] text-muted-foreground/80 leading-relaxed">
        Channels: news sentiment (Tetlock 2007; Loughran–McDonald 2011 lexicon), social mood weighted by volume
        (Bollen et&nbsp;al. 2011; VADER, Hutto–Gilbert 2014) and damped by disagreement (Antweiler–Frank 2004),
        Polymarket drift, VIX regime (Whaley 2000), NWS/USGS weather risk. Composite per Baker–Wurgler (2007).
        Every security opens its full Lab dossier. Research signal, not financial advice.
      </p>
    </section>
  )
}
