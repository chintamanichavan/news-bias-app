'use client'

// Candles (GPC) or open-high-low-close bars (GPO), with volume beneath,
// drawn at the panel's real width.

import { useState } from 'react'
import { fmtDate } from '@/components/quantviz'
import { useWidth } from '@/lib/terminal/useWidth'

export interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number | null }

const PAD = { l: 48, r: 12, t: 10 }
const PRICE_H = 230, GAP = 8, VOL_H = 50, AXIS = 20

export default function Candles({ bars, style }: { bars: Bar[]; style: 'candle' | 'ohlc' }) {
  const { ref, width: W } = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  if (bars.length < 2) return <p className="text-[12px] text-muted-foreground">Not enough bars to draw.</p>
  const H = PAD.t + PRICE_H + GAP + VOL_H + AXIS
  let lo = Math.min(...bars.map(b => b.low)), hi = Math.max(...bars.map(b => b.high))
  const pad = (hi - lo) * 0.05 || 1
  lo -= pad; hi += pad
  const vmax = Math.max(...bars.map(b => b.volume ?? 0)) || 1
  const step = (W - PAD.l - PAD.r) / bars.length
  const body = Math.max(1, Math.min(9, step * 0.65))
  const x = (i: number) => PAD.l + (i + 0.5) * step
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * PRICE_H
  const volTop = PAD.t + PRICE_H + GAP
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => lo + pad + f * (hi - lo - 2 * pad))
  const dates = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (bars.length - 1)))
  const long = new Date(bars[bars.length - 1].date).getTime() - new Date(bars[0].date).getTime() > 300 * 86_400_000
  const shown = bars[hover ?? bars.length - 1]

  return (
    <div ref={ref} className="space-y-1">
      <p className="text-[11.5px] tabular-nums text-muted-foreground">
        {shown.date} · O <b className="text-foreground">{shown.open.toFixed(2)}</b> H <b className="text-foreground">{shown.high.toFixed(2)}</b>{' '}
        L <b className="text-foreground">{shown.low.toFixed(2)}</b> C <b className="text-foreground">{shown.close.toFixed(2)}</b>
        {shown.volume != null && <> · Vol <b className="text-foreground">{shown.volume.toLocaleString('en-US')}</b></>}
      </p>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={style === 'candle' ? 'Candlestick chart' : 'Bar chart'}
        onMouseMove={e => {
          const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left - PAD.l) / step)
          setHover(i >= 0 && i < bars.length ? i : null)
        }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map(v => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="stroke-border/70" strokeWidth={0.75} />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9.5} className="fill-muted-foreground tabular-nums">{v.toFixed(v >= 100 ? 0 : 2)}</text>
          </g>
        ))}
        {bars.map((b, i) => {
          const up = b.close >= b.open
          const cls = up ? 'stroke-emerald-500 fill-emerald-500' : 'stroke-rose-500 fill-rose-500'
          const top = y(Math.max(b.open, b.close)), bottom = y(Math.min(b.open, b.close))
          return (
            <g key={b.date} className={cls}>
              <line x1={x(i)} x2={x(i)} y1={y(b.high)} y2={y(b.low)} strokeWidth={1} />
              {style === 'candle'
                ? <rect x={x(i) - body / 2} y={top} width={body} height={Math.max(1, bottom - top)} fillOpacity={up ? 0.25 : 1} strokeWidth={1} />
                : <>
                    <line x1={x(i) - body / 2} x2={x(i)} y1={y(b.open)} y2={y(b.open)} strokeWidth={1} />
                    <line x1={x(i)} x2={x(i) + body / 2} y1={y(b.close)} y2={y(b.close)} strokeWidth={1} />
                  </>}
              {b.volume != null && (
                <rect x={x(i) - body / 2} width={body} y={volTop + VOL_H * (1 - b.volume / vmax)} height={VOL_H * b.volume / vmax}
                  fillOpacity={0.35} stroke="none" />
              )}
            </g>
          )
        })}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={volTop + VOL_H} className="stroke-foreground/30" strokeWidth={1} />}
        {Array.from(new Set(dates)).map(i => (
          <text key={i} x={x(i)} y={H - 6} fontSize={9.5} className="fill-muted-foreground tabular-nums"
            textAnchor={i === 0 ? 'start' : i === bars.length - 1 ? 'end' : 'middle'}>{fmtDate(bars[i].date, long)}</text>
        ))}
      </svg>
    </div>
  )
}
