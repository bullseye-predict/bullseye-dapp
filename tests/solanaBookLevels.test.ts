import { expect, test } from 'bun:test'
import { bookQuote, levels } from '../src/components/home/venue/useSolanaMarket'

/** Raw Manifest resting prices are a 1e18 fixed point of quote atoms per base
 *  atom; the book renders collateral atoms, which is raw / 1e12. */
const raw = (collateralAtoms: bigint) => collateralAtoms * 10n ** 12n
const order = (price: bigint, quantity: bigint) => ({ price: raw(price), numBaseAtoms: quantity })

test('orders resting at one price collapse into a single aggregated level', () => {
  const rows = levels([order(500_000n, 10_000_000n), order(500_000n, 2_000_000n), order(500_000n, 6_000_000n)])
  expect(rows).toEqual([{ price: 500_000n, quantity: 18_000_000n }])
})

test('two raw prices that truncate to the same rendered price merge rather than colliding', () => {
  // Both land on 500_000 collateral atoms, so they must not become two rows
  // sharing one React key in the order book table.
  const rows = levels([{ price: raw(500_000n) + 1n, numBaseAtoms: 4_000_000n }, { price: raw(500_000n) + 999n, numBaseAtoms: 1_000_000n }])
  expect(rows).toEqual([{ price: 500_000n, quantity: 5_000_000n }])
  expect(new Set(rows.map(row => row.price.toString())).size).toBe(rows.length)
})

test('distinct prices stay distinct and keep their own size', () => {
  const rows = levels([order(600_000n, 5_000_000n), order(500_000n, 2_000_000n), order(600_000n, 1_000_000n)])
  expect(rows.sort((a, b) => Number(a.price - b.price))).toEqual([
    { price: 500_000n, quantity: 2_000_000n },
    { price: 600_000n, quantity: 6_000_000n },
  ])
})

test('an empty book produces no levels and no quote', () => {
  expect(levels([])).toEqual([])
  expect(bookQuote([], [])).toEqual({ bid: undefined, ask: undefined })
})

test('best ask is the minimum and best bid the maximum, whatever order the SDK returns them in', () => {
  // Manifest returns bids()/asks() least-competitive first, and levels() does
  // not sort, so indexing [0] would take the worst price on both sides.
  const asks = [{ price: 700_000n, quantity: 1n }, { price: 550_000n, quantity: 1n }, { price: 900_000n, quantity: 1n }]
  const bids = [{ price: 300_000n, quantity: 1n }, { price: 450_000n, quantity: 1n }, { price: 100_000n, quantity: 1n }]
  expect(bookQuote(asks, bids)).toEqual({ ask: 550_000n, bid: 450_000n, mid: 500_000n })
})

test('a one-sided book quotes that side alone and never invents a mid', () => {
  expect(bookQuote([{ price: 550_000n, quantity: 1n }], [])).toEqual({ ask: 550_000n, bid: undefined })
  expect(bookQuote([], [{ price: 450_000n, quantity: 1n }])).toEqual({ ask: undefined, bid: 450_000n })
  expect(bookQuote([{ price: 550_000n, quantity: 1n }], []).mid).toBeUndefined()
})
