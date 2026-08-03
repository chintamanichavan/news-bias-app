import { Composition, compact } from '@/lib/analytics'
import { Caveat } from './Primitives'

/**
 * What the corpus is made of, by publisher lean.
 *
 * This replaces the old per-article bias histogram, which claimed to be model
 * output and wasn't: the model's strongest feature was the publisher's own
 * AllSides rating, so every article scored within a hair of its outlet. What
 * that chart actually plotted was this — how many articles come from outlets of
 * each lean — with a model in front of it. So plot it directly, and say whose
 * judgement the lean is.
 *
 * Bars are stacked on one row rather than drawn as a diverging histogram: with
 * five ordered categories and one dominant bucket, a single 100% bar reads the
 * imbalance faster than seven bars sharing an axis.
 */
export default function CompositionPanel({ composition }: { composition: Composition }) {
  const { buckets, articles, outlets, unrated } = composition
  const total = Math.max(1, articles)

  // Same three-step diverging ramp the tone chart uses, so "further from centre"
  // reads the same way across the page.
  const fill = (key: string) =>
    ({
      left: 'var(--viz-bias-l3)',
      lean_left: 'var(--viz-bias-l1)',
      center: 'var(--viz-mid)',
      lean_right: 'var(--viz-bias-r1)',
      right: 'var(--viz-bias-r3)',
    })[key] ?? 'var(--viz-mid)'

  const present = buckets.filter(b => b.articles > 0)

  return (
    <div className="news-card p-5">
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
          Share of articles
        </p>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {compact(articles)} articles · {outlets} outlets
          {unrated > 0 && <> · {compact(unrated)} unrated</>}
        </p>
      </div>

      <div className="flex h-7 rounded-md overflow-hidden bg-muted" role="img"
           aria-label="Article share by publisher lean">
        {present.map(b => (
          <div
            key={b.key}
            style={{ width: `${(b.articles / total) * 100}%`, background: fill(b.key) }}
            title={`${b.label}: ${b.articles} articles from ${b.outlets} outlets`}
          />
        ))}
      </div>

      <dl className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-y-3 gap-x-4">
        {buckets.map(b => (
          <div key={b.key} className={b.articles === 0 ? 'opacity-45' : undefined}>
            <dt className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ background: fill(b.key) }}
              />
              {b.label}
            </dt>
            <dd className="mt-1 text-[15px] font-semibold tabular-nums leading-none">
              {((b.articles / total) * 100).toFixed(1)}%
            </dd>
            <dd className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
              {compact(b.articles)} from {b.outlets} outlet{b.outlets === 1 ? '' : 's'}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-5">
        <Caveat>
          Lean here is <strong className="font-semibold">AllSides&rsquo; rating of the
          publisher</strong>, not a judgement about any individual article — every article
          inherits its outlet&rsquo;s rating. A wire report and an op-ed from the same masthead
          count identically. Read this as the shape of the reading list, which is a real thing to
          know about it: {((buckets.find(b => b.key === 'center')?.articles ?? 0) / total * 100)
          .toFixed(0)}% of what arrives here comes from centre-rated outlets, so the feed will look
          calm whether or not the news is.
        </Caveat>
      </div>
    </div>
  )
}
