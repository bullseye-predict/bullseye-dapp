import { expect, test } from 'bun:test'
import { chanceText, normalisedChances, referencePrice } from '../src/components/markets/chance'
import type { ArenaMarketOutcome } from '../src/components/solz/model'

const outcome = (over: Partial<ArenaMarketOutcome> = {}): ArenaMarketOutcome =>
  ({ id: 'o', label: 'O', detail: '', probability: .5, indicative: true, priceHistory: [], ...over })

test('a reference price needs a two-sided midpoint, a trade, or nothing', () => {
  // Both sides quoted: the midpoint brackets a real price.
  expect(referencePrice(outcome({ marketQuote: { bid: .4, ask: .6, mid: .5 }, indicative: false }))).toBe(.5)
  // A crossed book has no midpoint to read.
  expect(referencePrice(outcome({ marketQuote: { bid: .7, ask: .3, mid: .5, crossed: true }, indicative: false }))).toBeUndefined()
  // Last executed YES price is the fallback.
  expect(referencePrice(outcome({ marketQuote: { bid: .4 }, priceHistory: [{ at: 1, probability: .62 }], indicative: false }))).toBe(.62)
  // A one-sided resting quote is still a price traders are acting on. The
  // venue consolidates both books first, so a NO ask arrives here as a YES bid.
  expect(referencePrice(outcome({ marketQuote: { bid: .7 } }))).toBe(.7)
  expect(referencePrice(outcome({ marketQuote: { ask: .5 } }))).toBe(.5)
  // An unopened book is not a 50/50.
  expect(referencePrice(outcome())).toBeUndefined()
  expect(referencePrice(undefined)).toBeUndefined()
})

test('chances normalise across the whole field and total 100%', () => {
  const priced = (mid: number) => outcome({ marketQuote: { bid: mid, ask: mid, mid }, indicative: false })
  // The spec's worked example: 50/50/88/70/60 raw -> 318 total.
  const chances = normalisedChances([priced(.50), priced(.50), priced(.88), priced(.70), priced(.60)])
  expect(chances.map((chance) => chanceText(chance))).toEqual(['16%', '16%', '28%', '22%', '19%'])
  const total = chances.reduce<number>((sum, chance) => sum + (chance ?? 0), 0)
  expect(total).toBeCloseTo(1, 10)
})

test('an answer with no market sits out the distribution instead of reading 0%', () => {
  const priced = (mid: number) => outcome({ marketQuote: { bid: mid, ask: mid, mid }, indicative: false })
  // The two that trade are normalised against each other; the one with no book
  // at all shows the placeholder, which is not the same claim as "impossible".
  const chances = normalisedChances([priced(.5), priced(.7), outcome()])
  expect(chances.map(chanceText)).toEqual(['42%', '58%', '--'])
  expect(chances[2]).toBeUndefined()
})

test('a field with fewer than two priced answers has no distribution', () => {
  const priced = (mid: number) => outcome({ marketQuote: { bid: mid, ask: mid, mid }, indicative: false })
  // One answer would normalise to a meaningless 100%.
  expect(normalisedChances([priced(.5), outcome(), outcome()]).map(chanceText)).toEqual(['--', '--', '--'])
})

test('a one-sided book prices the answer even with no YES ask to buy', () => {
  // GENESIS-02 on the live event: Buy YES --, Buy NO 50c. There is nothing to
  // hit on the YES side, but the resting NO ask consolidates to a YES bid at
  // 50c — a real market price, and so a real implied chance.
  const genesis02 = outcome({ marketQuote: { ask: undefined, bid: .5 } })
  expect(referencePrice(genesis02)).toBe(.5)
  // An answer nobody has opened a book on is still unpriced.
  expect(referencePrice(outcome({ marketQuote: undefined }))).toBeUndefined()
})

test('rounding is display only, and never rounds a live chance to zero', () => {
  expect(chanceText(.004)).toBe('<1%')
  expect(chanceText(0)).toBe('0%')
  expect(chanceText(.155)).toBe('16%')
  expect(chanceText(undefined)).toBe('--')
  // Full precision is kept in the value the label was made from.
  const chances = normalisedChances([1, 2, 3].map((n) => outcome({ marketQuote: { bid: n / 10, ask: n / 10, mid: n / 10 }, indicative: false })))
  expect(chances[0]).toBeCloseTo(1 / 6, 12)
})

test('a market with its own probability and no book still places in a field', () => {
  // Arena and simulated markets state a probability directly and have no venue
  // quote; only the 50/50 order-entry seed is excluded.
  const arena = (probability: number) => outcome({ probability, indicative: false, marketQuote: undefined })
  expect(normalisedChances([arena(.25), arena(.75)]).map(chanceText)).toEqual(['25%', '75%'])
  expect(normalisedChances([arena(.25), outcome()]).map(chanceText)).toEqual(['--', '--'])
})
