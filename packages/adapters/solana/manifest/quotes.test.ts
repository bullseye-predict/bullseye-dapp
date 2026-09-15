import { expect, test } from 'bun:test'
import { binaryBuyQuote, binaryQuotes, complementAsks } from './quotes'
const row = (price: bigint, quantity = 1_000_000n) => ({ price, quantity })
test('88 and 50 YES bids expose 12 and 50 NO asks in price priority', () => {
  const bids = [row(500_000n, 82_000_000n), row(880_000n)]
  expect(complementAsks(bids).map(r => r.price).sort()).toEqual([120_000n, 500_000n])
  const quote = binaryBuyQuote([], bids, 120_000n)
  expect(quote).toEqual({ quantity: 1_000_000n, priceMicros: 120_000n, maximumCost: 120_000n, estimatedCost: 120_000n, route: 'complete-set', upfrontCollateral: 1_000_000n })
})
test('crossed legacy YES 88 NO 60 bids are executable complements, not probabilities', () => {
  const quote = binaryQuotes([], [row(880_000n)], [], [row(600_000n)])
  expect(quote.yes.ask).toBe(400_000n)
  expect(quote.no.ask).toBe(120_000n)
  expect(quote.yes.crossed).toBe(true)
  expect(quote.yes.mid).toBeUndefined()
  expect(quote.no.mid).toBeUndefined()
})
test('normal binary midpoint is complementary while buy prices include the spread', () => {
  const quote = binaryQuotes([], [row(880_000n)], [], [row(100_000n)])
  expect(quote.yes.ask! + quote.no.ask!).toBe(1_020_000n)
  expect(quote.yes.mid! + quote.no.mid!).toBe(1_000_000n)
})
test('use the cheaper route and do not sweep past a better alternative', () => {
  const quote = binaryBuyQuote([row(300_000n, 10_000_000n)], [row(880_000n), row(500_000n, 100_000_000n)], 5_000_000n)
  expect(quote.route).toBe('complete-set')
  expect(quote.quantity).toBe(1_000_000n)
  const direct = binaryBuyQuote([row(100_000n)], [row(880_000n)], 5_000_000n)
  expect(direct.route).toBe('direct')
  expect(direct.priceMicros).toBe(100_000n)
})
test('invalid levels and empty books never manufacture liquidity', () => {
  expect(complementAsks([row(1_000_000n), row(0n), row(-1n), row(500_000n, 0n)])).toEqual([])
  expect(() => binaryBuyQuote([], [], 5_000_000n)).toThrow('No sellers')
})
test('the transform is an involution, so it must be applied exactly once', () => {
  // The panel now draws complementAsks(noBids) as YES asks. That is only safe on a
  // venue with two independent books: where the four sides are four views of one
  // CLOB (DreamDEX derives noBids from yesAsks), complementing again returns the
  // native ladder and would render every level twice at the same price.
  const bids = [row(800_000n, 132_573_900n), row(500_000n)]
  expect(complementAsks(complementAsks(bids))).toEqual(bids)
})
test('a lone NO bid is the YES ask the ladder draws, and implies no midpoint', () => {
  // The observed GENESIS-01 book. The Buy button read 20¢ from this and the ticket
  // filled against it, while the panel reported no asks at all.
  const quote = binaryQuotes([], [], [], [row(800_000n, 132_573_900n)])
  expect(quote.yes.ask).toBe(200_000n)
  expect(quote.yes.bid).toBeUndefined()
  // One executable price is not two, so it brackets nothing and crosses nothing.
  expect(quote.yes.mid).toBeUndefined()
  expect(quote.yes.crossed).toBe(false)
})
