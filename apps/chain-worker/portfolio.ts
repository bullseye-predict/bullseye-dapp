import type { PredictionDatabase } from '../api/storage/database'
import type { MatcherStore } from '../matcher/store'
import { pendingSettlement } from '../matcher/settlement'
import type { Market, VenueId } from '../../packages/prediction-core/types'
import type { PortfolioPosition } from '../../packages/prediction-core/market-data'
import { encodeStored } from '../../packages/prediction-core/serialization'
import { invariant } from '../../packages/prediction-core/validation'

export interface ChainPortfolioReader { readPositions(account: string, markets: Market[]): Promise<PortfolioPosition[]> }
const key = (venue: VenueId, account: string) => venue === 'SOLANA' ? account : account.toLowerCase()

export function createChainPortfolio(options: { database: PredictionDatabase; store: MatcherStore; readers: Map<string, ChainPortfolioReader>; now?: () => number }) {
  const now = options.now ?? Date.now
  return {
    async getPositions(venue: VenueId, chainId: string, account: string): Promise<PortfolioPosition[]> {
      const reader = options.readers.get(JSON.stringify([venue, chainId]))
      invariant(reader, 'UNSUPPORTED_VENUE', 'No current on-chain portfolio reader is configured for this venue.')
      for (let attempt = 0; attempt < 3; attempt++) {
        const markets = options.database.listMarkets(venue, chainId, now())
        const snapshot = () => Promise.all(markets.map(market => options.store.read({ venue, chainId, marketId: market.id })))
        const before = await snapshot()
        // Reservation state MUST precede the RPC read. Retry if a fill/cancel/order
        // committed while querying the chain, preventing stale released reservations.
        const positions = await reader.readPositions(account, markets)
        if (encodeStored(before) !== encodeStored(await snapshot())) continue
        if (encodeStored(markets.map(market => market.id)) !== encodeStored(options.database.listMarkets(venue, chainId, now()).map(market => market.id))) continue
        const reserved = new Map<string, bigint>()
        const add = (market: string, outcome: number, quantity: bigint) => { const id = JSON.stringify([market, outcome]); reserved.set(id, (reserved.get(id) ?? 0n) + quantity) }
        for (const state of before) {
          const active = state?.orders.filter(order => key(venue, order.maker) === key(venue, account) && ['OPEN', 'PARTIALLY_FILLED'].includes(order.status) && order.expiresAt > now()) ?? []
          for (const order of active) if (order.side === 'SELL') add(order.marketId, order.outcomeId, order.quantity - order.filled)
          const ids = new Set(active.map(order => order.orderId))
          for (const plan of state?.settlements ?? []) if (pendingSettlement(plan.status) && !ids.has(plan.sell.orderId) && key(venue, plan.sell.maker) === key(venue, account)) add(plan.marketId, plan.sell.outcomeId, plan.quantity)
        }
        return positions.map(position => ({ ...position, reservedQuantity: reserved.get(JSON.stringify([position.marketId, position.outcomeId])) ?? 0n })).filter(position => position.quantity > 0n || position.reservedQuantity > 0n || position.realizedPnl !== 0n)
      }
      throw new Error('Portfolio changed during the chain read; retry.')
    },
  }
}
