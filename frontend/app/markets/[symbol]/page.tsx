'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
  bias_score: number | null
  sentiment_score: number | null
  source: { id: string; name: string; category: string; allsides_label: string }
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
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-20 text-center">
        <p className="text-lg font-medium">Couldn't load {symbol}</p>
        <p className="text-sm text-muted-foreground mt-1">{error}</p>
        <Link href="/markets" className="inline-block mt-4 text-sm text-primary hover:underline">← Back to markets</Link>
      </div>
    )
  }

  const up = (data?.change ?? 0) >= 0
  const changeColor = data?.change == null ? 'text-muted-foreground'
    : up ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
  const changeBg = data?.change == null ? 'bg-muted'
    : up ? 'bg-emerald-100 dark:bg-emerald-950/40' : 'bg-rose-100 dark:bg-rose-950/40'

  // Range-vs-baseline: for 1d use previous_close; for longer ranges use the first close in the series.
  const baseline = data
    ? (range === '1d' ? data.previous_close : (data.series[0]?.c ?? null))
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="mb-1">
        <Link href="/markets" className="text-xs text-muted-foreground hover:text-foreground">← Markets</Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-3xl font-bold tabular-nums">{data?.symbol ?? symbol}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data?.name ?? '—'}{data?.exchange ? ` · ${data.exchange}` : ''}{data?.instrument_type ? ` · ${data.instrument_type}` : ''}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular-nums leading-none">
            {fmtPrice(data?.price ?? null, data?.currency ?? null)}
          </div>
          {data?.change != null && data?.change_pct != null && (
            <div className={`mt-1 inline-block text-sm font-semibold tabular-nums px-2 py-0.5 rounded ${changeBg} ${changeColor}`}>
              {up ? '+' : ''}{data.change.toFixed(2)} ({up ? '+' : ''}{data.change_pct.toFixed(2)}%)
            </div>
          )}
        </div>
      </div>

      {/* Range selector */}
      <div className="flex items-center gap-1.5 mb-3">
        {RANGES.map(r => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`text-xs uppercase tracking-wider px-2.5 py-1 rounded-md transition-colors ${
              r === range
                ? 'bg-primary text-primary-foreground font-medium'
                : 'bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {r === '1d' ? '1D' : r === '5d' ? '5D' : r === '1mo' ? '1M' : r === '6mo' ? '6M' : r === '1y' ? '1Y' : '5Y'}
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
      <Card className="mb-5">
        <div className="p-3 sm:p-4">
          {loading && !data ? (
            <div className="h-72 bg-muted/30 rounded animate-pulse" />
          ) : data ? (
            <PriceChart series={data.series} baseline={baseline} intraday={range === '1d'} />
          ) : null}
        </div>
      </Card>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Day range" value={data ? `${fmtPrice(data.day_low, data.currency)} – ${fmtPrice(data.day_high, data.currency)}` : '—'} />
        <Stat
          label="52-week range"
          value={data ? `${fmtPrice(data.fifty_two_week_low, data.currency)} – ${fmtPrice(data.fifty_two_week_high, data.currency)}` : '—'}
        />
        <Stat label="Previous close" value={fmtPrice(data?.previous_close ?? null, data?.currency ?? null)} />
        <Stat label="Volume" value={fmtVolume(data?.volume ?? null)} />
      </div>

      {/* Range performance */}
      {data && data.series.length > 1 && (
        <RangePerf range={range} series={data.series} />
      )}

      {/* Related news */}
      <RelatedNews news={news} />

      <p className="text-xs text-muted-foreground mt-8 text-center">
        Quotes from Yahoo Finance · cached 60s · delayed 15+ min · not financial advice.
      </p>
    </div>
  )
}

const BIAS_DOT: Record<string, string> = {
  far_left:   'bg-blue-700',
  left:       'bg-blue-500',
  lean_left:  'bg-blue-300',
  center:     'bg-muted-foreground/40',
  lean_right: 'bg-red-300',
  right:      'bg-red-500',
  far_right:  'bg-red-700',
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
      <div className="mt-8">
        <h2 className="text-base font-semibold mb-2">Related news</h2>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="mt-8">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold">📰 Related news</h2>
        {news.keywords.length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            matching: {news.keywords.map(k => `“${k}”`).join(' · ')}
          </span>
        )}
      </div>

      {news.articles.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
          No recent articles in the feed mention {news.keywords.length > 0 ? news.keywords[0] : 'this'}.
        </div>
      ) : (
        <>
        <SentimentSummary articles={news.articles} />
        <div className="space-y-1.5">
          {news.articles.map(a => {
            const dot = BIAS_DOT[a.source.allsides_label] ?? BIAS_DOT.center
            return (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 rounded-lg border border-border bg-muted/10 hover:bg-muted/30 hover:border-border/80 transition-colors p-3 group"
              >
                <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${dot}`} title={a.source.allsides_label} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium line-clamp-2 group-hover:text-primary transition-colors">
                    {a.title}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2 tabular-nums">
                    <span>{a.source.name}</span>
                    {a.published && <><span>·</span><span>{timeAgo(a.published)}</span></>}
                    {a.bias_score != null && (
                      <>
                        <span>·</span>
                        <span title="Model bias score">bias {a.bias_score.toFixed(1)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="text-muted-foreground/60 group-hover:text-foreground transition-colors text-xs">↗</span>
              </a>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}

function SentimentSummary({ articles }: { articles: NewsArticle[] }) {
  const stats = useMemo(() => {
    const sents = articles.map(a => a.sentiment_score).filter((s): s is number => s != null)
    const biases = articles.map(a => a.bias_score).filter((b): b is number => b != null)

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
    : stats.avg >=  0.15 ? 'text-emerald-700 dark:text-emerald-300'
    : stats.avg <= -0.15 ? 'text-rose-700 dark:text-rose-300'
    : 'text-foreground'

  const total = stats.sents
  const pct = (n: number) => (n / total) * 100

  const biasLean = stats.avgBias == null ? null
    : stats.avgBias <= -0.5 ? 'left-leaning'
    : stats.avgBias >=  0.5 ? 'right-leaning'
    : 'centrist'

  return (
    <div className="mb-3 rounded-xl border border-border bg-muted/15 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
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

      {/* Sentiment distribution bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        {stats.pos > 0 && <div className="bg-emerald-500" style={{ width: `${pct(stats.pos)}%` }} title={`${stats.pos} positive`} />}
        {stats.neu > 0 && <div className="bg-muted-foreground/40" style={{ width: `${pct(stats.neu)}%` }} title={`${stats.neu} neutral`} />}
        {stats.neg > 0 && <div className="bg-rose-500" style={{ width: `${pct(stats.neg)}%` }} title={`${stats.neg} negative`} />}
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground tabular-nums mt-1">
        <span>↑ {stats.pos} positive</span>
        <span>· {stats.neu} neutral</span>
        <span>↓ {stats.neg} negative</span>
      </div>

      {/* Bias lean */}
      {biasLean && stats.biases > 0 && (
        <div className="text-[11px] text-muted-foreground mt-2 pt-2 border-t border-border/50">
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
    <Card>
      <div className="p-3">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-medium tabular-nums mt-1">{value}</div>
      </div>
    </Card>
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
    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
      <Stat label={`${range.toUpperCase()} change`} value={`${up ? '+' : ''}${change.toFixed(2)} (${up ? '+' : ''}${pct.toFixed(2)}%)`} />
      <Stat label={`${range.toUpperCase()} high`} value={high.toFixed(2)} />
      <Stat label={`${range.toUpperCase()} low`}  value={low.toFixed(2)} />
      <Stat label="Points"                        value={series.length.toString()} />
    </div>
  )
}
