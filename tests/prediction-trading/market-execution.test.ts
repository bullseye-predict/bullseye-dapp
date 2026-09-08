import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { InMemoryMatcherStore, MatchingEngine, type SettlementTransport } from '../../apps/matcher'
import { bindMarketExecutionQuote, parseMarketExecutionRequest, parseMarketQuoteRequest, type MarketExecutionQuote, type MarketExecutionRequest } from '../../packages/prediction-core/execution'
import type { SignedOrder } from '../../packages/prediction-core/types'
import { NOW, market, scope, signedOrder } from './fixtures'
import { PredictionDatabase } from '../../apps/api/storage/database'
import { SqliteMatcherStore } from '../../apps/api/storage/matcher-store'

async function setup() {
  const store = new InMemoryMatcherStore()
  let now = NOW
  const options = { store, verifier: { verify: async (order: Readonly<SignedOrder>) => order.signature === 'signed' }, now: () => now }
  const engine = new MatchingEngine(options)
  await engine.registerMarket(market())
  const confirmed: SettlementTransport = {
    submit: async (plan) => ({ status: 'CONFIRMED', txHash: `tx:${plan.id}`, confirmedAt: now }),
    lookup: async (plan) => ({ status: 'CONFIRMED', txHash: `tx:${plan.id}`, confirmedAt: now }),
  }
  return { store, engine, confirmed, restart: () => new MatchingEngine(options), advance: (milliseconds: number) => { now += milliseconds } }
}

function signQuote(quote: MarketExecutionQuote, prefix = 'child'): MarketExecutionRequest {
  return {
    intent: { type: 'MARKET_IOC', quoteId: quote.id, quoteHash: quote.quoteHash, childrenHash: quote.childrenHash },
    orders: quote.children.map((child, index) => ({ ...child.order, orderId: `${prefix}-${index}`, nonce: BigInt(index), signature: 'signed' })),
  }
}

async function rejection(promise: Promise<unknown>, contains: string) {
  const outcome = await promise.then(() => undefined, (error: unknown) => error)
  expect(outcome).toBeInstanceOf(Error)
  expect((outcome as Error).message).toContain(contains)
}

describe('authenticated off-chain market execution', () => {
  test('BUY quote consumes real ask depth within slippage and reserves no liquidity until execution', async () => {
    const { engine } = await setup()
    for (const [id, price] of [['ask-1', 400_000n], ['ask-2', 500_000n], ['ask-3', 700_000n]] as const) {
      await engine.submitOrder(signedOrder({ orderId: id, maker: id, side: 'SELL', price, quantity: 6_000_000n }))
    }
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 15_000_000n, slippageBps: 2500 })
    expect(quote.children.map((child) => child.price)).toEqual([400_000n, 500_000n])
    expect(quote.executableQuantity).toBe(12_000_000n)
    expect(quote.unfilledQuantity).toBe(3_000_000n)
    expect(quote.estimatedCollateral).toBe(5_400_000n)
    expect(quote.averagePrice).toBe(450_000n)
    expect(quote.limitPrice).toBe(500_000n)
    expect(quote.partialReasons).toContain('SLIPPAGE_LIMIT')
    expect(quote.executionGuarantee).toBe('OFFCHAIN_IOC_ONLY')
    expect((await engine.getOrderBook(scope)).outcomes[0]?.asks).toHaveLength(3)
    expect(await engine.getOrders(scope)).toHaveLength(3)
    const execution = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    expect(execution.status).toBe('RESERVED')
    expect(execution.pendingQuantity).toBe(12_000_000n)
    expect(execution.filledQuantity).toBe(0n)
    expect(execution.cancelledQuantity).toBe(3_000_000n)
    expect(execution.settlementIds).toHaveLength(2)
    expect((await engine.getOrderBook(scope)).outcomes[0]?.bids).toEqual([])
    expect((await engine.getOrderBook(scope)).outcomes[0]?.asks.map((level) => level.price)).toEqual([700_000n])
    expect((await engine.getOrders(scope)).filter((order) => execution.orderIds.includes(order.orderId)).every((order) => order.status === 'CANCELLED' && order.filled === 0n)).toBe(true)
    expect(await engine.getFills(scope)).toHaveLength(0)
    expect(await engine.planNext(scope)).toBeUndefined()
  })

  test('SELL children preserve each resting bid price rather than pretending every fill pays the best bid', async () => {
    const { engine, confirmed } = await setup()
    for (const [id, price] of [['bid-1', 700_000n], ['bid-2', 600_000n], ['bid-3', 400_000n]] as const) {
      await engine.submitOrder(signedOrder({ orderId: id, maker: id, price, quantity: 6_000_000n }))
    }
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'SELL', quantity: 15_000_000n, slippageBps: 2000 })
    expect(quote.children.map((child) => child.order.price)).toEqual([700_000n, 600_000n])
    expect(quote.estimatedCollateral).toBe(7_800_000n)
    expect(quote.averagePrice).toBe(650_000n)
    const execution = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    const plans = (await engine.getSettlements(scope)).filter((plan) => plan.executionId === execution.id)
    expect(plans.map((plan) => plan.price)).toEqual([700_000n, 600_000n])
    for (const id of execution.settlementIds) await engine.settle(scope, id, confirmed)
    const final = await engine.getExecution(scope, execution.id, 'alice')
    expect(final.status).toBe('PARTIALLY_FILLED')
    expect(final.filledQuantity).toBe(12_000_000n)
    expect(final.cancelledQuantity).toBe(3_000_000n)
    expect(final.confirmedCollateral).toBe(7_800_000n)
    expect(final.pendingQuantity).toBe(0n)
    expect((await engine.getOrderBook(scope)).outcomes[0]?.asks).toEqual([])
  })

  test('fresh execution sees changed depth and cancels the unmatched signed remainder without resting it', async () => {
    const { engine, confirmed } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'old-ask', maker: 'Seller', side: 'SELL', price: 500_000n, quantity: 10_000_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 1000 })
    await engine.cancelOrder(scope, 'old-ask', 'Seller')
    await engine.submitOrder(signedOrder({ orderId: 'new-ask', maker: 'OtherSeller', side: 'SELL', price: 490_000n, quantity: 4_000_000n }))
    const execution = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    expect(execution.plannedQuantity).toBe(4_000_000n)
    expect(execution.plannedCollateral).toBe(1_960_000n)
    expect(execution.cancelledQuantity).toBe(6_000_000n)
    expect(execution.partialReasons).toContain('BOOK_CHANGED')
    await engine.settle(scope, execution.settlementIds[0]!, confirmed)
    await engine.submitOrder(signedOrder({ orderId: 'late-ask', maker: 'LateSeller', side: 'SELL', price: 400_000n, quantity: 6_000_000n }))
    expect(await engine.planNext(scope)).toBeUndefined()
    expect((await engine.getExecution(scope, execution.id, 'Alice')).filledQuantity).toBe(4_000_000n)
    expect((await engine.getOrders(scope)).find((order) => order.orderId === execution.orderIds[0])?.status).toBe('CANCELLED')
  })

  test('quote/account/hash/child binding rejects altered side, price, quantity, expiry and maker before mutation', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 100 })
    await rejection(engine.executeMarketOrder(scope, signQuote(quote), 'Mallory'), 'account quote')
    const alteredIntent = signQuote(quote)
    alteredIntent.intent.childrenHash = `0x${'0'.repeat(64)}`
    await rejection(engine.executeMarketOrder(scope, alteredIntent, 'Alice'), 'binding mismatch')
    for (const alteration of [{ price: 550_000n }, { quantity: 11_000_000n }, { side: 'SELL' as const }, { expiresAt: quote.orderExpiresAt + 1000 },
      { maker: 'Mallory' }, { chainId: 'other' }, { marketId: 'other' }, { outcomeId: 1 }]) {
      const request = signQuote(quote)
      Object.assign(request.orders[0]!, alteration)
      await rejection(engine.executeMarketOrder(scope, request, 'Alice'), 'differ from authenticated quote')
    }
    const forged = signQuote(quote)
    forged.orders[0]!.signature = 'forged'
    await rejection(engine.executeMarketOrder(scope, forged, 'Alice'), 'authorization')
    expect(await engine.getOrders(scope)).toHaveLength(1)
    expect(await engine.getSettlements(scope)).toHaveLength(0)
    expect(await engine.getExecutions(scope, 'Alice')).toEqual([])
    const otherAccount = await bindMarketExecutionQuote({ ...quote, account: 'Mallory' })
    expect(otherAccount.quoteHash).not.toBe(quote.quoteHash)
  })

  test('all child signatures are validated before any admission; partial matching remains allowed', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask-1', maker: 'S1', side: 'SELL', price: 400_000n, quantity: 5_000_000n }))
    await engine.submitOrder(signedOrder({ orderId: 'ask-2', maker: 'S2', side: 'SELL', price: 500_000n, quantity: 5_000_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 12_000_000n, slippageBps: 2500 })
    const invalid = signQuote(quote)
    invalid.orders[1]!.signature = 'forged'
    await rejection(engine.executeMarketOrder(scope, invalid, 'Alice'), 'authorization')
    expect(await engine.getOrders(scope)).toHaveLength(2)
    const accepted = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    expect(accepted.pendingQuantity).toBe(10_000_000n)
    expect(accepted.cancelledQuantity).toBe(2_000_000n)
  })

  test('competing executions reserve current depth atomically, and repeated requests are idempotent', async () => {
    const { engine, restart } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const alice = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const bob = await engine.quoteMarketOrder(scope, { account: 'Bob', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const [first, second] = await Promise.all([engine.executeMarketOrder(scope, signQuote(alice, 'alice'), 'Alice'), restart().executeMarketOrder(scope, signQuote(bob, 'bob'), 'Bob')])
    expect(first.pendingQuantity + second.pendingQuantity).toBe(10_000_000n)
    expect([first.status, second.status].sort()).toEqual(['CANCELLED', 'RESERVED'])
    const duplicate = await Promise.all([restart().executeMarketOrder(scope, signQuote(alice, 'alice'), 'Alice'), engine.executeMarketOrder(scope, signQuote(alice, 'alice'), 'Alice')])
    expect(duplicate.every((entry) => entry.id === first.id)).toBe(true)
    expect(await engine.getSettlements(scope)).toHaveLength(1)
    await rejection(engine.executeMarketOrder(scope, signQuote(alice, 'different'), 'Alice'), 'already executed')
  })

  test('fills and proceeds stay zero through ambiguous submission, then recover exactly once after restart', async () => {
    const { engine, restart, advance, confirmed } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const request = signQuote(quote)
    const execution = await engine.executeMarketOrder(scope, request, 'Alice')
    let submitted = 0
    const ambiguous: SettlementTransport = { submit: async () => { submitted++; throw new Error('Broadcast reply lost') }, lookup: async () => ({ status: 'UNKNOWN' }) }
    await engine.settle(scope, execution.settlementIds[0]!, ambiguous)
    const pending = await engine.getExecution(scope, execution.id, 'Alice')
    expect(pending.status).toBe('PENDING')
    expect(pending.filledQuantity).toBe(0n)
    expect(pending.confirmedCollateral).toBe(0n)
    advance(31_000)
    const recovered = restart()
    const idempotent = await recovered.executeMarketOrder(scope, request, 'Alice')
    expect(idempotent.id).toBe(execution.id)
    expect(idempotent.pendingQuantity).toBe(10_000_000n)
    await recovered.settle(scope, execution.settlementIds[0]!, ambiguous)
    expect(submitted).toBe(1)
    await recovered.reconcile(scope, execution.settlementIds[0]!, confirmed)
    await recovered.reconcile(scope, execution.settlementIds[0]!, confirmed)
    expect((await recovered.getExecution(scope, execution.id, 'Alice'))).toMatchObject({ status: 'FILLED', filledQuantity: 10_000_000n, confirmedCollateral: 5_000_000n, pendingQuantity: 0n })
    expect(await recovered.getFills(scope)).toHaveLength(1)
  })

  test('execution cancellation stops unsubmitted children and keeps broadcast reservations until confirmation', async () => {
    const { engine, confirmed } = await setup()
    for (const [id, price] of [['ask-1', 400_000n], ['ask-2', 500_000n]] as const) {
      await engine.submitOrder(signedOrder({ orderId: id, maker: id, side: 'SELL', price, quantity: 5_000_000n }))
    }
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 2500 })
    const execution = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    await engine.settle(scope, execution.settlementIds[0]!, { ...confirmed, submit: async () => ({ status: 'PENDING', txHash: 'pending' }) })
    await rejection(engine.cancelExecution(scope, execution.id, 'Mallory'), 'account execution')
    const cancellation = await engine.cancelExecution(scope, execution.id, 'Alice')
    expect(cancellation.status).toBe('PENDING')
    expect(cancellation.pendingQuantity).toBe(5_000_000n)
    expect(cancellation.cancelledQuantity).toBe(5_000_000n)
    let submitted = false
    await engine.settle(scope, execution.settlementIds[1]!, { ...confirmed, submit: async () => { submitted = true; throw new Error() } })
    expect(submitted).toBe(false)
    await engine.reconcile(scope, execution.settlementIds[0]!, confirmed)
    expect((await engine.getExecution(scope, execution.id, 'Alice')).status).toBe('PARTIALLY_FILLED')
    expect(await engine.planNext(scope)).toBeUndefined()
  })

  test('cancel-all includes IOC children with closed remainders, and failed fills never re-rest', async () => {
    const { engine, confirmed } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const execution = await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    expect(await engine.cancelAllOrders(scope, 'Alice')).toHaveLength(1)
    expect((await engine.getExecution(scope, execution.id, 'Alice')).status).toBe('CANCELLED')
    await engine.settle(scope, execution.settlementIds[0]!, confirmed)
    expect(await engine.getFills(scope)).toHaveLength(0)
    expect(await engine.planNext(scope)).toBeUndefined()
    const again = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const request = signQuote(again, 'new')
    request.orders[0]!.nonce = 9n
    const other = await engine.executeMarketOrder(scope, request, 'Alice')
    await engine.settle(scope, other.settlementIds[0]!, { ...confirmed, submit: async () => ({ status: 'FAILED', reason: 'Finalized insufficient allowance' }) })
    expect((await engine.getExecution(scope, other.id, 'Alice')).status).toBe('FAILED')
    expect((await engine.getExecution(scope, other.id, 'Alice')).cancelledQuantity).toBe(10_000_000n)
    expect(await engine.planNext(scope)).toBeUndefined()
  })

  test('short signed expiries and quote deadlines prevent late new execution or stale planned broadcast', async () => {
    const { engine, advance, confirmed } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    expect(quote.orderExpiresAt - quote.createdAt).toBeLessThanOrEqual(30_000)
    expect(quote.orderExpiresAt % 1000).toBe(0)
    advance(10_001)
    await rejection(engine.executeMarketOrder(scope, signQuote(quote), 'Alice'), 'quote expired')
    const fresh = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    const execution = await engine.executeMarketOrder(scope, signQuote(fresh), 'Alice')
    advance(30_000)
    expect((await engine.getExecution(scope, execution.id, 'Alice')).partialReasons).toContain('ORDER_EXPIRED')
    let submitted = false
    await engine.settle(scope, execution.settlementIds[0]!, { ...confirmed, submit: async () => { submitted = true; throw new Error() } })
    expect(submitted).toBe(false)
    expect((await engine.getExecution(scope, execution.id, 'Alice')).cancelledQuantity).toBe(10_000_000n)
  })

  test('quotes use individual maker rounding and conservative integer slippage boundaries', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'dust-a', maker: 'S1', side: 'SELL', price: 500_000n, quantity: 1n }))
    await engine.submitOrder(signedOrder({ orderId: 'dust-b', maker: 'S2', side: 'SELL', price: 500_000n, quantity: 1n }))
    const dust = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 2n, slippageBps: 0 })
    expect(dust.executableQuantity).toBe(0n)
    expect(dust.estimatedCollateral).toBe(0n)
    expect(dust.partialReasons).toContain('ROUNDING_DUST')
    expect((await engine.executeMarketOrder(scope, signQuote(dust), 'Alice')).status).toBe('CANCELLED')
    expect(await engine.getFills(scope)).toHaveLength(0)

    const low = await setup()
    await low.engine.submitOrder(signedOrder({ orderId: 'low', maker: 'S1', side: 'SELL', price: 1n, quantity: 1_000_000n }))
    await low.engine.submitOrder(signedOrder({ orderId: 'too-high', maker: 'S2', side: 'SELL', price: 2n, quantity: 1_000_000n }))
    const constrained = await low.engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 2_000_000n, slippageBps: 500 })
    expect(constrained.limitPrice).toBe(1n)
    expect(constrained.executableQuantity).toBe(1_000_000n)
  })

  test('quotes exclude self liquidity and isolate outcomes', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'self', maker: 'ALICE', side: 'SELL', price: 100_000n }))
    await engine.submitOrder(signedOrder({ orderId: 'other-outcome', maker: 'Seller', outcomeId: 1, side: 'SELL', price: 100_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 5000 })
    expect(quote.children).toEqual([])
    expect(quote.bestPrice).toBeNull()
    expect(quote.partialReasons).toEqual(['NO_LIQUIDITY'])
  })

  test('price-level child count and settlement fanout are bounded with explicit partial reasons', async () => {
    const { engine } = await setup()
    for (let index = 0; index < 20; index++) await engine.submitOrder(signedOrder({ orderId: `level-${index}`, maker: `Seller-${index}`, side: 'SELL', price: 500_000n + BigInt(index), quantity: 1_000_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 20_000_000n, slippageBps: 10_000 })
    expect(quote.children).toHaveLength(16)
    expect(quote.partialReasons).toContain('CHILD_LIMIT')
    expect(quote.unfilledQuantity).toBe(4_000_000n)

    const crowded = await setup()
    for (let index = 0; index < 70; index++) await crowded.engine.submitOrder(signedOrder({ orderId: `maker-${index}`, maker: `Seller-${index}`, side: 'SELL', price: 500_000n, quantity: 1_000_000n }))
    const bounded = await crowded.engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 70_000_000n, slippageBps: 0 })
    expect(bounded.children).toHaveLength(1)
    expect(bounded.partialReasons).toContain('MATCH_LIMIT')
    expect(bounded.executableQuantity).toBe(64_000_000n)
    const execution = await crowded.engine.executeMarketOrder(scope, signQuote(bounded), 'Alice')
    expect(execution.settlementIds).toHaveLength(64)
    expect(execution.cancelledQuantity).toBe(6_000_000n)
  })

  test('execution polling exposes aggregate progress and identifiers without signatures', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
    const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
    await engine.executeMarketOrder(scope, signQuote(quote), 'Alice')
    const own = await engine.getExecutions(scope, 'alice')
    expect(own).toHaveLength(1)
    expect(await engine.getExecutions(scope, 'Mallory')).toEqual([])
    expect(JSON.stringify(own, (_, value) => typeof value === 'bigint' ? value.toString() : value)).not.toContain('signature')
    expect(own[0]).not.toHaveProperty('cancelRequested')
  })

  test('SQLite reopen preserves quote binding, execution identity and pending reservations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'solz-execution-'))
    const path = join(directory, 'prediction.sqlite')
    let database = new PredictionDatabase(path)
    try {
      const create = () => new MatchingEngine({ store: new SqliteMatcherStore(database), verifier: { verify: async () => true }, now: () => NOW })
      const engine = create()
      await engine.registerMarket(market())
      await engine.submitOrder(signedOrder({ orderId: 'ask', maker: 'Seller', side: 'SELL', price: 500_000n }))
      const quote = await engine.quoteMarketOrder(scope, { account: 'Alice', outcomeId: 0, side: 'BUY', quantity: 10_000_000n, slippageBps: 0 })
      const request = signQuote(quote)
      const execution = await engine.executeMarketOrder(scope, request, 'Alice')
      await engine.settle(scope, execution.settlementIds[0]!, { submit: async () => ({ status: 'PENDING', txHash: 'tx' }), lookup: async () => ({ status: 'UNKNOWN' }) })
      database.close()
      database = new PredictionDatabase(path)
      const restored = create()
      expect((await restored.executeMarketOrder(scope, request, 'Alice')).id).toBe(execution.id)
      expect((await restored.getExecution(scope, execution.id, 'Alice')).pendingQuantity).toBe(10_000_000n)
      expect((await restored.getOrderBook(scope)).outcomes[0]?.bids).toEqual([])
      await restored.reconcile(scope, execution.settlementIds[0]!, { submit: async () => { throw new Error('Must never rebroadcast') }, lookup: async () => ({ status: 'CONFIRMED', txHash: 'tx', confirmedAt: NOW }) })
      expect((await restored.getExecution(scope, execution.id, 'Alice')).status).toBe('FILLED')
      expect(await restored.getFills(scope)).toHaveLength(1)
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  test('request schemas reject unsafe amounts, overbroad intent fields and FOK claims', () => {
    for (const quantity of [0n, -1n, '1e9', 1.2, Number.MAX_SAFE_INTEGER + 1]) expect(() => parseMarketQuoteRequest({ account: 'Alice', outcomeId: 0, side: 'BUY', quantity, slippageBps: 100 })).toThrow()
    expect(() => parseMarketExecutionRequest({ intent: { type: 'FOK' }, orders: [] })).toThrow()
    expect(() => parseMarketExecutionRequest({ intent: { type: 'MARKET_IOC', quoteId: 'q', quoteHash: `0x${'0'.repeat(64)}`, childrenHash: `0x${'0'.repeat(64)}`, maxCapital: '999999' }, orders: [] })).toThrow()
  })
})
