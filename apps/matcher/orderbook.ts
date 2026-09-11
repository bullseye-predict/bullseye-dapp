import { PRICE_SCALE, type Order, type OrderBook, type OrderBookLevel, type OrderSide } from '../../packages/prediction-core/types'
import { quoteCeil } from '../../packages/prediction-core/validation'
import { pendingSettlement } from './settlement'
import type { MatcherState } from './store'

export { quoteCeil } from '../../packages/prediction-core/validation'

/** Largest non-dust fill whose rounded cost still respects the buyer's limit. */
export function executableQuantity(maximum: bigint, buyPrice: bigint, sellPrice: bigint): bigint {
  if (maximum <= 0n || sellPrice <= 0n || buyPrice < sellPrice) return 0n
  if (buyPrice === sellPrice) {
    let a = sellPrice
    let b = PRICE_SCALE
    while (b !== 0n) { const remainder = a % b; a = b; b = remainder }
    const lotSize = PRICE_SCALE / a
    return maximum / lotSize * lotSize
  }
  let quantity = maximum
  // When rounding fails, skip directly to the preceding collateral cost boundary.
  // Failure implies quantity * (buyPrice - sellPrice) < PRICE_SCALE, so this
  // search is bounded by the six-decimal price scale, never by token balances.
  while (quantity > 0n) {
    const cost = quoteCeil(quantity, sellPrice)
    if (cost * PRICE_SCALE <= quantity * buyPrice) return quantity
    quantity = (cost - 1n) * PRICE_SCALE / sellPrice
  }
  return 0n
}

export const isActiveOrder = (order: Order): boolean =>
  order.status === 'OPEN' || order.status === 'PARTIALLY_FILLED'

export function reservedQuantity(state: MatcherState, orderId: string): bigint {
  return state.settlements.reduce((sum, plan) =>
    pendingSettlement(plan.status) && (plan.buy.orderId === orderId || plan.sell.orderId === orderId)
      ? sum + plan.quantity : sum, 0n)
}

export function availableQuantity(state: MatcherState, order: Order): bigint {
  return order.quantity - order.filled - reservedQuantity(state, order.orderId)
}

export function byPriceTime(side: OrderSide): (left: Order, right: Order) => number {
  return (left, right) => {
    if (left.price !== right.price) {
      if (side === 'BUY') return left.price > right.price ? -1 : 1
      return left.price < right.price ? -1 : 1
    }
    return left.sequence - right.sequence
  }
}

export function activeOrders(state: MatcherState, outcomeId: number, side: OrderSide, now: number): Order[] {
  return state.orders.filter((order) => order.outcomeId === outcomeId && order.side === side &&
    isActiveOrder(order) && order.expiresAt > now && availableQuantity(state, order) > 0n).sort(byPriceTime(side))
}

function levels(state: MatcherState, orders: Order[]): OrderBookLevel[] {
  const result: OrderBookLevel[] = []
  for (const order of orders) {
    const previous = result.at(-1)
    if (previous?.price === order.price) {
      previous.quantity += availableQuantity(state, order)
      previous.orderCount += 1
    } else {
      result.push({ price: order.price, quantity: availableQuantity(state, order), orderCount: 1 })
    }
  }
  return result
}

export function buildOrderBook(state: MatcherState, now: number): OrderBook {
  return {
    marketId: state.market.id,
    venue: state.market.venue,
    chainId: state.market.chainId,
    updatedAt: now,
    outcomes: state.market.outcomes.map((outcome) => {
      const lastTrade = state.fills.findLast((fill) => fill.outcomeId === outcome.id)
      return {
        outcomeId: outcome.id,
        bids: levels(state, activeOrders(state, outcome.id, 'BUY', now)),
        asks: levels(state, activeOrders(state, outcome.id, 'SELL', now)),
        ...(lastTrade ? { lastTradePrice: lastTrade.price } : {}),
      }
    }),
  }
}
