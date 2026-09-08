import { describe, expect, test } from 'bun:test'
import { DreamDexPredictionVenue, type DreamDexDriver, type DreamDexMarketSnapshot } from '../../packages/adapters/dreamdex/DreamDexPredictionVenue'
import { fillTransaction, positionTransaction } from '../../packages/adapters/evm/transactions'
import { resultTypedData, resolveTransaction } from '../../packages/adapters/evm/results'
import { at, market, unsigned } from './core.test'

describe('venue-specific transaction boundaries', () => {
  test('EVM fills preserve limits and result signing never ignores a purported nonce', () => {
    const settlement = market.marketAddress as `0x${string}`
    const buy = unsigned({ signature: '0x1234' })
    const sell = unsigned({ side: 'SELL', price: 500_000n, signature: '0x5678' })
    expect(fillTransaction(settlement, buy, sell, 1_000_000n).to).toBe(settlement)
    expect(() => fillTransaction(settlement, { ...buy, price: 500_000n }, sell, 1n)).toThrow()
    expect(() => positionTransaction(settlement, 'split', market.id as `0x${string}`, 0n)).toThrow()
    const result = { matchId: market.matchId, marketId: market.id, chainId: market.chainId, venue: market.venue, voided: false, winningOutcomeId: 0, stateHash: `0x${'aa'.repeat(32)}`, matchEndedAt: at, expiresAt: at + 10_000, signature: '0x1234' }
    expect(resultTypedData(result, settlement).message.finishedAt).toBe(BigInt(at / 1000))
    expect(resolveTransaction(settlement, result).value).toBe(0n)
    expect(() => resultTypedData({ ...result, nonce: 1n }, settlement)).toThrow()
  })

  test('DreamDEX NO orders map to YES terms exactly and reject stale pool generations or off-grid values', async () => {
    let snapshot: DreamDexMarketSnapshot = { market: { ...market, venue: 'DREAMDEX', collateralDecimals: 18, outcomes: market.outcomes.slice(0, 2) }, pool: 'configured-pool', poolMarketId: market.id, tickSize: 10n ** 15n, lotSize: 10n ** 15n, minQuantity: 10n ** 15n, readAt: at }
    const submitted: Parameters<DreamDexDriver['placeRawOrder']>[0][] = []
    const driver: DreamDexDriver = {
      account: 'configured-vault', chainId: market.chainId,
      getSnapshot: async () => snapshot,
      listMarkets: async () => [snapshot.market],
      getOrderBook: async () => ({ marketId: market.id, venue: 'DREAMDEX', chainId: market.chainId, updatedAt: at, outcomes: [] }),
      getPositions: async () => [], getOpenOrders: async () => [],
      getBalance: async account => ({ account, collateralToken: market.collateralToken, total: 0n, available: 0n, reserved: 0n }),
      cancelOrder: async () => ({ id: 'cancel', status: 'CONFIRMED' }),
      cancelAllOrders: async () => ({ id: 'cancel-all', status: 'CONFIRMED' }),
      redeem: async () => ({ id: 'redeem', status: 'CONFIRMED' }),
      placeRawOrder: async input => { submitted.push(input); return { orderId: 'sdk-order', status: 'OPEN' } },
    }
    const venue = new DreamDexPredictionVenue(driver, () => at)
    const input = { marketId: market.id, outcomeId: 1, side: 'BUY' as const, price: 380_000n, quantity: 5n * 10n ** 18n, expiresAt: at + 10_000 }
    await venue.placeOrder(input)
    expect(submitted[0]?.side).toBe('BUY_NO')
    expect(submitted[0]?.price).toBe(620_000_000_000_000_000n)
    expect(submitted[0]?.expireTimestampNs).toBe(BigInt(input.expiresAt) * 1_000_000n)
    await expect(venue.placeOrder({ ...input, price: 380_001n })).rejects.toThrow('grid')
    snapshot = { ...snapshot, poolMarketId: 'a-later-market-using-the-same-pool' }
    await expect(venue.placeOrder(input)).rejects.toThrow('generation')
    expect(submitted).toHaveLength(1)
  })
})
