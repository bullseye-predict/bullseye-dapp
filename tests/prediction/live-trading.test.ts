import { describe, expect, test } from 'bun:test'
import { verifyMessage, verifyTypedData } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { PredictionDatabase } from '../../apps/api/storage/database'
import { SqliteMatcherStore } from '../../apps/api/storage/matcher-store'
import { MatchingEngine } from '../../apps/matcher/matching-engine'
import { createPredictionApi, type ChainGateway } from '../../apps/api/server'
import { RequestAuthenticator } from '../../apps/api/auth/requests'
import { PredictionTradingClient } from '../../packages/sdk/PredictionTradingClient'
import { createEvmOrderSigner } from '../../packages/adapters/evm/EvmPredictionVenue'
import { evmOrderId, orderTypedData } from '../../packages/adapters/evm/orders'
import { publicVenueConfig } from '../../apps/api/public-config'
import { parseEvmConfig } from '../../packages/adapters/config'
import { tradeCandles } from '../../apps/api/market-data'
import { parsePredictionResponse } from '../../packages/sdk/wire'
import { parseUnitsExact, formatUnitsExact } from '../../src/components/prediction/amounts'
import { at, market, wallet } from './core.test'
import type { Fill } from '../../packages/prediction-core/types'

const scope = { venue: market.venue, chainId: market.chainId, marketId: market.id }
const deployment = { family: 'EVM' as const, venue: 'EVM' as const, chainId: market.chainId, rpcUrl: 'https://private.invalid/key', settlementAddress: market.marketAddress as `0x${string}`, factoryAddress: `0x${'77'.repeat(20)}` as const, oracleAddress: `0x${'88'.repeat(20)}` as const, collateralToken: market.collateralToken as `0x${string}`, collateralDecimals: 6 }

async function setup() {
  const database = new PredictionDatabase()
  const store = new SqliteMatcherStore(database)
  const gateway: ChainGateway = { config: scope, getMarket: async () => structuredClone(market),
    verifyOrder: order => verifyTypedData({ ...orderTypedData(order, deployment.settlementAddress), address: order.maker as `0x${string}`, signature: order.signature as `0x${string}` }).then(valid => valid && order.orderId === evmOrderId(order, deployment.settlementAddress)),
    verifyRequest: (account, message, signature) => verifyMessage({ address: account as `0x${string}`, message, signature: signature as `0x${string}` }),
    getBalance: async account => ({ account, collateralToken: market.collateralToken, total: 10_000_000n, available: 10_000_000n, reserved: 0n }),
  }
  const matcher = new MatchingEngine({ store, verifier: { verify: order => gateway.verifyOrder(order) }, now: () => at })
  database.saveMarket(market); await matcher.registerMarket(market)
  const authenticator = new RequestAuthenticator(database, { verify: (proof, message) => gateway.verifyRequest(proof.account, message, proof.signature) }, 'http://prediction.test', () => at)
  const handler = createPredictionApi({ database, matcher, matcherStore: store, gateways: [gateway], authenticator, now: () => at, requireOrderProof: true, enforceFunding: true, allowedOrigins: ['http://localhost:4321'],
    portfolio: { getPositions: async (_venue, _chain, account) => [{ account, ...scope, outcomeId: 0, quantity: 10_000_000n, reservedQuantity: 0n, costBasis: null, realizedPnl: null, accountingComplete: false }] },
  })
  let nonce = 0n
  const client = (owner: typeof wallet) => new PredictionTradingClient({ baseUrl: 'http://prediction.test', audience: 'http://prediction.test', venue: market.venue, chainId: market.chainId, account: owner.address.toLowerCase(), now: () => at,
    signOrder: createEvmOrderSigner(deployment, owner.address.toLowerCase() as `0x${string}`, { nextNonce: async () => nonce++, signTypedData: value => owner.signTypedData(value) }),
    signRequest: message => owner.signMessage({ message }), redeem: async () => { throw new Error('Not part of this HTTP test') },
    fetch: (async (input, init) => handler(new Request(String(input), init))) as typeof fetch,
  })
  return { database, store, matcher, handler, client, gateway }
}

describe('live trading API and SDK integration', () => {
  test('authenticated limit → quoted market → reserved → confirmed history, without publishing signatures', async () => {
    const fixture = await setup()
    try {
      const seller = fixture.client(privateKeyToAccount(`0x${'42'.repeat(32)}`))
      const buyer = fixture.client(wallet)
      await seller.placeOrder({ marketId: market.id, outcomeId: 0, side: 'SELL', price: 400_000n, quantity: 10_000_000n, expiresAt: at + 30_000 })
      const orders = await seller.getOpenOrders(seller.account, market.id)
      expect(orders[0]!.signature).toBe('')
      const snapshot = await buyer.getSnapshot(market.id)
      expect(snapshot.book.outcomes[0]!.asks[0]!.quantity).toBe(10_000_000n)
      expect(snapshot.trades).toEqual([])
      const quote = await buyer.quoteMarketOrder(market.id, { outcomeId: 0, side: 'BUY', quantity: 15_000_000n, slippageBps: 100 })
      expect(quote.executableQuantity).toBe(10_000_000n)
      expect(quote.unfilledQuantity).toBe(5_000_000n)
      const execution = await buyer.executeQuote(quote)
      expect(execution.filledQuantity).toBe(0n)
      expect(execution.pendingQuantity).toBe(10_000_000n)
      expect(await buyer.getCandles(market.id, 0)).toEqual([])
      const plan = (await fixture.matcher.getSettlements(scope))[0]!
      await fixture.matcher.settle(scope, plan.id, { submit: async () => ({ status: 'CONFIRMED', txHash: 'confirmed-test-receipt', confirmedAt: at }), lookup: async () => ({ status: 'UNKNOWN' }) })
      const final = (await buyer.getExecutions(market.id))[0]!
      expect(final.status).toBe('PARTIALLY_FILLED')
      expect(final.filledQuantity).toBe(10_000_000n)
      expect(final.cancelledQuantity).toBe(5_000_000n)
      expect((await buyer.getCandles(market.id, 0))[0]!.close).toBe(400_000n)
      expect((await buyer.getSnapshot(market.id)).book.outcomes[0]!.asks).toEqual([])
      expect((await buyer.getPortfolioPositions(buyer.account))[0]!.costBasis).toBeNull()
      await expect(buyer.getPositions(buyer.account)).rejects.toThrow('Complete position cost')
    } finally { fixture.database.close() }
  })
  test('concurrent funding reservations cannot admit two orders that exceed one account balance', async () => {
    const fixture = await setup()
    try {
      const buyer = fixture.client(wallet)
      const intent = { marketId: market.id, outcomeId: 0, side: 'BUY' as const, price: 600_000n, quantity: 10_000_000n, expiresAt: at + 30_000 }
      const results = await Promise.allSettled([buyer.placeOrder(intent), buyer.placeOrder(intent)])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect((await buyer.getBalance(buyer.account)).reserved).toBe(6_000_000n)
    } finally { fixture.database.close() }
  })
  test('CORS allows only configured UI origins and limits cannot bypass maker request authentication', async () => {
    const fixture = await setup()
    try {
      const preflight = await fixture.handler(new Request('http://prediction.test/orders', { method: 'OPTIONS', headers: { origin: 'http://localhost:4321' } }))
      expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:4321')
      const denied = await fixture.handler(new Request('http://prediction.test/health', { headers: { origin: 'https://unconfigured.invalid' } }))
      expect(denied.status).toBe(403)
      const unsigned = await fixture.handler(new Request(`http://prediction.test/orders?venue=EVM&chainId=${market.chainId}`, { method: 'POST', body: '{}' }))
      expect(unsigned.status).toBeGreaterThanOrEqual(400)
      expect(await fixture.matcher.getOrders(scope)).toEqual([])
    } finally { fixture.database.close() }
  })
})

test('history is confirmed-only, ordered, deduplicated and leaves gaps empty', () => {
  const fill = (id: string, timestamp: number, price: bigint): Fill => ({ ...scope, id, outcomeId: 0, buyOrderId: 'buy', sellOrderId: 'sell', price, quantity: 1_000_000n, timestamp, txHash: id })
  const fills = [fill('late', 3500, 600_000n), fill('early', 1100, 400_000n), fill('mid', 1800, 500_000n), fill('early', 1100, 400_000n)]
  const candles = tradeCandles(fills, 0, 1000, 1000, 4000)
  expect(candles.map(value => value.timestamp)).toEqual([1000, 3000])
  expect(candles[0]).toMatchObject({ open: 400_000n, close: 500_000n, volume: 2_000_000n, trades: 2 })
  expect(tradeCandles([], 0, 1000, 0, 4000)).toEqual([])
})
test('public deployment config never exposes private RPC URLs or signer settings', () => {
  const config = publicVenueConfig({ ...deployment, publicRpcUrl: 'http://localhost:8545', worker: { relayerKeyEnv: 'PRIVATE_SIGNER_KEY' }, secret: 'never-public' })
  expect(JSON.stringify(config)).not.toContain('private.invalid')
  expect(JSON.stringify(config)).not.toContain('PRIVATE_SIGNER_KEY')
  expect(JSON.stringify(config)).not.toContain('never-public')
})

test('COOLA is rejected as prediction collateral in both private and public deployment configuration', () => {
  expect(() => parseEvmConfig({ ...deployment, collateralSymbol: 'COOLA' })).toThrow('$COOLA')
  expect(() => publicVenueConfig({ ...deployment, collateralSymbol: 'COOLA' })).toThrow('$COOLA')
  expect(publicVenueConfig({ ...deployment, collateralSymbol: 'WSOL' }).collateralSymbol).toBe('WSOL')
})
test('browser collateral input and wire decoding preserve exact atomic values and unknown PnL', () => {
  expect(parseUnitsExact('9007199254.740993', 6)).toBe(9007199254740993n)
  expect(formatUnitsExact(9007199254740993n, 6)).toBe('9007199254.740993')
  expect(() => parseUnitsExact('1e9', 6)).toThrow()
  expect(() => parseUnitsExact('0.0000001', 6)).toThrow()
  expect(parsePredictionResponse<{ quantity: bigint; costBasis: null; chainId: string }>('{"quantity":"9007199254740993","costBasis":null,"chainId":"31337"}')).toEqual({ quantity: 9007199254740993n, costBasis: null, chainId: '31337' })
})
