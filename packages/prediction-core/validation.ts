import { MAX_OUTCOMES, PRICE_SCALE, type Market, type SignedOrder, type VenueId } from './types'

export class PredictionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message)
    this.name = 'PredictionError'
  }
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new PredictionError(code, message)
}

export function record(value: unknown): Record<string, unknown> {
  invariant(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_INPUT', 'Expected an object.')
  return value as Record<string, unknown>
}

export function textField(value: unknown, name: string, max = 256): string {
  invariant(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value), 'INVALID_INPUT', `${name} must be a nonempty string of at most ${max} characters.`)
  return value
}

export function integer(value: unknown, name: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  invariant(typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_INPUT', `${name} must be a safe integer between ${min} and ${max}.`)
  return value
}

export function atomic(value: unknown, name: string, max = (1n << 128n) - 1n): bigint {
  invariant(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value)), 'INVALID_AMOUNT', `${name} must be an unsigned integer string.`)
  const amount = BigInt(value)
  invariant(amount >= 0n && amount <= max, 'INVALID_AMOUNT', `${name} is out of range.`)
  return amount
}

export function venueId(value: unknown): VenueId {
  invariant(['SOLANA', 'SOMNIA', 'DREAMDEX', '0G', 'ROBINHOOD', 'EVM'].includes(String(value)), 'INVALID_VENUE', 'Unsupported venue.')
  return value as VenueId
}

export function marketKey(venue: VenueId, chainId: string, marketId: string): string {
  return JSON.stringify([venue, chainId, marketId])
}

export function quoteCeil(quantity: bigint, price: bigint): bigint {
  invariant(quantity >= 0n && price >= 0n && price <= PRICE_SCALE, 'INVALID_AMOUNT', 'Invalid quantity or price.')
  return (quantity * price + PRICE_SCALE - 1n) / PRICE_SCALE
}

export function validateMarket(market: Market): void {
  textField(market.id, 'marketId')
  textField(market.matchId, 'matchId')
  venueId(market.venue)
  textField(market.chainId, 'chainId')
  textField(market.marketAddress, 'marketAddress')
  textField(market.collateralToken, 'collateralToken')
  integer(market.collateralDecimals, 'collateralDecimals', 0, 18)
  invariant(Array.isArray(market.outcomes) && market.outcomes.length >= 2 && market.outcomes.length <= MAX_OUTCOMES, 'INVALID_OUTCOMES', `Markets require 2–${MAX_OUTCOMES} outcomes.`)
  market.outcomes.forEach((outcome, index) => {
    invariant(outcome.id === index, 'INVALID_OUTCOMES', 'Outcome IDs must be contiguous from zero.')
    textField(outcome.label, 'outcome label', 100)
  })
  for (const [name, value] of Object.entries({ createdAt: market.createdAt, tradingStartsAt: market.tradingStartsAt, tradingLocksAt: market.tradingLocksAt, expiresAt: market.expiresAt })) integer(value, name)
  invariant(market.createdAt <= market.tradingStartsAt && market.tradingStartsAt < market.tradingLocksAt && market.tradingLocksAt <= market.expiresAt, 'INVALID_TIMING', 'Market timing must follow creation, start, lock, expiry.')
  invariant(['PENDING', 'TRADING', 'LOCKED', 'RESOLVED', 'VOIDED'].includes(market.status), 'INVALID_STATUS', 'Invalid market status.')
  invariant(typeof market.paused === 'boolean', 'INVALID_INPUT', 'paused must be a boolean.')
  if (market.status === 'RESOLVED') integer(market.winningOutcomeId, 'winningOutcomeId', 0, market.outcomes.length - 1)
  else invariant(market.winningOutcomeId === undefined, 'INVALID_OUTCOME', 'Only resolved markets have a winner.')
}

export function effectiveMarket(market: Market, now: number): Market {
  if (market.status === 'RESOLVED' || market.status === 'VOIDED') return market
  if (now >= market.tradingLocksAt) return { ...market, status: 'LOCKED' }
  if (market.status === 'PENDING' && now >= market.tradingStartsAt) return { ...market, status: 'TRADING' }
  return market
}

export function parseSignedOrder(value: unknown): SignedOrder {
  const input = record(value)
  invariant(input.side === 'BUY' || input.side === 'SELL', 'INVALID_SIDE', 'side must be BUY or SELL.')
  return {
    orderId: textField(input.orderId, 'orderId'),
    venue: venueId(input.venue),
    chainId: textField(input.chainId, 'chainId'),
    maker: textField(input.maker, 'maker'),
    marketId: textField(input.marketId, 'marketId'),
    outcomeId: integer(input.outcomeId, 'outcomeId', 0, MAX_OUTCOMES - 1),
    side: input.side,
    price: atomic(input.price, 'price', PRICE_SCALE),
    quantity: atomic(input.quantity, 'quantity'),
    nonce: atomic(input.nonce, 'nonce', (1n << 256n) - 1n),
    expiresAt: integer(input.expiresAt, 'expiresAt'),
    signature: textField(input.signature, 'signature', 8192),
  }
}

export function validateOrder(order: SignedOrder, market: Market, now: number): void {
  parseSignedOrder(order)
  validateMarket(market)
  invariant(order.venue === market.venue && order.chainId === market.chainId && order.marketId === market.id, 'WRONG_MARKET', 'Order venue, chain, and market must match.')
  const current = effectiveMarket(market, now)
  invariant(current.status === 'TRADING' && !current.paused && now >= current.tradingStartsAt, 'MARKET_CLOSED', 'Market is not accepting trades.')
  invariant(order.outcomeId < market.outcomes.length, 'INVALID_OUTCOME', 'Outcome does not belong to this market.')
  invariant(order.price > 0n && order.price <= PRICE_SCALE && order.quantity > 0n, 'INVALID_ORDER', 'Price must be greater than zero and at most one; quantity must be positive.')
  invariant(order.expiresAt > now && order.expiresAt <= market.tradingLocksAt, 'ORDER_EXPIRED', 'Order expiry must be after now and no later than market lock.')
  invariant(order.expiresAt % 1000 === 0, 'INVALID_TIMING', 'Order expiry must align to a whole Unix second.')
}
