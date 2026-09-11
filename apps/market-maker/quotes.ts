import { PRICE_SCALE, type Balance, type Market, type Order, type PlaceOrderInput, type Position } from '../../packages/prediction-core/types'
import { quoteCeil as quote } from '../../packages/prediction-core/validation'

export interface QuotePolicy {
  quoteShares: bigint
  targetInventoryShares: bigint
  maxInventoryShares: bigint
  halfSpread: bigint
  inventorySkew: bigint
}
export interface QuoteSnapshot {
  account: string
  market: Market
  /** Explicit external estimates; this function never invents liquidity or probabilities. */
  probabilities: ReadonlyMap<number, bigint>
  balance: Balance
  positions: Position[]
  openOrders: Order[]
  now: number
  expiresAt: number
}

const minimum = (...values: bigint[]): bigint => values.reduce((left, right) => left < right ? left : right)
const maximum = (left: bigint, right: bigint): bigint => left > right ? left : right

/** Produce inventory-aware LIMIT intents only; execution remains a host responsibility. */
export function buildQuoteIntents(snapshot: QuoteSnapshot, policy: QuotePolicy): PlaceOrderInput[] {
  const { market, probabilities, balance, positions, openOrders, now, expiresAt } = snapshot
  if (market.status !== 'TRADING' || market.paused || now < market.tradingStartsAt || now >= market.tradingLocksAt || now >= market.expiresAt) return []
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > Math.min(market.tradingLocksAt, market.expiresAt)) throw new Error('Invalid quote expiry')
  const quoteExpiry = Math.floor(expiresAt / 1000) * 1000
  if (quoteExpiry <= now) throw new Error('Quote expiry leaves no whole second trading window')
  if (policy.quoteShares <= 0n || policy.maxInventoryShares <= 0n || policy.targetInventoryShares < 0n || policy.targetInventoryShares > policy.maxInventoryShares ||
    policy.halfSpread <= 0n || policy.halfSpread >= PRICE_SCALE / 2n || policy.inventorySkew < 0n || policy.inventorySkew > PRICE_SCALE) throw new Error('Invalid quote policy')
  if (probabilities.size !== market.outcomes.length || market.outcomes.some((outcome) => !probabilities.has(outcome.id)) ||
    [...probabilities.values()].some((value) => typeof value !== 'bigint' || value < 0n || value > PRICE_SCALE) ||
    [...probabilities.values()].reduce((sum, value) => sum + value, 0n) !== PRICE_SCALE) throw new Error('Complete normalized probability estimates are required')
  const accountKey = (account: string) => market.venue === 'SOLANA' ? account : account.toLowerCase()
  if (accountKey(balance.account) !== accountKey(snapshot.account) || balance.collateralToken !== market.collateralToken ||
    balance.available < 0n || balance.reserved < 0n || balance.total !== balance.available + balance.reserved) throw new Error('Invalid quote collateral snapshot')
  if (positions.some((position) => accountKey(position.account) !== accountKey(snapshot.account) || position.venue !== market.venue ||
    position.chainId !== market.chainId || position.quantity < 0n || position.reservedQuantity < 0n || position.reservedQuantity > position.quantity)) throw new Error('Invalid quote positions')
  if (openOrders.some((order) => accountKey(order.maker) !== accountKey(snapshot.account) || order.venue !== market.venue || order.chainId !== market.chainId ||
    order.quantity <= order.filled || order.filled < 0n || order.price <= 0n || order.price > PRICE_SCALE || !['OPEN', 'PARTIALLY_FILLED'].includes(order.status))) throw new Error('Invalid quote open orders')
  const reservedCollateral = openOrders.filter((order) => order.side === 'BUY').reduce((sum, order) => sum + quote(order.quantity - order.filled, order.price), 0n)
  let budget = maximum(0n, balance.available - maximum(0n, reservedCollateral - balance.reserved))
  const intents: PlaceOrderInput[] = []
  for (const outcome of market.outcomes) {
    const owned = positions.filter((position) => position.marketId === market.id && position.outcomeId === outcome.id)
    if (owned.length > 1) throw new Error('Duplicate inventory position')
    const position = owned[0]
    const quantity = position?.quantity ?? 0n
    const orders = openOrders.filter((order) => order.marketId === market.id && order.outcomeId === outcome.id)
    const reservedBuys = orders.filter((order) => order.side === 'BUY').reduce((sum, order) => sum + order.quantity - order.filled, 0n)
    const reservedSells = maximum(position?.reservedQuantity ?? 0n, orders.filter((order) => order.side === 'SELL').reduce((sum, order) => sum + order.quantity - order.filled, 0n))
    const skew = policy.inventorySkew * (quantity + reservedBuys - policy.targetInventoryShares) / policy.maxInventoryShares
    const center = minimum(PRICE_SCALE - policy.halfSpread, maximum(policy.halfSpread + 1n, probabilities.get(outcome.id)! - skew))
    const bid = center - policy.halfSpread
    const ask = center + policy.halfSpread
    const buySize = minimum(policy.quoteShares, maximum(0n, policy.maxInventoryShares - quantity - reservedBuys), budget * PRICE_SCALE / bid)
    if (buySize > 0n) {
      intents.push({ marketId: market.id, outcomeId: outcome.id, side: 'BUY', price: bid, quantity: buySize, expiresAt: quoteExpiry })
      budget -= quote(buySize, bid)
    }
    const sellSize = minimum(policy.quoteShares, maximum(0n, quantity - reservedSells))
    if (sellSize > 0n) intents.push({ marketId: market.id, outcomeId: outcome.id, side: 'SELL', price: ask, quantity: sellSize, expiresAt: quoteExpiry })
  }
  return intents
}
