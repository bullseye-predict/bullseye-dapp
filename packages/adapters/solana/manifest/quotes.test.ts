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
