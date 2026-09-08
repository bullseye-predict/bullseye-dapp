import type { Candle } from '../../../packages/prediction-core/market-data'
import { priceLabel } from './amounts'

export function ConfirmedPriceChart({ candles, label }: { candles: Candle[]; label: string }) {
  const first = candles[0], last = candles.at(-1)
  if (!first || !last) return <div className="pt-empty pt-chart-empty"><strong>No confirmed trades yet</strong><p>The chart begins when the first trade settles.</p></div>
  const width = 760, height = 230
  const duration = Math.max(1000, last.timestamp - first.timestamp)
  const x = (at: number) => 20 + (at - first.timestamp) / duration * 680
  const y = (price: bigint) => 18 + (1 - Number(price) / 1_000_000) * 180
  const path = candles.map((candle, index) => `${index ? 'L' : 'M'}${x(candle.timestamp)},${y(candle.close)}`).join(' ')
  return <figure className="pt-chart"><figcaption><span>{label} · confirmed trades</span><strong>{priceLabel(last.close)}</strong></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${label}: ${candles.length} trade intervals, last price ${priceLabel(last.close)}`}>
    {[0n, 250_000n, 500_000n, 750_000n, 1_000_000n].map(price => <g key={String(price)}><line x1="20" x2="705" y1={y(price)} y2={y(price)}/><text x="714" y={y(price) + 4}>{priceLabel(price)}</text></g>)}
    <path className="pt-price-line" d={path}/><circle cx={x(last.timestamp)} cy={y(last.close)} r="3"/>
    <text x="20" y="225">{new Date(first.timestamp).toLocaleTimeString()}</text><text x="700" y="225" textAnchor="end">{new Date(last.timestamp).toLocaleTimeString()}</text>
  </svg></figure>
}
