import ExploreFooter from '@/components/ExploreFooter'
import CadenceChart from '@/components/insights/CadenceChart'
import CoveragePanel from '@/components/insights/CoveragePanel'
import DistributionChart from '@/components/insights/DistributionChart'
import OutletTable from '@/components/insights/OutletTable'
import DivergencePanel from '@/components/insights/DivergencePanel'
import SignalsPanel from '@/components/insights/SignalsPanel'
import {
  Caveat,
  LegendKey,
  MagnitudeBar,
  SectionHead,
  SpreadBar,
  StatTile,
} from '@/components/insights/Primitives'
import { compact, duration, getAnalytics, pct, signed } from '@/lib/analytics'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Insights · ClearLens',
  description: 'What the whole corpus looks like — bias, tone, cadence, coverage and markets.',
}

const EMOTION_LABEL: Record<string, string> = {
  anger: 'Anger',
  fear: 'Fear',
  joy: 'Joy',
  sadness: 'Sadness',
  disgust: 'Disgust',
  trust: 'Trust',
  anticipation: 'Anticipation',
  surprise: 'Surprise',
}

export default async function InsightsPage() {
  const a = await getAnalytics()

  if (!a) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-24 text-center">
        <p className="news-section-label">Insights</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Analytics unavailable</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          The ML service is not responding on <code className="tabular-nums">/analytics</code>. Start
          it and reload.
        </p>
      </div>
    )
  }

  const { totals, bias, tone, cadence, outlets, coverage, categories, lean_split, signals, divergence } = a

  const windowDelta =
    totals.articles_prev_window > 0
      ? (totals.articles_window - totals.articles_prev_window) / totals.articles_prev_window
      : null

  const spanDays =
    totals.oldest && totals.newest
      ? Math.max(1, Math.round((Date.parse(totals.newest) - Date.parse(totals.oldest)) / 86_400_000))
      : null

  const maxEmotion = Math.max(0.0001, ...tone.emotions.map(e => e.mean))
  const maxCategory = Math.max(1, ...categories.map(c => c.articles))
  const erroring = outlets.filter(o => o.error_count > 0)
  const stale = outlets.filter(o => o.stale && o.error_count === 0)

  return (
    <div className="px-4 sm:px-6 lg:px-10 xl:px-14 py-8">
      {/* ────── Masthead ────── */}
      <header className="mb-8">
        <p className="news-section-label">Corpus analytics</p>
        <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">Insights</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed max-w-prose">
          Everything ClearLens has read, measured in aggregate — how much arrives and when, how the
          bias and sentiment models actually score it, which outlets carry the load, and where
          coverage concentrates.
          {spanDays && ` Spanning ${spanDays} days of ingestion.`}
        </p>
      </header>

      {/* ────── Headline figures ────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-12">
        <StatTile
          label="Articles"
          value={compact(totals.articles)}
          sub={`${compact(totals.words)} words`}
        />
        <StatTile
          label="Last 24h"
          value={String(totals.articles_window)}
          delta={windowDelta}
          sub="vs prior 24h"
        />
        <StatTile
          label="Outlets"
          value={String(totals.sources_active)}
          sub={
            totals.sources_erroring > 0
              ? `${totals.sources_erroring} erroring`
              : totals.sources_stale > 0
                ? `${totals.sources_stale} stale`
                : 'all fetching + publishing'
          }
        />
        <StatTile
          label="Story clusters"
          value={String(totals.story_groups)}
          sub={`${coverage.clustered_articles} articles linked`}
        />
        <StatTile
          label="Full text"
          value={pct(totals.articles > 0 ? totals.with_body / totals.articles : null)}
          sub={`${compact(totals.with_body)} extracted`}
        />
        <StatTile
          label="Market signals"
          value={String(signals.count)}
          sub={`live of ${signals.count_total} tracked`}
        />
      </div>

      {/* ────── Cadence ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Throughput"
          title="Ingestion cadence"
          blurb={`Articles landing per day and the hour-of-day rhythm, both over the last ${cadence.trend_days} days.`}
        />
        <div className="news-card p-5">
          <CadenceChart daily={cadence.daily} byHour={cadence.by_hour_of_day} trendDays={cadence.trend_days} />
        </div>
      </section>

      {/* ────── Bias ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Model output"
          title="Political bias"
          blurb="Where every scored article falls on the −2 (left) to +2 (right) scale."
          aside={
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              <div className="tabular-nums font-medium text-foreground">{signed(bias.mean)}</div>
              <div>mean score</div>
              <div className="mt-1 tabular-nums">{pct(bias.mean_confidence)} confidence</div>
            </div>
          }
        />
        <div className="news-card p-5">
          <DistributionChart
            buckets={bias.histogram}
            bins={bias.fine_histogram}
            quantiles={bias.quantiles}
            nominalMin={bias.nominal_min}
            nominalMax={bias.nominal_max}
            scaleUsed={bias.scale_used}
            scored={bias.scored}
            scale="bias"
            negLabel="Left"
            posLabel="Right"
          />
          <div className="mt-4">
            <Caveat>
              The outlet&rsquo;s own AllSides rating is one of the model&rsquo;s input features, and on
              this corpus it dominates: every source&rsquo;s articles cluster within about ±0.05 of
              its published rating. Read this as &ldquo;how the corpus is composed by outlet
              lean&rdquo; rather than as an independent per-article judgement — the text features
              are not yet strong enough to move an article away from its publisher.
            </Caveat>
          </div>
        </div>
      </section>

      {/* ────── Tone ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Model output"
          title="Sentiment & emotion"
          blurb="Polarity runs −1 (negative) to +1 (positive); intensity measures how charged the language is regardless of direction."
          aside={
            <div className="text-[11px] text-muted-foreground leading-relaxed">
              <div className="tabular-nums font-medium text-foreground">{signed(tone.mean)}</div>
              <div>mean polarity</div>
              <div className="mt-1 tabular-nums">{signed(tone.mean_intensity)} intensity</div>
            </div>
          }
        />

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-6">
          <div className="news-card p-5">
            <DistributionChart
              buckets={tone.histogram}
              bins={tone.fine_histogram}
              quantiles={tone.quantiles}
              nominalMin={tone.nominal_min}
              nominalMax={tone.nominal_max}
              scaleUsed={tone.scale_used}
              scored={tone.scored}
              scale="tone"
              negLabel="Negative"
              posLabel="Positive"
            />
          </div>

          <div className="news-card p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-4">
              Emotional mix
            </p>
            <div className="space-y-2.5">
              {[...tone.emotions]
                .sort((x, y) => y.mean - x.mean)
                .map(e => (
                  <MagnitudeBar
                    key={e.emotion}
                    label={EMOTION_LABEL[e.emotion] ?? e.emotion}
                    value={e.mean}
                    max={maxEmotion}
                    caption={e.mean.toFixed(3)}
                  />
                ))}
            </div>
            <Caveat>
              Mean score per emotion across {tone.emotion_sample.toLocaleString()} articles. Bar
              length is the only encoding — eight hues could not be told apart reliably, so each
              row is labelled instead.
            </Caveat>

            <dl className="mt-5 pt-4 border-t border-border/60 grid grid-cols-2 gap-y-2.5 gap-x-3 text-[12px]">
              <div>
                <dt className="text-muted-foreground">Negative</dt>
                <dd className="tabular-nums font-medium">{tone.negative.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Positive</dt>
                <dd className="tabular-nums font-medium">{tone.positive.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Neutral</dt>
                <dd className="tabular-nums font-medium">{tone.neutral.toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground" title="Intensity ≥ 0.66">
                  Highly charged
                </dt>
                <dd className="tabular-nums font-medium">{tone.charged.toLocaleString()}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* ────── Outlets ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Sources"
          title="Outlet leaderboard"
          blurb="Volume, average scores and fetch health per source. Tap a column to re-sort."
        />

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 mb-4">
          <div className="news-card p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
              Political spread of the source list
            </p>
            <SpreadBar {...lean_split.outlets} />
            <p className="mt-3 text-[12px] text-muted-foreground leading-relaxed">
              By article volume:{' '}
              <span className="tabular-nums">
                {lean_split.articles.left.toLocaleString()} left ·{' '}
                {lean_split.articles.center.toLocaleString()} centre ·{' '}
                {lean_split.articles.right.toLocaleString()} right
              </span>
              .
            </p>
            <LegendKey
              items={[
                { color: 'var(--viz-bias-l3)', label: 'Left' },
                { color: 'var(--viz-mid)', label: 'Centre' },
                { color: 'var(--viz-bias-r3)', label: 'Right' },
              ]}
            />
          </div>

          <div className="news-card p-5">
            <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground mb-3">
              Articles by beat
            </p>
            <div className="space-y-2.5">
              {categories.map(c => (
                <MagnitudeBar
                  key={c.category}
                  label={c.category}
                  value={c.articles}
                  max={maxCategory}
                  caption={`${compact(c.articles)}`}
                />
              ))}
            </div>
          </div>
        </div>

        <OutletTable outlets={outlets} />

        {totals.articles_unlisted > 0 && (
          <Caveat>
            {totals.articles_unlisted.toLocaleString()} articles come from sources that are no
            longer active, so they count toward the corpus totals above but have no row here — the
            leaderboard deliberately lists only live outlets.
          </Caveat>
        )}

        {erroring.length > 0 && (
          <Caveat>
            {erroring.length === 1 ? 'One feed is' : `${erroring.length} feeds are`} failing to
            fetch: {erroring.map(o => o.name).join(', ')}. Counts shown are consecutive failures; a
            successful fetch clears them.
          </Caveat>
        )}

        {stale.length > 0 && (
          <Caveat>
            {stale.length === 1 ? 'One feed fetches' : `${stale.length} feeds fetch`} without error
            but {stale.length === 1 ? 'has' : 'have'} stopped publishing:{' '}
            {stale
              .map(o => `${o.name} (silent ${duration(o.silent_hours)})`)
              .join(', ')}
            . A dead feed still returns HTTP 200, so nothing else flags it — check whether the
            publisher moved or retired the endpoint.
          </Caveat>
        )}
      </section>

      {/* ────── Coverage ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Clustering"
          title="Where coverage concentrates"
          blurb="Stories that more than one outlet ran, and how politically wide each of those groups is."
        />
        <CoveragePanel coverage={coverage} />
      </section>

      {/* ────── Coverage vs market ────── */}
      <section className="mb-12">
        <SectionHead
          kicker="Attention vs odds"
          title="Where coverage and markets disagree"
          blurb={`For events these outlets actually wrote about in the last ${divergence.window_days} days, how loud the coverage is against what traders are paying.`}
        />
        <DivergencePanel divergence={divergence} />
      </section>

      {/* ────── Signals ────── */}
      <section className="mb-4">
        <SectionHead
          kicker="Prediction markets"
          title="What money expects next"
          blurb="Live Polymarket contracts on the events these outlets are covering — the odds traders are actually taking."
        />
        <SignalsPanel signals={signals} />
      </section>

      <ExploreFooter excludeHrefs={['/insights']} />
    </div>
  )
}
