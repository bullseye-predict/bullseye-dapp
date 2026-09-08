import type { Candle } from '../../packages/prediction-core/market-data'
import type { Fill } from '../../packages/prediction-core/types'
import { invariant, quoteCeil } from '../../packages/prediction-core/validation'

export const CANDLE_INTERVALS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000, 3_600_000, 86_400_000] as const

/** Empty time buckets stay empty. No synthetic prices, volumes or pre-trade history. */
export function tradeCandles(fills: readonly Fill[], outcomeId: number, intervalMs: number, from: number, to: number, limit = 500): Candle[] {
  invariant(CANDLE_INTERVALS.some(value => value === intervalMs), 'INVALID_INTERVAL', 'Unsupported candle interval.')
  invariant(Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to > from, 'INVALID_RANGE', 'Invalid history time range.')
  invariant(Number.isInteger(limit) && limit >= 1 && limit <= 1000, 'INVALID_LIMIT', 'History limit must be between 1 and 1000.')
  const buckets = new Map<number, Candle>()
  const seen = new Set<string>()
  for (const fill of [...fills].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))) {
    if (fill.outcomeId !== outcomeId || fill.timestamp < from || fill.timestamp >= to || seen.has(fill.id)) continue
    seen.add(fill.id)
    const timestamp = Math.floor(fill.timestamp / intervalMs) * intervalMs
    const candle = buckets.get(timestamp)
    if (candle) {
      candle.high = fill.price > candle.high ? fill.price : candle.high
      candle.low = fill.price < candle.low ? fill.price : candle.low
      candle.close = fill.price
      candle.volume += fill.quantity
      candle.collateralVolume += quoteCeil(fill.quantity, fill.price)
      candle.trades++
    } else buckets.set(timestamp, { timestamp, open: fill.price, high: fill.price, low: fill.price, close: fill.price, volume: fill.quantity, collateralVolume: quoteCeil(fill.quantity, fill.price), trades: 1 })
  }
  return [...buckets.values()].slice(-limit)
}
