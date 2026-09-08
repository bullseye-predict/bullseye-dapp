import { PRICE_SCALE, type Balance, type HermesRiskPolicy, type Market, type MatchTelemetry, type Order, type OrderBook, type OrderBookLevel, type Position } from '../prediction-core/types'
import { quoteCeil as quote, validateMarket } from '../prediction-core/validation'
import { parseHermesAction, type HermesAction, type TradeAction } from './actions'

export interface HermesSessionPolicy extends HermesRiskPolicy {
  expiresAt: number
  maxOrderBookAgeMs: number
  maxLossPerPosition: bigint
}

export interface RiskSnapshot {
  account: string
  market: Market
  telemetry: MatchTelemetry
  book: OrderBook
  positions: Position[]
  openOrders: Order[]
  balance: Balance
  now: number
}

export type RiskDecision = { allowed: true } | { allowed: false; code: string; message: string }

const deny = (code: string, message: string): RiskDecision => ({ allowed: false, code, message })
const remaining = (order: Order): bigint => order.quantity - order.filled
const sum = <T>(values: T[], projection: (value: T) => bigint): bigint => values.reduce((total, value) => total + projection(value), 0n)
const negative = (value: bigint): bigint => value < 0n ? -value : 0n
const maximum = (a: bigint, b: bigint): bigint => a > b ? a : b
const accountKey = (market: Market, account: string): string => market.venue === 'SOLANA' ? account : account.toLowerCase()

function liquidationValue(quantity: bigint, bids: OrderBookLevel[]): bigint {
  let remainder = quantity
  let value = 0n
  for (const bid of bids) {
    const fill = remainder < bid.quantity ? remainder : bid.quantity
    // Use available depth and round revenue down; missing liquidity is valued at zero.
    value += fill * bid.price / PRICE_SCALE
    remainder -= fill
    if (remainder === 0n) break
  }
  return value
}

/** Immutable, host-authorized hard policy. Prompt text is never read by this engine. */
export class RiskEngine {
  readonly policy: Readonly<HermesSessionPolicy>

  constructor(policy: HermesSessionPolicy) {
    const copy = { ...policy }
    for (const field of ['totalCapital', 'maxTradeSize', 'maxPositionSize', 'maxLossPerMatch', 'maxLossPerPosition'] as const) {
      if (typeof copy[field] !== 'bigint' || copy[field] <= 0n || copy[field] >= 2n ** 128n) throw new Error(`Invalid policy ${field}`)
    }
    if (copy.maxTradeSize > copy.totalCapital || copy.maxLossPerPosition > copy.maxLossPerMatch || copy.maxLossPerMatch > copy.totalCapital) {
      throw new Error('Risk limits must fit allocated capital and match loss budget')
    }
    for (const field of ['minimumEdge', 'maxSlippage'] as const) {
      if (typeof copy[field] !== 'bigint' || copy[field] < 0n || copy[field] > PRICE_SCALE) throw new Error(`Invalid policy ${field}`)
    }
    for (const field of ['maxOpenOrders', 'expiresAt', 'maxOrderBookAgeMs', 'maxTelemetryAgeMs'] as const) {
      if (!Number.isSafeInteger(copy[field]) || copy[field] <= 0) throw new Error(`Invalid policy ${field}`)
    }
    if (!Number.isSafeInteger(copy.stopTradingBeforeMatchEndSeconds) || copy.stopTradingBeforeMatchEndSeconds < 0 ||
      !Number.isFinite(copy.minimumConfidence) || copy.minimumConfidence < 0 || copy.minimumConfidence > 1) throw new Error('Invalid risk threshold')
    this.policy = Object.freeze(copy)
    Object.freeze(this)
  }

  /** A failed gate requires cancelling open orders before the agent can report stopped. */
  stopReason(snapshot: RiskSnapshot): RiskDecision {
    const shape = this.validateSnapshot(snapshot)
    if (!shape.allowed) return shape
    const { market, telemetry, book, now } = snapshot
    if (now >= this.policy.expiresAt) return deny('SESSION_EXPIRED', 'Agent authorization has expired')
    if (market.status !== 'TRADING' || market.paused || now < market.tradingStartsAt || now >= market.tradingLocksAt || now >= market.expiresAt) {
      return deny('MARKET_CLOSED', 'Market is paused or outside its trading window')
    }
    const stopAt = Math.min(market.tradingLocksAt, market.expiresAt, telemetry.timestamp + telemetry.remainingMs) -
      this.policy.stopTradingBeforeMatchEndSeconds * 1000
    if (now >= stopAt) return deny('MATCH_CUTOFF', 'Approaching the authoritative match cutoff')
    if (telemetry.timestamp > now || now - telemetry.timestamp > this.policy.maxTelemetryAgeMs) return deny('STALE_TELEMETRY', 'Fresh authoritative telemetry is required')
    if (book.updatedAt > now || now - book.updatedAt > this.policy.maxOrderBookAgeMs) return deny('STALE_BOOK', 'Fresh order book is required')
    const positions = snapshot.positions.filter((position) => position.marketId === market.id)
    const orders = snapshot.openOrders.filter((order) => order.marketId === market.id)
    const realizedLoss = negative(sum(positions, (position) => position.realizedPnl))
    // Cost at risk includes every reserved BUY. Gross cost is conservative for complete sets.
    const atRisk = sum(positions, (position) => position.costBasis) + sum(orders.filter((order) => order.side === 'BUY'),
      (order) => quote(remaining(order), order.price)) + realizedLoss
    if (atRisk > this.policy.maxLossPerMatch || realizedLoss >= this.policy.maxLossPerMatch) return deny('MATCH_LOSS_LIMIT', 'Match loss budget exceeded')
    const markedMatchLoss = realizedLoss + sum(positions, (position) => {
      const bids = book.outcomes.find((entry) => entry.outcomeId === position.outcomeId)?.bids ?? []
      return maximum(0n, position.costBasis - liquidationValue(position.quantity, bids))
    })
    if (markedMatchLoss >= this.policy.maxLossPerMatch) return deny('MATCH_STOP_LOSS', 'Match reached its loss stop')
    if (this.capitalUsed(snapshot) > this.policy.totalCapital) return deny('CAPITAL_LIMIT', 'Allocated capital including open orders is exceeded')
    if (snapshot.openOrders.length > this.policy.maxOpenOrders) return deny('OPEN_ORDER_LIMIT', 'Open order limit exceeded')
    for (const outcome of market.outcomes) {
      const position = positions.find((entry) => entry.outcomeId === outcome.id)
      const buys = orders.filter((order) => order.outcomeId === outcome.id && order.side === 'BUY')
      const exposure = (position?.quantity ?? 0n) + sum(buys, remaining)
      const positionRisk = (position?.costBasis ?? 0n) + negative(position?.realizedPnl ?? 0n) + sum(buys, (order) => quote(remaining(order), order.price))
      if (exposure > this.policy.maxPositionSize) return deny('POSITION_LIMIT', 'Position and reserved orders exceed the share limit')
      if (positionRisk > this.policy.maxLossPerPosition) return deny('POSITION_LOSS_LIMIT', 'Position loss budget exceeded')
      if (position) {
        const bids = book.outcomes.find((entry) => entry.outcomeId === outcome.id)?.bids ?? []
        const markedLoss = negative(position.realizedPnl) + maximum(0n, position.costBasis - liquidationValue(position.quantity, bids))
        if (markedLoss >= this.policy.maxLossPerPosition) return deny('POSITION_STOP_LOSS', 'Position reached its loss stop')
      }
    }
    return { allowed: true }
  }

  evaluate(output: HermesAction | unknown, snapshot: RiskSnapshot): RiskDecision {
    let action: HermesAction
    try { action = parseHermesAction(output) } catch (error) { return deny('INVALID_ACTION', (error as Error).message) }
    // Cancellation remains available through every loss, expiry, pause and stale-data gate.
    if (action.action === 'CANCEL_ALL') return { allowed: true }
    if (action.action === 'CANCEL') {
      const order = snapshot.openOrders.find((entry) => entry.orderId === action.orderId)
      return order && order.marketId === snapshot.market.id && order.venue === snapshot.market.venue && order.chainId === snapshot.market.chainId &&
        accountKey(snapshot.market, order.maker) === accountKey(snapshot.market, snapshot.account)
        ? { allowed: true } : deny('ORDER_SCOPE', 'Cancellation must target an order in this account and market')
    }
    const gate = this.stopReason(snapshot)
    if (!gate.allowed) return gate
    if (action.action === 'HOLD') return { allowed: true }
    return this.evaluateTrade(action, snapshot)
  }

  private evaluateTrade(action: TradeAction, snapshot: RiskSnapshot): RiskDecision {
    const { market, book, now, positions, openOrders, balance } = snapshot
    const policy = this.policy
    if (!market.outcomes.some((outcome) => outcome.id === action.outcomeId)) return deny('OUTCOME_SCOPE', 'Unknown outcome')
    const cutoff = Math.min(policy.expiresAt, Math.min(market.tradingLocksAt, market.expiresAt,
      snapshot.telemetry.timestamp + snapshot.telemetry.remainingMs) - policy.stopTradingBeforeMatchEndSeconds * 1000)
    if (action.expiresAt <= now || action.expiresAt > cutoff) return deny('ORDER_EXPIRY', 'Order must expire within the authorized trading window')
    if (action.confidence < policy.minimumConfidence) return deny('CONFIDENCE', 'Minimum confidence is not met')
    const scaledProbability = action.estimatedProbability * Number(PRICE_SCALE)
    const probability = BigInt(action.action === 'BUY' ? Math.floor(scaledProbability) : Math.ceil(scaledProbability))
    const edge = action.action === 'BUY' ? probability - action.limitPrice : action.limitPrice - probability
    if (edge < policy.minimumEdge) return deny('EDGE', 'Minimum estimated edge is not met')
    const outcomeBook = book.outcomes.find((outcome) => outcome.outcomeId === action.outcomeId)
    const reference = action.action === 'BUY' ? outcomeBook?.asks[0]?.price : outcomeBook?.bids[0]?.price
    if (reference === undefined) return deny('NO_REFERENCE_PRICE', 'A live executable reference price is required')
    if ((action.action === 'BUY' && action.limitPrice > reference + policy.maxSlippage) ||
      (action.action === 'SELL' && action.limitPrice + policy.maxSlippage < reference)) return deny('SLIPPAGE', 'Limit price exceeds allowed slippage')
    const notional = quote(action.amount, action.limitPrice)
    if (notional > policy.maxTradeSize) return deny('TRADE_SIZE', 'Trade exceeds the collateral notional limit')
    if (openOrders.length >= policy.maxOpenOrders) return deny('OPEN_ORDER_LIMIT', 'Open order limit is reached')
    const position = positions.find((entry) => entry.marketId === market.id && entry.outcomeId === action.outcomeId)
    const ownOutcomeOrders = openOrders.filter((order) => order.marketId === market.id && order.outcomeId === action.outcomeId)
    if (action.action === 'SELL') {
      const reserved = maximum(position?.reservedQuantity ?? 0n, sum(ownOutcomeOrders.filter((order) => order.side === 'SELL'), remaining))
      if (action.amount > (position?.quantity ?? 0n) - reserved) return deny('INSUFFICIENT_POSITION', 'Shares are unavailable or already reserved')
      return { allowed: true }
    }
    const buyReservations = sum(openOrders.filter((order) => order.side === 'BUY'), (order) => quote(remaining(order), order.price))
    // Adapter balance.reserved may already include book reservations; never double credit it.
    const spendable = balance.available - maximum(0n, buyReservations - balance.reserved)
    if (notional > spendable) return deny('INSUFFICIENT_CAPITAL', 'Collateral is unavailable or already reserved')
    if (this.capitalUsed(snapshot) + notional > policy.totalCapital) return deny('CAPITAL_LIMIT', 'Trade exceeds allocated capital')
    const outcomeBuys = ownOutcomeOrders.filter((order) => order.side === 'BUY')
    if ((position?.quantity ?? 0n) + sum(outcomeBuys, remaining) + action.amount > policy.maxPositionSize) return deny('POSITION_LIMIT', 'Shares including open orders exceed the position limit')
    const outcomeRisk = (position?.costBasis ?? 0n) + negative(position?.realizedPnl ?? 0n) +
      sum(outcomeBuys, (order) => quote(remaining(order), order.price)) + notional
    if (outcomeRisk > policy.maxLossPerPosition) return deny('POSITION_LOSS_LIMIT', 'Trade exceeds the position loss budget')
    const matchPositions = positions.filter((entry) => entry.marketId === market.id)
    const matchRisk = sum(matchPositions, (entry) => entry.costBasis) + negative(sum(matchPositions, (entry) => entry.realizedPnl)) +
      sum(openOrders.filter((order) => order.marketId === market.id && order.side === 'BUY'), (order) => quote(remaining(order), order.price)) + notional
    if (matchRisk > policy.maxLossPerMatch) return deny('MATCH_LOSS_LIMIT', 'Trade exceeds the match loss budget')
    return { allowed: true }
  }

  private capitalUsed(snapshot: RiskSnapshot): bigint {
    return sum(snapshot.positions, (position) => position.costBasis + negative(position.realizedPnl)) +
      sum(snapshot.openOrders.filter((order) => order.side === 'BUY'), (order) => quote(remaining(order), order.price))
  }

  private validateSnapshot(snapshot: RiskSnapshot): RiskDecision {
    const { market, telemetry, book, balance, now } = snapshot
    try { validateMarket(market) } catch { return deny('INVALID_MARKET', 'Market metadata or authoritative timing is invalid') }
    const account = accountKey(market, snapshot.account)
    if (!Number.isSafeInteger(now) || now < 0 || telemetry.matchId !== market.matchId || book.marketId !== market.id ||
      book.venue !== market.venue || book.chainId !== market.chainId || accountKey(market, balance.account) !== account ||
      balance.collateralToken !== market.collateralToken) return deny('SNAPSHOT_SCOPE', 'Snapshot account, market, or chain mismatch')
    if (![telemetry.timestamp, telemetry.remainingMs, book.updatedAt].every((value) => Number.isSafeInteger(value) && value >= 0)) {
      return deny('INVALID_SNAPSHOT', 'Invalid telemetry or book timestamp')
    }
    if ([balance.total, balance.available, balance.reserved].some((value) => typeof value !== 'bigint' || value < 0n) ||
      balance.total !== balance.available + balance.reserved) return deny('INVALID_BALANCE', 'Inconsistent balance snapshot')
    const seenPositions = new Set<string>()
    for (const position of snapshot.positions) {
      const key = JSON.stringify([position.marketId, position.outcomeId])
      if (position.venue !== market.venue || position.chainId !== market.chainId || accountKey(market, position.account) !== account ||
        seenPositions.has(key) || [position.quantity, position.reservedQuantity, position.costBasis].some((value) => typeof value !== 'bigint' || value < 0n) ||
        position.reservedQuantity > position.quantity || typeof position.realizedPnl !== 'bigint') return deny('INVALID_POSITION', 'Invalid account position snapshot')
      seenPositions.add(key)
    }
    const seenOrders = new Set<string>()
    for (const order of snapshot.openOrders) {
      if (order.venue !== market.venue || order.chainId !== market.chainId || accountKey(market, order.maker) !== account ||
        seenOrders.has(order.orderId) || (order.side !== 'BUY' && order.side !== 'SELL') ||
        !['OPEN', 'PARTIALLY_FILLED'].includes(order.status) ||
        [order.quantity, order.filled, order.price].some((value) => typeof value !== 'bigint') ||
        order.quantity <= order.filled || order.filled < 0n || order.price <= 0n || order.price > PRICE_SCALE) return deny('INVALID_ORDERS', 'Invalid account open order snapshot')
      seenOrders.add(order.orderId)
    }
    const seenOutcomes = new Set<number>()
    for (const outcome of book.outcomes) {
      if (!market.outcomes.some((entry) => entry.id === outcome.outcomeId) || seenOutcomes.has(outcome.outcomeId)) return deny('INVALID_BOOK', 'Unknown or duplicate book outcome')
      seenOutcomes.add(outcome.outcomeId)
      for (const [side, levels] of [['BUY', outcome.bids], ['SELL', outcome.asks]] as const) {
        for (let index = 0; index < levels.length; index++) {
          const level = levels[index]!
          const previous = levels[index - 1]
          if (typeof level.price !== 'bigint' || level.price <= 0n || level.price > PRICE_SCALE || typeof level.quantity !== 'bigint' ||
            level.quantity <= 0n || !Number.isSafeInteger(level.orderCount) || level.orderCount <= 0 ||
            (previous && (side === 'BUY' ? previous.price <= level.price : previous.price >= level.price))) return deny('INVALID_BOOK', 'Invalid or unsorted book levels')
        }
      }
    }
    return { allowed: true }
  }
}
