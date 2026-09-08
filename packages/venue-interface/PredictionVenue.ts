import type {
  Balance, Market, Order, OrderBook, OrderResult, PlaceOrderInput, Position, TxResult, VenueId,
} from '../prediction-core/types'

/** An account-scoped venue. Signers and RPC clients live in adapters, never in Hermes. */
export interface PredictionVenue {
  readonly venue: VenueId
  readonly chainId: string
  readonly account: string
  listMarkets(): Promise<Market[]>
  getMarket(marketId: string): Promise<Market>
  getOrderBook(marketId: string, outcomeId?: number): Promise<OrderBook>
  getPositions(account: string): Promise<Position[]>
  getOpenOrders(account: string, marketId?: string): Promise<Order[]>
  placeOrder(input: PlaceOrderInput): Promise<OrderResult>
  cancelOrder(orderId: string): Promise<TxResult>
  cancelAllOrders(marketId?: string): Promise<TxResult>
  redeem(marketId: string): Promise<TxResult>
  getBalance(account: string): Promise<Balance>
}
