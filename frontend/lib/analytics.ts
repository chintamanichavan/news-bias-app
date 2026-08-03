/**
 * Shapes returned by the ML service's `GET /analytics` rollup, plus the small
 * helpers the Insights page needs to read them.
 *
 * Everything here mirrors `ml-service/main.py::get_analytics` — if a field moves
 * there, it moves here.
 */

export interface Bucket {
  key: string
  label: string
  lo: number
  hi: number
  count: number
}

export interface Bin {
  lo: number
  hi: number
  count: number
}

export interface Quantiles {
  min: number
  p10: number
  p25: number
  median: number
  p75: number
  p90: number
  max: number
  mean: number
  stdev: number
}

/** The common payload every scored dimension carries. */
interface Distribution {
  histogram: Bucket[]
  fine_histogram: Bin[]
  quantiles: Quantiles | null
  nominal_min: number
  nominal_max: number
  /** Observed range ÷ nominal range. Near zero ⇒ the model barely moves. */
  scale_used: number
  scored: number
}

export interface Analytics {
  totals: {
    articles: number
    articles_window: number
    articles_prev_window: number
    articles_7d: number
    scored_tone: number
    with_body: number
    with_summary: number
    with_image: number
    sources_ingesting: number
    sources_active: number
    sources_erroring: number
    /** Fetching cleanly but no longer publishing — see Outlet.stale. */
    sources_stale: number
    /** Articles from deactivated sources: in `articles`, absent from `outlets`. */
    articles_unlisted: number
    story_groups: number
    words: number
    oldest: string | null
    newest: string | null
  }
  tone: Distribution & {
    mean: number | null
    mean_intensity: number | null
    intensity_quantiles: Quantiles | null
    intensity_fine_histogram: Bin[]
    negative: number
    neutral: number
    positive: number
    charged: number
    emotions: { emotion: string; mean: number; dominant_count: number }[]
    emotion_sample: number
  }
  cadence: {
    hourly: { bucket: string; count: number }[]
    daily: { bucket: string; count: number }[]
    by_hour_of_day: { hour: number; count: number }[]
    trend_days: number
  }
  outlets: Outlet[]
  coverage: {
    size_distribution: { outlets: number; groups: number }[]
    clustered_articles: number
    blindspots: { left: number; right: number }
    total_groups: number
    top: CoverageGroup[]
    widest_spread: CoverageGroup[]
  }
  categories: {
    category: string
    articles: number
    outlets: number
    mean_tone: number | null
  }[]
  lean_split: {
    outlets: { left: number; center: number; right: number }
    articles: { left: number; center: number; right: number }
  }
  composition: Composition
  divergence: Divergence
  models: unknown
  signals: {
    movers: Signal[]
    by_volume: Signal[]
    categories: Record<string, number>
    /** Unresolved contracts only — safe to label "live". */
    count: number
    /** Every stored row, settled included. */
    count_total: number
    last_updated: string | null
  }
  generated_at: number
}

export interface Outlet {
  source_id: string
  name: string
  category: string | null
  topic: string | null
  lean: 'left' | 'center' | 'right'
  allsides_label: string
  allsides_score: number
  essential: boolean
  articles: number
  articles_window: number
  mean_tone: number | null
  mean_intensity: number | null
  mean_body_chars: number | null
  full_text: number
  latest: string | null
  last_fetched: string | null
  error_count: number
  /** Hours since this outlet's newest article. */
  silent_hours: number | null
  /** Its usual hours-between-articles, for context on the above. */
  median_gap_hours: number | null
  /**
   * Silent far longer than its own rhythm explains. A dead feed keeps
   * returning HTTP 200, so error_count stays 0 — this is the only signal.
   */
  stale: boolean
}

/** "26h" / "3.2d" — silence duration, scaled to stay short. */
export function duration(hours: number | null): string {
  if (hours == null) return '—'
  if (hours < 48) return `${Math.round(hours)}h`
  return `${(hours / 24).toFixed(hours < 240 ? 1 : 0)}d`
}

export interface CompositionBucket {
  key: string
  label: string
  /** Articles from outlets carrying this AllSides rating. */
  articles: number
  outlets: number
  /** The rating itself, on the -2..+2 scale sources.json uses. */
  score: number
}

/**
 * Corpus makeup by publisher lean. Replaces the retired per-article bias
 * distribution — see CompositionPanel for why.
 */
export interface Composition {
  buckets: CompositionBucket[]
  articles: number
  outlets: number
  /** Articles whose outlet carries no AllSides rating. */
  unrated: number
}

export interface Spread {
  total: number
  left: number
  center: number
  right: number
  direction: 'left' | 'right' | null
  skew: number
}

export interface CoverageGroup {
  group_id: string
  outlets: number
  articles: number
  headline: string | null
  article_id: string | null
  published: string | null
  spread: Spread
  bias_range: number | null
  sources: string[]
}

export interface DivergenceItem {
  market_id: string
  question: string
  category: string | null
  url: string | null
  end_date: string | null
  /** Polymarket implied probability, 0-1. */
  probability: number
  change_24h: number | null
  articles: number
  outlets: number
  /** Coverage as a share of the most-covered market's, 0-1. */
  attention: number
  /** attention − probability. Positive = louder than the odds. */
  gap: number
  direction: string
  mean_tone: number | null
  shared_terms: string[]
  headlines: { id: string; title: string; source_id: string }[]
}

export interface Divergence {
  items: DivergenceItem[]
  matched_markets: number
  uncovered_markets: number
  total_markets: number
  matched_articles: number
  window_days: number
}

export interface Signal {
  id: string
  source: string
  question: string
  category: string | null
  yes_price: number
  yes_change_24h: number | null
  volume_24h: number | null
  volume_total: number | null
  end_date: string | null
  url: string | null
  last_updated: string | null
}

export async function getAnalytics(): Promise<Analytics | null> {
  try {
    const base = process.env.ML_SERVICE_URL ?? 'http://localhost:8421'
    const res = await fetch(`${base}/analytics`, { cache: 'no-store' })
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

/** 1_717_286 → "1.7M". Keeps stat tiles from wrapping. */
export function compact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 10_000) return `${Math.round(n / 1000)}K`
  if (Math.abs(n) >= 1_000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function pct(n: number | null | undefined, digits = 0): string {
  return n == null ? '—' : `${(n * 100).toFixed(digits)}%`
}

export function signed(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—'
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`
}

/** "3h ago" / "2d ago" — the app's usual relative stamp. */
export function ago(iso: string | null): string {
  if (!iso) return '—'
  const t = Date.parse(iso.includes('T') || iso.includes('Z') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(t)) return '—'
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// ── Diverging color lookup ──────────────────────────────────────────────────

/**
 * Map a bucket's midpoint onto a three-step diverging arm.
 *
 * `scale` picks the semantics: bias is blue↔red (political), tone is
 * amber↔emerald (affective). Both return CSS custom properties so light/dark
 * swap in one place.
 */
export function divergingVar(
  midpoint: number,
  nominalMax: number,
  scale: 'bias' | 'tone',
): string {
  const neg = scale === 'bias' ? 'bias-l' : 'tone-n'
  const pos = scale === 'bias' ? 'bias-r' : 'tone-p'
  const t = Math.min(1, Math.abs(midpoint) / (nominalMax || 1))
  if (t < 0.06) return 'var(--viz-mid)'
  const step = t < 0.34 ? 1 : t < 0.67 ? 2 : 3
  return `var(--viz-${midpoint < 0 ? neg : pos}${step})`
}
