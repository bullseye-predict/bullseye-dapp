import { expect, test } from 'bun:test'
import { PredictionDatabase } from '../api/storage/database'
import { SqliteMatcherStore } from '../api/storage/matcher-store'
import type { Market, Order } from '../../packages/prediction-core/types'
import { createChainPortfolio } from './portfolio'
import type { PlannedSettlement } from '../matcher/settlement'

test('portfolio retries a concurrent fill and retains terminal child pending SELL reservations', async () => {
  const database = new PredictionDatabase()
  const store = new SqliteMatcherStore(database)
  const market: Market = { id: 'market', matchId: 'match', venue: 'EVM', chainId: '1', marketAddress: 'settlement', collateralToken: 'token', collateralDecimals: 6, outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }], status: 'TRADING', createdAt: 1000, tradingStartsAt: 1000, tradingLocksAt: 10000, expiresAt: 20000, paused: false }
  const scope = { venue: market.venue, chainId: market.chainId, marketId: market.id }
  const order: Order = { orderId: 'sell', venue: 'EVM', chainId: '1', maker: '0xABC', marketId: market.id, outcomeId: 0, side: 'SELL', quantity: 10n, price: 500000n, expiresAt: 9000, nonce: 0n, signature: 'signed', filled: 0n, status: 'CANCELLED', createdAt: 2000, sequence: 0 }
  const plan: PlannedSettlement = { ...scope, id: 'fill', buy: { ...order, maker: 'other', side: 'BUY', orderId: 'buy' }, sell: order, quantity: 4n, price: 500000n, collateral: 2n, status: 'PENDING', createdAt: 2000, updatedAt: 2000 }
  try {
    database.saveMarket(market)
    await store.transaction(scope, () => ({ state: { market, orders: [order], settlements: [plan], fills: [], nextSequence: 1, nextSettlementSequence: 1 }, result: undefined }))
    let reads = 0
    const reader = { readPositions: async () => {
      reads++
      if (reads === 1) await store.transaction(scope, state => { state!.settlements[0]!.quantity = 3n; return { state: state!, result: undefined } })
      return [{ account: '0xabc', venue: 'EVM' as const, chainId: '1', marketId: market.id, outcomeId: 0, quantity: 10n, reservedQuantity: 0n, costBasis: null, realizedPnl: null, accountingComplete: false }]
    } }
    const portfolio = createChainPortfolio({ database, store, readers: new Map([[JSON.stringify(['EVM', '1']), reader]]), now: () => 3000 })
    const positions = await portfolio.getPositions('EVM', '1', '0xabc')
    expect(reads).toBe(2)
    expect(positions[0]?.reservedQuantity).toBe(3n)
    expect(positions[0]?.costBasis).toBeNull()
    expect(positions[0]?.accountingComplete).toBe(false)
  } finally { database.close() }
})
