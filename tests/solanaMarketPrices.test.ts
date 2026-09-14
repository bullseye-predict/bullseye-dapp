import { expect, test } from 'bun:test'
import { appendQuote, outcomeProbability } from '../src/components/home/useSolanaMarketPrices'

test('a two-sided book prices at the mid', () => {
  expect(outcomeProbability({ bid: 450_000n, ask: 550_000n, mid: 500_000n }, 6)).toEqual({ probability: .5, indicative: false })
  expect(outcomeProbability({ bid: 600_000n, ask: 640_000n, mid: 620_000n }, 6).probability).toBe(.62)
})

test('a one-sided book prices from the side that exists rather than falling back to 50/50', () => {
  expect(outcomeProbability({ ask: 700_000n }, 6)).toEqual({ probability: .7, indicative: false })
  expect(outcomeProbability({ bid: 300_000n }, 6)).toEqual({ probability: .3, indicative: false })
})

test('with no resting order at all the last executed trade is used before the placeholder', () => {
  expect(outcomeProbability(undefined, 6, .42)).toEqual({ probability: .42, indicative: false })
})

test('an empty, never-traded book is flagged indicative rather than quoted as 50/50', () => {
  // The ticket has to be able to say this is a placeholder, not an executable
  // quote; the old code made these indistinguishable.
  expect(outcomeProbability(undefined, 6)).toEqual({ probability: .5, indicative: true })
  expect(outcomeProbability({ bid: undefined, ask: undefined }, 6).indicative).toBe(true)
})

test('crossed outcome quotes cannot invent a probability midpoint', () => {
  expect(outcomeProbability({ bid: 880_000n, ask: 400_000n, crossed: true }, 6).indicative).toBe(true)
})

test('prices are clamped into a probability and respect the venue decimals', () => {
  expect(outcomeProbability({ mid: 2_000_000n }, 6).probability).toBe(1)
  expect(outcomeProbability({ mid: 50_000n }, 5).probability).toBe(.5)
})

test('a quote series only grows when the price actually moves', () => {
  // A dormant market polled every ten seconds would otherwise accumulate
  // thousands of identical points a day behind a flat line.
  const first = appendQuote([], 1_000, .5)
  const same = appendQuote(first, 2_000, .5)
  expect(same).toBe(first)
  const moved = appendQuote(same, 3_000, .55)
  expect(moved.map(point => point.probability)).toEqual([.5, .55])
})

test('a quote series stays sorted, deduped by timestamp, and capped', () => {
  const series = appendQuote(appendQuote([{ at: 5_000, probability: .4 }], 1_000, .6), 3_000, .7)
  expect(series.map(point => point.at)).toEqual([1_000, 3_000, 5_000])
  const replaced = appendQuote([{ at: 9, probability: .1 }], 9, .2)
  expect(replaced).toEqual([{ at: 9, probability: .2 }])
  expect(appendQuote(Array.from({ length: 5 }, (_, i) => ({ at: i, probability: i / 10 })), 99, .95, 3)).toHaveLength(3)
})
