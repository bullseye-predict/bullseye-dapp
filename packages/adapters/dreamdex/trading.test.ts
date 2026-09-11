import { describe, expect, test } from 'bun:test'
import { executionSummary, marketOrderQuote, selfMatchingOrders, type OrderInput } from './trading'
import type { BinaryOrderBook, OnchainOrder } from '@somnia-chain/markets-sdk'

const scale = 1_000_000n
const input: OrderInput = { side: 'BUY_NO', quantity: 20n * scale, outcomePrice: 900_000n, orderType: 2 }
const fills = [{ quantityFilled: 5n * scale, fillPrice: 450_000n }]
const order: OnchainOrder = { orderId: 1n, owner: `0x${'12'.repeat(20)}`, isBid: false, userData: 0n, price: 100_000n, fullQuantity: 10n * scale, quantityRemaining: 10n * scale, expireTimestampNs: 60_000_000_000n }

describe('binary execution and self-match semantics', () => {
  test('market IOC reports immediate fills and cancels remainder; NO cost uses NO price', () => {
    expect(executionSummary(input, '0x01', fills, 6)).toMatchObject({ filled: 5n * scale, collateral: 2_750_000n, resting: 0n, cancelled: 15n * scale })
  })
  test('partially filled limit retains waiting quantity without treating it as holdings', () => {
    expect(executionSummary({ ...input, orderType: 0 }, '0x01', fills, 6)).toMatchObject({ filled: 5n * scale, resting: 15n * scale, cancelled: 0n })
    expect(executionSummary({ ...input, orderType: 0 }, '0x01', [], 6).filled).toBe(0n)
  })
  test('a YES buy can cross an existing NO buy in the shared book', () => {
    expect(selfMatchingOrders([order], { ...input, side: 'BUY_YES', outcomePrice: 100_000n }, 6, 1000)).toEqual([order])
    expect(selfMatchingOrders([order], input, 6, 1000)).toEqual([])
    expect(selfMatchingOrders([order], { ...input, side: 'BUY_YES', outcomePrice: 90_000n }, 6, 1000)).toEqual([])
    expect(selfMatchingOrders([order], { ...input, side: 'BUY_YES', outcomePrice: 100_000n }, 6, 60001)).toEqual([])
  })
  test('stake quotes do not invent shares when the best price has insufficient depth', () => {
    const book = { yesAsks: [{ price: 100_000n, quantity: scale }, { price: 550_000n, quantity: 10n * scale }], yesBids: [], noAsks: [], noBids: [] } as unknown as BinaryOrderBook
    const quote = marketOrderQuote(book, 'BUY_YES', 2n * scale, 6, { tickSize: 10_000n, lotSize: scale, minQuantity: scale })!
    expect(quote.input.quantity).toBe(3n * scale)
    expect(quote.cost).toBe(1_200_000n)
    expect(quote.maxCost).toBeLessThanOrEqual(2n * scale)
    expect(quote.input.outcomePrice).toBe(550_000n)
  })
})
