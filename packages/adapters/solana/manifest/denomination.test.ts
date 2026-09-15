import { describe, expect, test } from 'bun:test'
import { mergeCandles, yesDenominated } from './history'
import type { Candle } from '../../../prediction-core/market-data'

const candle = (timestamp: number, price: bigint, over: Partial<Candle> = {}): Candle =>
  ({ timestamp, open: price, high: price, low: price, close: price, volume: 1n, collateralVolume: price, trades: 1, ...over })

describe('one market, one price', () => {
  test('a NO fill at 30c is the statement that YES is at 70c', () => {
    expect(yesDenominated([candle(1, 300_000n)], 1)[0]!.close).toBe(700_000n)
    // The YES book needs no translation.
    expect(yesDenominated([candle(1, 300_000n)], 0)[0]!.close).toBe(300_000n)
  })

  test('high and low swap under complement', () => {
    // 1 - high is the low; leaving them in place would report a candle whose
    // low sits above its high.
    const [flipped] = yesDenominated([candle(1, 300_000n, { high: 400_000n, low: 200_000n })], 1)
    expect(flipped!.high).toBe(800_000n)
    expect(flipped!.low).toBe(600_000n)
    expect(flipped!.high).toBeGreaterThan(flipped!.low)
  })

  test('volume is not complemented', () => {
    // Complementing a price says something true about the market; complementing
    // a traded quantity says nothing at all.
    const [flipped] = yesDenominated([candle(1, 300_000n, { volume: 42n })], 1)
    expect(flipped!.volume).toBe(42n)
  })

  test('it agrees with the Somnia adapter, which has always done this', () => {
    // packages/adapters/dreamdex/browser.ts: `if (outcome === 1) price = scale - price`.
    // The two venues must not drift on what a NO fill means.
    const scale = 1_000_000n
    for (const price of [0n, 1n, 185_000n, 500_000n, 999_999n, scale]) {
      expect(yesDenominated([candle(1, price)], 1)[0]!.close).toBe(scale - price)
    }
  })

  test('both books merge into one chronological series', () => {
    const yes = [candle(1_000, 600_000n), candle(3_000, 620_000n)]
    const no = [candle(2_000, 300_000n)]
    const merged = mergeCandles(yes, yesDenominated(no, 1))
    expect(merged.map(c => c.timestamp)).toEqual([1_000, 2_000, 3_000])
    // The NO trade lands as a YES price, in sequence with the YES trades.
    expect(merged.map(c => c.close)).toEqual([600_000n, 700_000n, 620_000n])
  })

  test('simultaneous fills keep argument order rather than inventing a sequence', () => {
    // blockTime is second-granular against ~400ms slots, so two fills sharing a
    // timestamp are genuinely simultaneous — there is no true order to recover.
    const merged = mergeCandles([candle(5_000, 100_000n)], [candle(5_000, 900_000n)])
    expect(merged.map(c => c.close)).toEqual([100_000n, 900_000n])
  })
})
