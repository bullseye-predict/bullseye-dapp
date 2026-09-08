import { expect, test } from 'bun:test'
import { buildQuoteIntents, type QuotePolicy } from '../../apps/market-maker'
import { quoteCeil } from '../../apps/matcher'
import { NOW, balance, market, order, position } from './fixtures'

const quotePolicy: QuotePolicy = { quoteShares: 10_000_000n, targetInventoryShares: 20_000_000n, maxInventoryShares: 50_000_000n, halfSpread: 20_000n, inventorySkew: 100_000n }
const quotes = () => ({ account: 'Alice', market: market(), probabilities: new Map([[0, 500_000n], [1, 300_000n], [2, 200_000n]]),
  balance: balance(), positions: [position({ quantity: 30_000_000n })], openOrders: [], now: NOW, expiresAt: NOW + 10_000 })

test('market maker emits actual funded inventory-aware intents without inventing market trades', () => {
  const snapshot = quotes()
  const intents = buildQuoteIntents(snapshot, quotePolicy)
  expect(intents.find((intent) => intent.outcomeId === 0 && intent.side === 'BUY')?.price).toBe(460_000n)
  expect(intents.find((intent) => intent.outcomeId === 0 && intent.side === 'SELL')?.price).toBe(500_000n)
  expect(intents.filter((intent) => intent.side === 'SELL').every((intent) => intent.outcomeId === 0)).toBe(true)
  expect(intents.filter((intent) => intent.side === 'BUY').reduce((sum, intent) => sum + quoteCeil(intent.quantity, intent.price), 0n)).toBeLessThanOrEqual(snapshot.balance.available)
  expect(buildQuoteIntents({ ...snapshot, market: market({ paused: true }) }, quotePolicy)).toEqual([])
  expect(() => buildQuoteIntents({ ...snapshot, probabilities: new Map([[0, 500_000n], [1, 500_000n]]) }, quotePolicy)).toThrow('probability')
})

test('market maker deducts open order reservations and never oversells or spends unreserved collateral twice', () => {
  const snapshot = { ...quotes(), balance: balance({ total: 5n, available: 5n }), positions: [position({ quantity: 10n, reservedQuantity: 6n })],
    openOrders: [order({ side: 'SELL', quantity: 7n })] }
  const intents = buildQuoteIntents(snapshot, quotePolicy)
  expect(intents.find((intent) => intent.side === 'SELL')?.quantity).toBe(3n)
  expect(intents.filter((intent) => intent.side === 'BUY').reduce((sum, intent) => sum + quoteCeil(intent.quantity, intent.price), 0n)).toBeLessThanOrEqual(5n)
})
