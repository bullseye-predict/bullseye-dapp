import { expect, test } from 'bun:test'
import { nextSell, planSellInventory, quoteSell, type ClaimCustody } from '../packages/adapters/solana/manifest/inventory'

const custody = (over: Partial<ClaimCustody> = {}): ClaimCustody =>
  ({ venueAvailableClaims: 0n, venueReservedClaims: 0n, walletClaims: 0n, internalClaims: 0n, ...over })

test('shares already on the seat need no movement at all', () => {
  expect(planSellInventory(custody({ venueAvailableClaims: 5_000_000n }), 3_000_000n))
    .toEqual({ ready: 3_000_000n, exportAtoms: 0n, depositAtoms: 0n, shortfall: 0n, sellable: 5_000_000n })
})

test('wallet claims are deposited, position claims are exported first', () => {
  // The complete-set buy route leaves the bought outcome in the position PDA,
  // so this is the ordinary case after buying — not an edge case.
  expect(planSellInventory(custody({ internalClaims: 4_000_000n }), 4_000_000n))
    .toEqual({ ready: 0n, exportAtoms: 4_000_000n, depositAtoms: 4_000_000n, shortfall: 0n, sellable: 4_000_000n })
  expect(planSellInventory(custody({ walletClaims: 4_000_000n }), 4_000_000n))
    .toEqual({ ready: 0n, exportAtoms: 0n, depositAtoms: 4_000_000n, shortfall: 0n, sellable: 4_000_000n })
})

test('the cheapest custody is spent first and the rest is topped up', () => {
  const plan = planSellInventory(custody({ venueAvailableClaims: 1_000_000n, walletClaims: 2_000_000n, internalClaims: 5_000_000n }), 6_000_000n)
  expect(plan).toEqual({ ready: 1_000_000n, exportAtoms: 3_000_000n, depositAtoms: 5_000_000n, shortfall: 0n, sellable: 8_000_000n })
})

test('reserved claims are never counted: they already back a resting ask', () => {
  const plan = planSellInventory(custody({ venueReservedClaims: 9_000_000n, walletClaims: 1_000_000n }), 4_000_000n)
  expect(plan.sellable).toBe(1_000_000n)
  expect(plan.shortfall).toBe(3_000_000n)
})

test('an unbacked quantity reports the shortfall rather than planning a phantom move', () => {
  const plan = planSellInventory(custody({ internalClaims: 1_000_000n }), 5_000_000n)
  expect(plan.shortfall).toBe(4_000_000n)
  expect(plan.exportAtoms).toBe(1_000_000n)
})

test('a non-positive quantity is rejected outright', () => {
  expect(() => planSellInventory(custody(), 0n)).toThrow()
})

test('a sell fills at the best bid, not at its own limit', () => {
  // A limit is a floor for a sell, exactly as it is a ceiling for a buy.
  const quote = nextSell([{ price: 300_000n, quantity: 5_000_000n }, { price: 700_000n, quantity: 2_000_000n }], 2_000_000n, 200_000n)
  expect(quote).toEqual({ quantity: 2_000_000n, price: 700_000n, estimatedProceeds: 1_400_000n })
})

test('a sell walks down to its limit and reports the worst level it consumed', () => {
  const quote = nextSell([{ price: 700_000n, quantity: 1_000_000n }, { price: 600_000n, quantity: 1_000_000n }, { price: 100_000n, quantity: 9_000_000n }], 2_000_000n, 500_000n)
  expect(quote).toEqual({ quantity: 2_000_000n, price: 600_000n, estimatedProceeds: 1_200_000n })
})

test('bids below the limit are not touched, and an empty ladder quotes nothing', () => {
  expect(nextSell([{ price: 100_000n, quantity: 9_000_000n }], 1_000_000n, 500_000n)).toBeNull()
  expect(nextSell([], 1_000_000n, 1n)).toBeNull()
})

test('an offer resting under the trader\'s own bid names that bid instead of resting', () => {
  // The screenshot case: 3 YES held, own bids at 80¢ and 60¢, nobody else on
  // the book, offered at 74¢. On chain this fills at 80¢ against the trader's
  // own order and the guard rejects the transaction as Custom(8100).
  const own = [{ price: 800_000n, quantity: 2_000_000n, own: true }, { price: 600_000n, quantity: 8_000_000n, own: true }]
  const { match, crossing } = quoteSell(own, 3_000_000n, 740_000n)
  expect(match).toBeNull()
  expect(crossing).toBe(800_000n)
})

test('an offer priced above every own bid rests untouched', () => {
  const own = [{ price: 800_000n, quantity: 2_000_000n, own: true }]
  expect(quoteSell(own, 3_000_000n, 810_000n)).toEqual({ match: null, crossing: undefined })
})

test('an own bid better than the level an IOC walks to is still consumed first', () => {
  // The sell is quoted against the 500000 level, so the resting 900000 own bid
  // is hit on the way down even though the trader's typed limit is below it.
  const resting = [{ price: 900_000n, quantity: 1_000_000n, own: true }, { price: 500_000n, quantity: 4_000_000n, own: false }]
  const { match, crossing } = quoteSell(resting, 2_000_000n, 100_000n)
  expect(match?.price).toBe(500_000n)
  expect(crossing).toBe(900_000n)
})

test('own bids strictly below the executed price do not block the sell', () => {
  const resting = [{ price: 300_000n, quantity: 9_000_000n, own: true }, { price: 700_000n, quantity: 4_000_000n, own: false }]
  const { match, crossing } = quoteSell(resting, 2_000_000n, 100_000n)
  expect(match).toEqual({ quantity: 2_000_000n, price: 700_000n, estimatedProceeds: 1_400_000n })
  expect(crossing).toBeUndefined()
})

test('the trader\'s own bids never count as the liquidity being sold into', () => {
  const resting = [{ price: 700_000n, quantity: 9_000_000n, own: true }]
  expect(quoteSell(resting, 2_000_000n, 700_000n).match).toBeNull()
})
