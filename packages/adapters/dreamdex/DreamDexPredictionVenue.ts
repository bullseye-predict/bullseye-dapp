import type { PredictionVenue } from '../../venue-interface/PredictionVenue'
import { PRICE_SCALE, type Market, type PlaceOrderInput, type OrderResult, type TxResult } from '../../prediction-core/types'
import { invariant, PredictionError, validateMarket } from '../../prediction-core/validation'

export interface DreamDexMarketSnapshot {
  market: Market
  /** Pool addresses can be recycled. Verify the current market before every write. */
  pool: string
  poolMarketId: string
  tickSize: bigint
  lotSize: bigint
  minQuantity: bigint
  readAt: number
}

/** Implement with the official markets-sdk raw trader tier; no spot HTTP endpoints. */
export interface DreamDexDriver extends Pick<PredictionVenue, 'account' | 'chainId' | 'listMarkets' | 'getOrderBook' | 'getPositions' | 'getOpenOrders' | 'getBalance' | 'cancelOrder' | 'cancelAllOrders' | 'redeem'> {
  getSnapshot(marketId: string): Promise<DreamDexMarketSnapshot>
  placeRawOrder(input: { marketId: string; pool: string; side: 'BUY_YES' | 'SELL_YES' | 'BUY_NO' | 'SELL_NO'; price: bigint; quantity: bigint; expireTimestampNs: bigint }): Promise<OrderResult>
}

/** Adapter boundary, not a claim that DreamDEX has provisioned a custom SOLZ oracle/market. */
export class DreamDexPredictionVenue implements PredictionVenue {
  readonly venue = 'DREAMDEX' as const
  readonly account: string
  readonly chainId: string
  constructor(private readonly driver: DreamDexDriver, private readonly now = Date.now) {
    this.account = driver.account
    this.chainId = driver.chainId
  }
  private checkMarket(market: Market): void {
    validateMarket(market)
    invariant(market.venue === this.venue && market.chainId === this.chainId && market.outcomes.length === 2, 'WRONG_MARKET', 'DreamDEX adapter requires a bound binary market on the selected chain.')
  }
  async listMarkets() { const markets = await this.driver.listMarkets(); markets.forEach(market => this.checkMarket(market)); return markets }
  async getMarket(id: string) { const snapshot = await this.driver.getSnapshot(id); this.checkMarket(snapshot.market); invariant(snapshot.market.id === id, 'WRONG_MARKET', 'Driver returned another market.'); return snapshot.market }
  getOrderBook(id: string, outcomeId?: number) { return this.driver.getOrderBook(id, outcomeId) }
  getPositions(account: string) { return this.driver.getPositions(account) }
  getOpenOrders(account: string, marketId?: string) { return this.driver.getOpenOrders(account, marketId) }
  getBalance(account: string) { return this.driver.getBalance(account) }
  cancelOrder(orderId: string): Promise<TxResult> { return this.driver.cancelOrder(orderId) }
  cancelAllOrders(marketId?: string): Promise<TxResult> { return this.driver.cancelAllOrders(marketId) }
  redeem(marketId: string): Promise<TxResult> { return this.driver.redeem(marketId) }

  async placeOrder(input: PlaceOrderInput): Promise<OrderResult> {
    const snapshot = await this.driver.getSnapshot(input.marketId)
    const { market } = snapshot
    this.checkMarket(market)
    const now = this.now()
    invariant(market.id === input.marketId && snapshot.poolMarketId === market.id && now - snapshot.readAt >= 0 && now - snapshot.readAt <= 5_000, 'STALE_MARKET', 'Pool generation or market snapshot is stale.')
    invariant(!market.paused && market.status === 'TRADING' && now >= market.tradingStartsAt && now < market.tradingLocksAt && input.expiresAt > now && input.expiresAt <= market.tradingLocksAt, 'MARKET_CLOSED', 'Market is not accepting this order.')
    invariant((input.outcomeId === 0 || input.outcomeId === 1) && (input.side === 'BUY' || input.side === 'SELL') && input.price > 0n && input.price < PRICE_SCALE && input.quantity > 0n, 'INVALID_ORDER', 'Invalid binary order.')
    const scale = 10n ** BigInt(market.collateralDecimals)
    const numerator = input.price * scale
    invariant(numerator % PRICE_SCALE === 0n, 'INVALID_PRICE', 'Price cannot be represented exactly on this venue.')
    const outcomePrice = numerator / PRICE_SCALE
    const yesPrice = input.outcomeId === 0 ? outcomePrice : scale - outcomePrice
    invariant(snapshot.tickSize > 0n && snapshot.lotSize > 0n && snapshot.minQuantity > 0n, 'INVALID_GRID', 'Invalid venue tick/lot configuration.')
    if (yesPrice % snapshot.tickSize !== 0n || input.quantity % snapshot.lotSize !== 0n || input.quantity < snapshot.minQuantity) throw new PredictionError('OFF_GRID', 'Price or quantity is outside the venue tick/lot grid.')
    invariant(Number.isSafeInteger(input.expiresAt), 'INVALID_TIMING', 'Expiry must be Unix milliseconds.')
    return this.driver.placeRawOrder({ marketId: market.id, pool: snapshot.pool, side: `${input.side}_${input.outcomeId === 0 ? 'YES' : 'NO'}`, price: yesPrice, quantity: input.quantity, expireTimestampNs: BigInt(input.expiresAt) * 1_000_000n })
  }
}
