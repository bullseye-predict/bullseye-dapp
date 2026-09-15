import { describe, expect, test } from 'bun:test'
import { complementPrice, marketPrice, MID_SPREAD_LIMIT, priceFraction, priceMicros } from './pricing'
import { PRICE_SCALE } from './types'

const c = (cents: number) => BigInt(Math.round(cents * 10_000))   // 62 -> 620_000

describe("Polymarket's price rule", () => {
  test('a spread of exactly 10c still reads the midpoint', () => {
    // The boundary is inclusive: <= 10c, not < 10c. 45/55 is the case the
    // Solana producer's own test already pins, so the two must agree.
    expect(marketPrice({ bid: c(45), ask: c(55) })).toEqual({ value: c(50), basis: 'MIDPOINT' })
    expect(c(55) - c(45)).toBe(MID_SPREAD_LIMIT)
  })

  test('a wider spread takes the last trade over the midpoint', () => {
    // 40/60 is 20c apart. The midpoint says 50c; a trade actually happened at
    // 62c, and that is the price somebody paid.
    expect(marketPrice({ bid: c(40), ask: c(60) }, c(62))).toEqual({ value: c(62), basis: 'LAST_TRADE' })
  })

  test('a wide spread with no trade is still a price, but a weaker one', () => {
    // Two real resting orders bracket it, just loosely. Declining to price a
    // book that is actively quoting both sides would be worse; saying so with
    // the same confidence as a tight midpoint would also be worse.
    expect(marketPrice({ bid: c(40), ask: c(60) })).toEqual({ value: c(50), basis: 'WIDE_MIDPOINT' })
  })

  test("the venue's consolidated midpoint beats re-deriving one from bid and ask", () => {
    // binaryQuotes consolidates both books before averaging: its best bid is
    // max(yesBids ∪ complementAsks(noAsks)), which can beat the YES book's own
    // best bid. Here the NO book implies a 48c YES bid that `bid` cannot see,
    // so the honest midpoint is 51c, not the 45c a naive average would give.
    expect(marketPrice({ bid: c(30), ask: c(60), mid: c(51) })?.value).toBe(c(51))
  })

  test('a midpoint with no visible sides is still a midpoint', () => {
    // A venue only publishes `mid` for an uncrossed, two-sided consolidated
    // book — exactly the condition a midpoint requires. Its width is unknown,
    // so the 10c gate cannot be applied and must not be assumed failed.
    expect(marketPrice({ mid: c(50) })).toEqual({ value: c(50), basis: 'MIDPOINT' })
  })

  test('a crossed book has no midpoint, but an executed trade still stands', () => {
    const crossed = { bid: c(70), ask: c(30), crossed: true }
    expect(marketPrice(crossed)).toBeUndefined()
    expect(marketPrice(crossed, c(55))).toEqual({ value: c(55), basis: 'LAST_TRADE' })
  })

  test('one resting side prices the book when nothing has traded', () => {
    // The venue consolidates both books first, so a NO ask at 30c reaches this
    // as a YES bid at 70c.
    expect(marketPrice({ bid: c(70) })).toEqual({ value: c(70), basis: 'BID' })
    expect(marketPrice({ ask: c(50) })).toEqual({ value: c(50), basis: 'ASK' })
  })

  test('the last trade beats a lone resting bid', () => {
    // Ordering regression: reading the lone bid would price the market at what
    // the most patient buyer hopes for, not at what it trades at.
    expect(marketPrice({ bid: c(40) }, c(62))).toEqual({ value: c(62), basis: 'LAST_TRADE' })
  })

  test('no evidence is undefined, never a coin flip', () => {
    // An unopened book is not 50/50; rendering one as 50% invents a market.
    expect(marketPrice(undefined)).toBeUndefined()
    expect(marketPrice({})).toBeUndefined()
    expect(marketPrice(null)).toBeUndefined()
  })

  test('prices are clamped into the unit interval', () => {
    expect(marketPrice({ bid: -5n, ask: -5n })?.value).toBe(0n)
    expect(marketPrice({ bid: PRICE_SCALE * 2n, ask: PRICE_SCALE * 2n })?.value).toBe(PRICE_SCALE)
  })
})

describe('scale conversion', () => {
  test('a fraction round-trips through micros at the chain’s own precision', () => {
    for (const value of [0, .0001, .12, .185, .5, .62, .875, 1]) {
      expect(priceFraction(priceMicros(value))).toBeCloseTo(value, 6)
    }
  })

  test('NO is the complement of one price, not a second measurement', () => {
    expect(complementPrice(c(30))).toBe(c(70))
    expect(complementPrice(complementPrice(c(18.5)))).toBe(c(18.5))
  })
})
