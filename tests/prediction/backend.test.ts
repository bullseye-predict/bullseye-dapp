import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyMessage, verifyTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PredictionDatabase } from '../../apps/api/storage/database'
import { SqliteMatcherStore } from '../../apps/api/storage/matcher-store'
import { MatchingEngine } from '../../apps/matcher/matching-engine'
import { createPredictionApi, type ChainGateway } from '../../apps/api/server'
import { RequestAuthenticator } from '../../apps/api/auth/requests'
import { proofHeaders, requestAuthMessage } from '../../packages/sdk/auth'
import { TelemetryBridge, telemetrySignature } from '../../packages/telemetry/bridge'
import { evmOrderId, orderTypedData } from '../../packages/adapters/evm/orders'
import { stringify } from '../../packages/prediction-core/serialization'
import type { MatchTelemetry } from '../../packages/prediction-core/types'
import { at, market, unsigned, wallet } from './core.test'

const secret = 'local-test-secret-not-used-in-production'
const scope = { venue: market.venue, chainId: market.chainId, marketId: market.id }
const databases: PredictionDatabase[] = []
const dirs: string[] = []
afterEach(() => { databases.splice(0).forEach(database => database.close()); dirs.splice(0).forEach(directory => rmSync(directory, { recursive: true, force: true })) })

function database(path?: string) { const value = new PredictionDatabase(path); databases.push(value); return value }
function telemetry(sequence = 1): MatchTelemetry {
  return { matchId: market.matchId, sequence, timestamp: at, remainingMs: 60_000, participants: [{ id: 'BLUE', hp: 70, maxHp: 100, alive: true, kills: 2 }], score: { BLUE: 1 }, objectives: { BLUE: 70 }, kills: [] }
}

async function fixture(path?: string) {
  const db = database(path)
  const store = new SqliteMatcherStore(db)
  const gateway: ChainGateway = {
    config: { venue: market.venue, chainId: market.chainId },
    async getMarket() { return structuredClone(market) },
    async getBalance(account) { return { account, collateralToken: market.collateralToken, total: 100_000_000n, available: 100_000_000n, reserved: 0n } },
    async verifyOrder(order) { return order.orderId === evmOrderId(order, market.marketAddress as `0x${string}`) && await verifyTypedData({ ...orderTypedData(order, market.marketAddress as `0x${string}`), address: order.maker as `0x${string}`, signature: order.signature as `0x${string}` }) },
    async verifyRequest(account, message, signature) { return verifyMessage({ address: account as `0x${string}`, message, signature: signature as `0x${string}` }) },
  }
  const matcher = new MatchingEngine({ store, now: () => at, verifier: { verify: order => gateway.verifyOrder(order) } })
  await matcher.registerMarket(market)
  db.saveMarket(market)
  const authenticator = new RequestAuthenticator(db, { verify: (proof, message) => gateway.verifyRequest(proof.account, message, proof.signature) }, 'http://prediction.test', () => at)
  const bridge = new TelemetryBridge(db, secret, () => at)
  const handler = createPredictionApi({ database: db, matcher, matcherStore: store, gateways: [gateway], authenticator, telemetry: bridge, now: () => at })
  const order = unsigned()
  const typed = orderTypedData(order, market.marketAddress as `0x${string}`)
  order.signature = await wallet.signTypedData(typed)
  order.orderId = evmOrderId(order, market.marketAddress as `0x${string}`)
  return { db, store, matcher, handler, order, gateway }
}

describe('durable prediction backend', () => {
  test('telemetry rejects unsigned, stale, altered, and replayed game state', () => {
    const db = database()
    const bridge = new TelemetryBridge(db, secret, () => at)
    const body = stringify(telemetry())
    expect(() => bridge.ingest(body, '0'.repeat(64))).toThrow()
    expect(bridge.ingest(body, telemetrySignature(body, secret)).sequence).toBe(1)
    expect(() => bridge.ingest(body, telemetrySignature(body, secret))).toThrow()
    const stale = stringify({ ...telemetry(2), timestamp: at - 20_000 })
    expect(() => bridge.ingest(stale, telemetrySignature(stale, secret))).toThrow()
    expect(db.telemetry(market.matchId)?.sequence).toBe(1)
  })

  test('real signed order admission persists across connections without inventing a fill', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'solz-prediction-')); dirs.push(dir)
    const path = join(dir, 'state.sqlite')
    const { handler, order, matcher } = await fixture(path)
    const query = `?venue=EVM&chainId=${market.chainId}`
    const rejected = await handler(new Request(`http://prediction.test/orders${query}`, { method: 'POST', body: stringify({ ...order, quantity: '123' }) }))
    expect(rejected.status).toBeGreaterThanOrEqual(400)
    const accepted = await handler(new Request(`http://prediction.test/orders${query}`, { method: 'POST', body: stringify(order) }))
    expect(accepted.status).toBe(202)
    expect(await accepted.json()).toEqual({ orderId: order.orderId, status: 'OPEN' })
    expect(await matcher.getFills(scope)).toEqual([])
    const second = new SqliteMatcherStore(database(path))
    expect((await second.read(scope))?.orders[0]?.quantity).toBe(10_000_000n)
    const balances = await handler(new Request(`http://prediction.test/users/${wallet.address}/balance${query}`))
    expect((await balances.json()).reserved).toBe('5500000')
    const crossedChain = await handler(new Request(`http://prediction.test/orders?venue=EVM&chainId=1`, { method: 'POST', body: stringify(order) }))
    expect(crossedChain.status).toBe(400)
  })

  test('cancellation requires account proof bound to exact request and cannot replay', async () => {
    const { matcher, handler, order } = await fixture()
    await matcher.submitOrder(order)
    const path = `/orders/${order.orderId}?venue=EVM&chainId=${market.chainId}`
    const proof = { venue: market.venue, chainId: market.chainId, account: wallet.address, nonce: 'unique_nonce_for_cancel', expiresAt: at + 30_000 }
    const signature = await wallet.signMessage({ message: await requestAuthMessage('http://prediction.test', 'DELETE', path, '', proof) })
    const headers = proofHeaders({ ...proof, signature })
    const bad = await handler(new Request(`http://prediction.test${path.replace('DELETE', 'POST')}&extra=1`, { method: 'DELETE', headers }))
    expect(bad.status).toBe(401)
    const cancelled = await handler(new Request(`http://prediction.test${path}`, { method: 'DELETE', headers }))
    expect(cancelled.status).toBe(202)
    expect((await cancelled.json()).requiresOnChainInvalidation).toBe(true)
    const replay = await handler(new Request(`http://prediction.test${path}`, { method: 'DELETE', headers }))
    expect(replay.status).toBe(409)
    expect((await matcher.getOrders(scope))[0]?.status).toBe('CANCELLED')
  })

  test('cancelled pending fills retain capital and balance reads retry across confirmation', async () => {
    const { matcher, handler, order, gateway } = await fixture()
    const seller = privateKeyToAccount(`0x${'23'.repeat(32)}`)
    const sell = unsigned({ maker: seller.address, side: 'SELL', price: 400_000n, quantity: 5_000_000n })
    sell.orderId = evmOrderId(sell, market.marketAddress as `0x${string}`)
    sell.signature = await seller.signTypedData(orderTypedData(sell, market.marketAddress as `0x${string}`))
    await matcher.submitOrder(order); await matcher.submitOrder(sell)
    const plan = await matcher.planNext(scope)
    expect(plan).toBeDefined()
    await matcher.settle(scope, plan!.id, { submit: async () => ({ status: 'PENDING', txHash: 'chain-tx' }), lookup: async () => ({ status: 'UNKNOWN' }) })
    await matcher.cancelOrder(scope, order.orderId, wallet.address)
    const url = `http://prediction.test/users/${wallet.address}/balance?venue=EVM&chainId=${market.chainId}`
    expect((await (await handler(new Request(url))).json()).reserved).toBe('2000000')
    let reads = 0
    gateway.getBalance = async account => {
      reads++
      const total = reads === 1 ? 100_000_000n : 98_000_000n
      if (reads === 1) await matcher.reconcile(scope, plan!.id, { submit: async () => ({ status: 'UNKNOWN' }), lookup: async () => ({ status: 'CONFIRMED', txHash: 'chain-tx', confirmedAt: at }) })
      return { account, total, available: total, reserved: 0n, collateralToken: market.collateralToken }
    }
    const result = await (await handler(new Request(url))).json()
    expect(reads).toBe(2)
    expect(result.total).toBe('98000000')
    expect(result.reserved).toBe('0')
  })

  test('unconfigured portfolio and Hermes never report a fabricated empty account or successful agent', async () => {
    const { handler } = await fixture()
    const query = `?venue=EVM&chainId=${market.chainId}`
    expect((await handler(new Request(`http://prediction.test/users/${wallet.address}/positions${query}`))).status).toBe(503)
    expect((await handler(new Request(`http://prediction.test/hermes/start${query}`, { method: 'POST', body: '{}' }))).status).toBe(503)
  })

  test('indexer-discovered markets have readable empty books before their first order', async () => {
    const { db, handler } = await fixture()
    const discovered = { ...market, id: `0x${'88'.repeat(32)}`, matchId: `0x${'99'.repeat(32)}` }
    db.saveMarket(discovered)
    const query = `?venue=EVM&chainId=${market.chainId}`
    expect((await handler(new Request(`http://prediction.test/users/${wallet.address}/orders${query}`))).status).toBe(200)
    const response = await handler(new Request(`http://prediction.test/markets/${discovered.id}/orderbook${query}`))
    expect(response.status).toBe(200)
    const book = await response.json()
    expect(book.outcomes).toHaveLength(3)
    expect(book.outcomes[0].bids).toEqual([])
    expect(book.outcomes[0].asks).toEqual([])
  })
})
