import { describe, expect, test } from 'bun:test'
import { InMemoryMatcherStore, MatchingEngine, executableQuantity, quoteCeil, runMatchingWorker, type SettlementTransport } from '../../apps/matcher'
import { NOW, market, scope, signedOrder } from './fixtures'

async function setup() {
  const store = new InMemoryMatcherStore()
  let now = NOW
  const engine = new MatchingEngine({ store, verifier: { verify: async (order) => order.signature === 'signed' }, now: () => now })
  await engine.registerMarket(market())
  const transport: SettlementTransport = {
    submit: async () => ({ status: 'CONFIRMED', txHash: '0xtx', confirmedAt: now }),
    lookup: async () => ({ status: 'CONFIRMED', txHash: '0xtx', confirmedAt: now }),
  }
  return { store, engine, transport, advance: (delta: number) => { now += delta } }
}

describe('signed order matching and chain finality', () => {
  test('uses best price then admission sequence, with independent outcome books and partial fills', async () => {
    const { engine, transport } = await setup()
    await engine.submitOrder(signedOrder({ orderId: 'b-low', price: 550_000n }))
    await engine.submitOrder(signedOrder({ orderId: 'b-first', nonce: 1n }))
    await engine.submitOrder(signedOrder({ orderId: 'b-second', nonce: 2n }))
    await engine.submitOrder(signedOrder({ orderId: 'b-other-outcome', outcomeId: 2 }))
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n, quantity: 15_000_000n }))
    const first = await engine.planNext(scope)
    expect(first?.buy.orderId).toBe('b-first')
    expect(first?.quantity).toBe(10_000_000n)
    expect(first?.price).toBe(500_000n)
    expect((await engine.getFills(scope))).toHaveLength(0)
    await engine.settle(scope, first!.id, transport)
    const second = await engine.planNext(scope)
    expect(second?.buy.orderId).toBe('b-second')
    expect(second?.quantity).toBe(5_000_000n)
    await engine.settle(scope, second!.id, transport)
    const orders = await engine.getOrders(scope)
    expect(orders.find((entry) => entry.orderId === 'b-second')?.status).toBe('PARTIALLY_FILLED')
    expect(orders.find((entry) => entry.orderId === 'sell')?.filled).toBe(15_000_000n)
    expect(orders.find((entry) => entry.orderId === 'b-other-outcome')?.filled).toBe(0n)
    const quantities = await engine.getOrderBook(scope)
    expect(quantities.outcomes[0]?.lastTradePrice).toBe(500_000n)
    expect(quantities.outcomes[0]?.bids[0]?.quantity).toBe(5_000_000n)
    expect(quantities.outcomes[2]?.bids[0]?.quantity).toBe(10_000_000n)
  })

  test('prevents duplicate signed payload replay even when client order ID changes', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder())
    await expect(engine.submitOrder(signedOrder({ orderId: 'different' }))).rejects.toThrow('replay')
    await engine.cancelOrder(scope, 'buy-1', 'alice')
    await expect(engine.submitOrder(signedOrder())).rejects.toThrow('replay')
    // EVM minimumNonce semantics intentionally permit a different signed order to share a nonce.
    await expect(engine.submitOrder(signedOrder({ orderId: 'other-price', price: 590_000n }))).resolves.toBeDefined()
  })

  test('requires authorization and matching ownership for cancellation', async () => {
    const { engine } = await setup()
    await expect(engine.submitOrder(signedOrder({ signature: 'forged' }))).rejects.toThrow('authorization')
    await expect(engine.submitOrder(signedOrder({ expiresAt: NOW }))).rejects.toThrow('expiry')
    await expect(engine.submitOrder(signedOrder({ outcomeId: 7 }))).rejects.toThrow('outcome')
    await engine.submitOrder(signedOrder())
    await expect(engine.cancelOrder(scope, 'buy-1', 'Mallory')).rejects.toThrow('account')
    expect((await engine.getOrders(scope))[0]?.status).toBe('OPEN')
  })

  test('atomic reservations prevent concurrent workers from overfilling an order', async () => {
    const { engine, store, transport } = await setup()
    const other = new MatchingEngine({ store, verifier: { verify: async () => true }, now: () => NOW })
    await engine.submitOrder(signedOrder())
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const plans = await Promise.all([engine.planNext(scope), other.planNext(scope), engine.planNext(scope), other.planNext(scope)])
    expect(plans.filter(Boolean)).toHaveLength(1)
    let submits = 0
    const plan = plans.find(Boolean)!
    await Promise.all([engine.settle(scope, plan.id, { ...transport, submit: async (entry) => { submits++; return transport.submit(entry) } }),
      other.settle(scope, plan.id, { ...transport, submit: async (entry) => { submits++; return transport.submit(entry) } })])
    expect(submits).toBe(1)
    expect(await engine.getFills(scope)).toHaveLength(1)
    expect((await engine.getOrders(scope)).every((order) => order.filled === 10_000_000n)).toBe(true)
  })

  test('pending and ambiguous submissions reserve shares until confirmed; restart never blindly resubmits', async () => {
    const { engine, store } = await setup()
    await engine.submitOrder(signedOrder())
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const plan = (await engine.planNext(scope))!
    let submits = 0
    let confirmed = false
    const transport: SettlementTransport = {
      submit: async () => { submits++; throw new Error('RPC timeout after broadcast') },
      lookup: async () => confirmed ? { status: 'CONFIRMED', txHash: 'recovered', confirmedAt: NOW + 1 } : { status: 'UNKNOWN' },
    }
    expect((await engine.settle(scope, plan.id, transport)).status).toBe('AMBIGUOUS')
    expect((await engine.getOrders(scope))[0]?.filled).toBe(0n)
    expect(await engine.planNext(scope)).toBeUndefined()
    const restarted = new MatchingEngine({ store, verifier: { verify: async () => true }, now: () => NOW + 1 })
    await restarted.settle(scope, plan.id, transport)
    await restarted.reconcile(scope, plan.id, transport)
    expect(submits).toBe(1)
    confirmed = true
    await restarted.reconcile(scope, plan.id, transport)
    await restarted.reconcile(scope, plan.id, transport)
    expect(await restarted.getFills(scope)).toHaveLength(1)
    expect((await restarted.getOrders(scope))[0]?.filled).toBe(10_000_000n)
  })

  test('cancelling an unsubmitted plan releases it, but an in-flight fill remains possible and visible', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder())
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const first = (await engine.planNext(scope))!
    const pending: SettlementTransport = { submit: async () => ({ status: 'PENDING', txHash: 'tx' }), lookup: async () => ({ status: 'CONFIRMED', txHash: 'tx', confirmedAt: NOW }) }
    await engine.settle(scope, first.id, pending)
    const cancelled = await engine.cancelOrder(scope, 'buy-1', 'Alice')
    expect(cancelled.requiresOnChainInvalidation).toBe(true)
    expect(cancelled.pendingSettlementIds).toEqual([first.id])
    expect((await engine.getOrders(scope))[0]?.filled).toBe(0n)
    await engine.reconcile(scope, first.id, pending)
    expect((await engine.getOrders(scope))[0]?.status).toBe('FILLED')

    const local = await setup()
    await local.engine.submitOrder(signedOrder())
    await local.engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const unsubmitted = (await local.engine.planNext(scope))!
    await local.engine.cancelOrder(scope, 'buy-1', 'Alice')
    let broadcast = false
    expect((await local.engine.settle(scope, unsubmitted.id, { ...pending, submit: async () => { broadcast = true; throw new Error() } })).status).toBe('FAILED')
    expect(broadcast).toBe(false)
  })

  test('releases reservations only on definitive failed receipt and stops at authoritative cutoff', async () => {
    const { engine, advance } = await setup()
    await engine.submitOrder(signedOrder())
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const plan = (await engine.planNext(scope))!
    const failed: SettlementTransport = { submit: async () => ({ status: 'FAILED', reason: 'Finalized revert', txHash: 'tx' }), lookup: async () => ({ status: 'UNKNOWN' }) }
    await engine.settle(scope, plan.id, failed)
    expect((await engine.getOrders(scope))[0]?.filled).toBe(0n)
    expect((await engine.getOrderBook(scope)).outcomes[0]?.bids[0]?.quantity).toBe(10_000_000n)
    expect(await engine.planNext(scope)).toBeUndefined()
    await engine.submitOrder(signedOrder({ orderId: 'funded-sell', maker: 'Carol', side: 'SELL', price: 550_000n }))
    expect((await engine.planNext(scope))?.sell.orderId).toBe('funded-sell')
    advance(120_001)
    expect(await engine.planNext(scope)).toBeUndefined()
    expect((await engine.getOrderBook(scope)).outcomes.every((outcome) => !outcome.bids.length && !outcome.asks.length)).toBe(true)
  })

  test('skips self trades and rejects non-executable dust without free collateral transfers', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder({ price: 600_000n, quantity: 6n }))
    await engine.submitOrder(signedOrder({ orderId: 'self', side: 'SELL', nonce: 1n, price: 500_000n, quantity: 6n }))
    expect(await engine.planNext(scope)).toBeUndefined()
    await engine.submitOrder(signedOrder({ orderId: 'dust', maker: 'Bob', side: 'SELL', price: 600_000n, quantity: 6n }))
    const plan = (await engine.planNext(scope))!
    expect(plan.quantity).toBe(5n)
    expect(plan.collateral).toBe(3n)
    expect(await engine.planNext(scope)).toBeUndefined()
  })

  test('rounding algorithm matches exhaustive feasible fills and conserves collateral', () => {
    for (const buy of [1n, 123_456n, 333_333n, 500_000n, 600_000n, 999_999n, 1_000_000n]) {
      for (const sell of [1n, 123_455n, 333_333n, 500_000n, 600_000n, 999_999n]) {
        for (let max = 1n; max < 30n; max++) {
          let expected = 0n
          if (sell <= buy) for (let quantity = 1n; quantity <= max; quantity++) {
            if (quoteCeil(quantity, sell) * 1_000_000n <= quantity * buy) expected = quantity
          }
          expect(executableQuantity(max, buy, sell)).toBe(expected)
          if (expected) expect(quoteCeil(expected, sell) > 0n).toBe(true)
        }
      }
    }
  })

  test('independent matcher runner confirms planned fills and stops scheduling on abort', async () => {
    const { engine } = await setup()
    await engine.submitOrder(signedOrder())
    await engine.submitOrder(signedOrder({ orderId: 'sell', maker: 'Bob', side: 'SELL', price: 500_000n }))
    const controller = new AbortController()
    await runMatchingWorker({ engine, listScopes: async () => [scope], signal: controller.signal, intervalMs: 10,
      transportFor: () => ({ submit: async () => { controller.abort(); return { status: 'CONFIRMED', txHash: 'tx', confirmedAt: NOW } }, lookup: async () => ({ status: 'UNKNOWN' }) }) })
    expect(await engine.getFills(scope)).toHaveLength(1)
  })
})
