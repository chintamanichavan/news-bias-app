'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import PriceChart, { OHLC } from '@/components/PriceChart'

const RANGES = ['1d', '5d', '1mo', '6mo', '1y', '5y'] as const
type Range = typeof RANGES[number]

interface Detail {
  symbol: string
  name: string
  exchange: string | null
  currency: string | null
  instrument_type: string | null
  price: number | null
  previous_close: number | null
  change: number | null
  change_pct: number | null
  day_high: number | null
  day_low: number | null
  volume: number | null
  fifty_two_week_high: number | null
  fifty_two_week_low: number | null
  first_trade_date: number | null
  series: OHLC[]
}

interface NewsArticle {
  id: string
  title: string
  url: string
  published: string | null
  sentiment_score: number | null
  source: { id: string; name: string; category: string; allsides_label: string; allsides_score: number }
}

interface NewsResponse {
  symbol: string
  keywords: string[]
  articles: NewsArticle[]
}

function fmtPrice(p: number | null, ccy: string | null): string {
  if (p == null) return '—'
  const decimals = Math.abs(p) >= 1000 ? 2 : Math.abs(p) >= 1 ? 2 : 4
  const s = p.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  if (!ccy || ccy === 'USD') return s
  return `${s} ${ccy}`
}

function fmtVolume(v: number | null): string {
  if (v == null || v === 0) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`
  return v.toString()
}

const RANGE_LABEL: Record<Range, string> = {
  '1d': '1D', '5d': '5D', '1mo': '1M', '6mo': '6M', '1y': '1Y', '5y': '5Y',
}

export default function StockDetailPage() {
  const params = useParams<{ symbol: string }>()
  const symbol = decodeURIComponent(params.symbol)

  const [range, setRange] = useState<Range>('6mo')
  const [data, setData] = useState<Detail | null>(null)
  const [news, setNews] = useState<NewsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async (r: Range) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/markets/${encodeURIComponent(symbol)}?range=${r}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const d: Detail = await res.json()
      setData(d)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => { fetchDetail(range) }, [fetchDetail, range])

  useEffect(() => {
    fetch(`/api/markets/${encodeURIComponent(symbol)}/news?limit=12`)
      .then(r => r.ok ? r.json() : null)
      .then(setNews)
      .catch(() => setNews({ symbol, keywords: [], articles: [] }))
  }, [symbol])

  if (error && !data) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-lg font-semibold">Couldn&rsquo;t load {symbol}</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <Link href="/markets" className="inline-block mt-4 text-sm font-medium text-foreground hover:opacity-60 transition-opacity">← Markets</Link>
      </div>
    )
  }

  const up = (data?.change ?? 0) >= 0
  const hasChange = data?.change != null && data?.change_pct != null
  const pillClass = !hasChange
    ? 'bg-[var(--wash-stone-1)] text-muted-foreground'
    : up
      ? 'bg-emerald-500 text-white'
      : 'bg-rose-500 text-white'

  // Range-vs-baseline: for 1d use previous_close; for longer ranges use first close in the series.
  const baseline = data
    ? (range === '1d' ? data.previous_close : (data.series[0]?.c ?? null))
    : null

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <Link
        href="/markets"
        className="inline-flex items-center text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        ← Markets
      </Link>

      {/* Editorial-style header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground tabular-nums">
            {data?.exchange ?? ''}{data?.exchange && data?.instrument_type ? ' · ' : ''}{data?.instrument_type ?? ''}
          </p>
          <h1 className="mt-1 text-4xl sm:text-5xl font-bold tabular-nums tracking-tight leading-none">
            {data?.symbol ?? symbol}
          </h1>
          <p className="text-sm text-muted-foreground mt-2 line-clamp-1" title={data?.name ?? ''}>
            {data?.name ?? '—'}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl sm:text-4xl font-semibold tabular-nums leading-none">
            {fmtPrice(data?.price ?? null, data?.currency ?? null)}
          </div>
          {hasChange && (
            <div className={`mt-2 inline-block text-[13px] font-semibold tabular-nums px-2.5 py-0.5 rounded-md ${pillClass}`}>
              {up ? '+' : ''}{data!.change!.toFixed(2)} · {up ? '+' : ''}{data!.change_pct!.toFixed(2)}%
            </div>
          )}
        </div>
      </header>

      {/* Range selector + refresh */}
      <div className="flex items-center gap-1 -mx-1">
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`text-[12px] uppercase tracking-wider px-2.5 py-1 rounded-md transition-colors tabular-nums ${
              r === range
                ? 'bg-foreground text-background font-medium'
                : 'bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
        <Button
          variant="ghost" size="sm"
          className="ml-auto text-xs"
          onClick={() => fetchDetail(range)}
          disabled={loading}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>

      {/* Chart */}
      <div className="news-card p-4 sm:p-5">
        {loading && !data ? (
          <div className="h-72 bg-muted/30 rounded animate-pulse" />
        ) : data ? (
          <PriceChart series={data.series} baseline={baseline} intraday={range === '1d'} />
        ) : null}
      </div>

      {/* Stats — single news-card with internal grid */}
      <div className="news-card p-5 sm:p-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
          <Stat label="Day range" value={data ? `${fmtPrice(data.day_low, data.currency)} – ${fmtPrice(data.day_high, data.currency)}` : '—'} />
          <Stat label="52-week range" value={data ? `${fmtPrice(data.fifty_two_week_low, data.currency)} – ${fmtPrice(data.fifty_two_week_high, data.currency)}` : '—'} />
          <Stat label="Previous close" value={fmtPrice(data?.previous_close ?? null, data?.currency ?? null)} />
          <Stat label="Volume" value={fmtVolume(data?.volume ?? null)} />
        </div>
      </div>

      {/* Range performance */}
      {data && data.series.length > 1 && (
        <RangePerf range={range} series={data.series} />
      )}

      {/* Related news */}
      <RelatedNews news={news} />

      <p className="text-xs text-muted-foreground text-center pt-4">
        Quotes from Yahoo Finance · cached 60s · delayed 15+ min · not financial advice.
      </p>
    </div>
  )
}

// The insights charts already define a validated three-step ramp per arm, with
// separate light and dark values. Reuse it rather than picking Tailwind steps
// that only read correctly on white.
const BIAS_DOT: Record<string, string> = {
  far_left:   'bg-[var(--viz-bias-l3)]',
  left:       'bg-[var(--viz-bias-l2)]',
  lean_left:  'bg-[var(--viz-bias-l1)]',
  center:     'bg-muted-foreground/40',
  lean_right: 'bg-[var(--viz-bias-r1)]',
  right:      'bg-[var(--viz-bias-r2)]',
  far_right:  'bg-[var(--viz-bias-r3)]',
}

const SOURCE_TONE: Record<string, string> = {
  far_left:   'text-[var(--ink-blue)]',
  left:       'text-[var(--ink-blue)]',
  lean_left:  'text-[var(--ink-blue)]',
  center:     'text-muted-foreground',
  lean_right: 'text-[var(--ink-red)]',
  right:      'text-[var(--ink-red)]',
  far_right:  'text-[var(--ink-red)]',
}

function timeAgo(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const m = Math.round((Date.now() - d.getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function RelatedNews({ news }: { news: NewsResponse | null }) {
  if (!news) {
    return (
      <section>
        <p className="news-section-label mb-3">Related news</p>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="news-card h-14 animate-pulse bg-muted/30" />
          ))}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-3">
        <p className="news-section-label">Related news</p>
        {news.keywords.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            matching: {news.keywords.map(k => `“${k}”`).join(' · ')}
          </span>
        )}
      </div>

      {news.articles.length === 0 ? (
        <div className="news-card text-xs text-muted-foreground p-5 text-center">
          No recent articles in the feed mention {news.keywords.length > 0 ? news.keywords[0] : 'this'}.
        </div>
      ) : (
        <>
          <SentimentSummary articles={news.articles} />
          <div className="news-card divide-y divide-border/40 overflow-hidden">
            {news.articles.map(a => {
              const dot = BIAS_DOT[a.source.allsides_label] ?? BIAS_DOT.center
              const tone = SOURCE_TONE[a.source.allsides_label] ?? 'text-muted-foreground'
              return (
                <a
                  key={a.id}
                  href={a.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3.5 hover:bg-muted/40 transition-colors group"
                >
                  <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} title={a.source.allsides_label} />
                  <div className="min-w-0">
                    <div className={`text-[10px] font-medium uppercase tracking-[0.12em] mb-0.5 ${tone}`}>
                      {a.source.name}
                      {a.published && <span className="text-muted-foreground/60 normal-case tracking-normal"> · {timeAgo(a.published)}</span>}
                    </div>
                    <div className="text-[14px] font-medium leading-snug line-clamp-2 group-hover:text-foreground/70 transition-colors">
                      {a.title}
                    </div>
                  </div>
                  <span className="text-muted-foreground/50 group-hover:text-foreground transition-colors text-xs mt-1">↗</span>
                </a>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

function SentimentSummary({ articles }: { articles: NewsArticle[] }) {
  const stats = useMemo(() => {
    const sents = articles.map(a => a.sentiment_score).filter((s): s is number => s != null)
    // Publisher ratings, not per-article scores — this counts who covered the
    // symbol, which is what the panel below actually claims.
    const biases = articles.map(a => a.source.allsides_score)

    const pos = sents.filter(s => s >=  0.3).length
    const neg = sents.filter(s => s <= -0.3).length
    const neu = sents.length - pos - neg
    const avg = sents.length ? sents.reduce((a, b) => a + b, 0) / sents.length : null

    const left  = biases.filter(b => b <= -0.5).length
    const right = biases.filter(b => b >=  0.5).length
    const center = biases.length - left - right
    const avgBias = biases.length ? biases.reduce((a, b) => a + b, 0) / biases.length : null

    return { sents: sents.length, biases: biases.length, pos, neg, neu, avg, left, right, center, avgBias }
  }, [articles])

  if (stats.sents === 0) return null

  const label = stats.avg == null ? '—'
    : stats.avg >=  0.15 ? 'Net positive'
    : stats.avg <= -0.15 ? 'Net negative'
    : 'Mixed'

  const labelColor = stats.avg == null ? 'text-muted-foreground'
    : stats.avg >=  0.15 ? 'text-[var(--ink-emerald)]'
    : stats.avg <= -0.15 ? 'text-[var(--ink-rose)]'
    : 'text-foreground'

  const total = stats.sents
  const pct = (n: number) => (n / total) * 100

  const biasLean = stats.avgBias == null ? null
    : stats.avgBias <= -0.5 ? 'left-leaning'
    : stats.avgBias >=  0.5 ? 'right-leaning'
    : 'centrist'

  return (
    <div className="news-card p-4 sm:p-5 mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="flex items-baseline gap-3">
          <span className={`text-sm font-semibold ${labelColor}`}>{label}</span>
          {stats.avg != null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              avg sentiment {stats.avg > 0 ? '+' : ''}{stats.avg.toFixed(2)}
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">across {total} article{total === 1 ? '' : 's'}</span>
      </div>

      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {stats.pos > 0 && <div className="bg-emerald-500" style={{ width: `${pct(stats.pos)}%` }} title={`${stats.pos} positive`} />}
        {stats.neu > 0 && <div className="bg-muted-foreground/40" style={{ width: `${pct(stats.neu)}%` }} title={`${stats.neu} neutral`} />}
        {stats.neg > 0 && <div className="bg-rose-500" style={{ width: `${pct(stats.neg)}%` }} title={`${stats.neg} negative`} />}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1.5">
        <span>↑ {stats.pos} positive</span>
        <span>· {stats.neu} neutral</span>
        <span>↓ {stats.neg} negative</span>
      </div>

      {biasLean && stats.biases > 0 && (
        <div className="text-[11px] text-muted-foreground mt-3 pt-3 border-t border-border/50">
          Coverage skew: <span className="font-medium text-foreground">{biasLean}</span>
          {stats.avgBias != null && (
            <span className="tabular-nums"> · avg {stats.avgBias > 0 ? '+' : ''}{stats.avgBias.toFixed(2)}</span>
          )}
          <span className="ml-2 opacity-70">
            ({stats.left}L / {stats.center}C / {stats.right}R)
          </span>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-1">{value}</div>
    </div>
  )
}

function RangePerf({ range, series }: { range: Range; series: OHLC[] }) {
  const first = series[0].c
  const last = series[series.length - 1].c
  const high = Math.max(...series.map(p => p.c))
  const low = Math.min(...series.map(p => p.c))
  const change = last - first
  const pct = (change / first) * 100
  const up = change >= 0
  return (
    <div className="news-card p-5 sm:p-6">
      <p className="news-section-label mb-3">{range.toUpperCase()} performance</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4">
        <Stat label="Change" value={`${up ? '+' : ''}${change.toFixed(2)} (${up ? '+' : ''}${pct.toFixed(2)}%)`} />
        <Stat label="High" value={high.toFixed(2)} />
        <Stat label="Low" value={low.toFixed(2)} />
        <Stat label="Points" value={series.length.toString()} />
      </div>
    </div>
  )
}
