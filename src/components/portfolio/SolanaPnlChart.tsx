import { useState } from 'react'
import { formatUnitsExact } from '../prediction/amounts'
import type { PnlPoint } from '../../../packages/prediction-core/portfolio/model'
export const PNL_RANGES = ['1D', '1W', '1M', '1Y', 'YTD', 'ALL'] as const
export function SolanaPnlChart({
  points,
  symbol,
  decimals,
  range,
  onRange,
  reason,
}: {
  points: PnlPoint[]
  symbol: string
  decimals: number
  range: string
  onRange: (range: string) => void
  reason?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const available = points.filter((p) => p.value !== null)
  const first = points[0],
    last = points.at(-1)
  const selected = hover === null ? last : points[hover]
  const nums = available.map((p) => Number(p.value) / 10 ** decimals),
    low = Math.min(0, ...nums),
    high = Math.max(0, ...nums),
    spread = high - low || 1
  const x = (at: number) =>
    20 +
    ((at - (first?.at ?? 0)) /
      Math.max(1, (last?.at ?? 0) - (first?.at ?? 0))) *
      660
  const y = (value: string) =>
    158 - ((Number(value) / 10 ** decimals - low) / spread) * 128
  let open = false
  const path = points
    .map((p) => {
      if (p.value === null) {
        open = false
        return ''
      }
      const command = open ? 'L' : 'M'
      open = true
      return `${command}${x(p.at)},${y(p.value)}`
    })
    .join(' ')
  const delta =
    first?.value != null && last?.value != null
      ? BigInt(last.value) - BigInt(first.value)
      : null
  return (
    <section className="pf-chart sp-pnl" aria-label="Profit and loss chart">
      <header>
        <h2>Profit / Loss</h2>
        <div className="pf-chart-ranges">
          {PNL_RANGES.map((r) => (
            <button
              key={r}
              aria-pressed={range === r}
              onClick={() => {
                setHover(null)
                onRange(r)
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </header>
      <strong className="pf-chart-total">
        {selected?.value != null
          ? `${formatUnitsExact(BigInt(selected.value), decimals, 2)} ${symbol}`
          : '—'}
      </strong>
      <span className="pf-chart-date">
        {hover !== null && selected
          ? new Date(selected.at).toLocaleString()
          : delta !== null
            ? `${delta >= 0n ? '+' : ''}${formatUnitsExact(delta, decimals, 2)} ${symbol} in this period`
            : 'Historical portfolio performance'}
      </span>
      {available.length ? (
        <svg
          viewBox="0 0 700 180"
          role="img"
          aria-label="Historical realized and unrealized profit and loss"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect(),
              position = ((e.clientX - box.left) / box.width) * 700
            let best = 0
            points.forEach((p, i) => {
              if (
                Math.abs(x(p.at) - position) <
                Math.abs(x(points[best]!.at) - position)
              )
                best = i
            })
            setHover(best)
          }}
        >
          <line x1="20" x2="680" y1={y('0')} y2={y('0')} stroke="#343740" />
          <path d={path} fill="none" stroke="#6475ff" strokeWidth="2.5" />
          {selected?.value != null && (
            <circle
              cx={x(selected.at)}
              cy={y(selected.value)}
              r="4"
              fill="#c4caff"
            />
          )}
        </svg>
      ) : (
        <div className="pf-chart-empty" role="status">
          {reason ?? 'Loading portfolio history…'}
        </div>
      )}
      <p>
        Realized + unrealized P/L · last traded prices · excludes SOL network
        fees.
      </p>
      {available.length > 0 && reason && <p role="status">{reason}</p>}
    </section>
  )
}
