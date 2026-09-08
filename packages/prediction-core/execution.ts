import type { OrderSide, SignedOrder, VenueId } from './types'
import { atomic, integer, invariant, parseSignedOrder, record, textField } from './validation'

export const MAX_EXECUTION_CHILDREN = 16
export const MAX_EXECUTION_MATCHES = 64
export const MAX_MARKET_QUOTE_TTL_MS = 15_000
export const MAX_MARKET_ORDER_TTL_MS = 30_000

export interface MarketExecutionScope { venue: VenueId; chainId: string; marketId: string }
export interface MarketQuoteRequest {
  account: string
  outcomeId: number
  side: OrderSide
  /** Exact atomic outcome shares requested, never a floating-point collateral amount. */
  quantity: bigint
  slippageBps: number
}

export type ExecutionPartialReason = 'NO_LIQUIDITY' | 'INSUFFICIENT_DEPTH' | 'SLIPPAGE_LIMIT' | 'ROUNDING_DUST' |
  'CHILD_LIMIT' | 'MATCH_LIMIT' | 'BOOK_CHANGED' | 'ORDER_EXPIRED' | 'SETTLEMENT_FAILED' | 'CANCELLED'

export interface MarketExecutionChild {
  index: number
  price: bigint
  quantity: bigint
  collateral: bigint
  /** The wallet adds a unique nonce, canonical orderId, and chain signature. */
  order: Omit<SignedOrder, 'nonce' | 'orderId' | 'signature'>
}

/** A quote is indicative and reserves no liquidity. All timestamps use Unix milliseconds. */
export interface MarketExecutionQuote extends MarketExecutionScope {
  id: string
  account: string
  outcomeId: number
  side: OrderSide
  slippageBps: number
  requestedQuantity: bigint
  executableQuantity: bigint
  unfilledQuantity: bigint
  estimatedCollateral: bigint
  averagePrice: bigint | null
  bestPrice: bigint | null
  limitPrice: bigint | null
  createdAt: number
  expiresAt: number
  orderExpiresAt: number
  children: MarketExecutionChild[]
  partialReasons: ExecutionPartialReason[]
  childrenHash: string
  quoteHash: string
  executionGuarantee: 'OFFCHAIN_IOC_ONLY'
}

/**
 * This intent must be authenticated by the API wallet-request proof over the exact
 * request body. It is NOT in existing EVM/Solana order signatures: those contracts
 * enforce each child's price, quantity, nonce, and short expiry only. A leaked
 * child signature remains a chain-valid limit order until expiry/on-chain revocation.
 * Separate child transactions are not an atomic basket and provide no FOK promise.
 */
export interface MarketExecutionIntent {
  type: 'MARKET_IOC'
  quoteId: string
  quoteHash: string
  childrenHash: string
}

export interface MarketExecutionRequest {
  intent: MarketExecutionIntent
  orders: SignedOrder[]
}

export type MarketExecutionStatus = 'RESERVED' | 'PENDING' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'FAILED'

export interface MarketExecution extends MarketExecutionScope {
  id: string
  quoteId: string
  account: string
  outcomeId: number
  side: OrderSide
  status: MarketExecutionStatus
  requestedQuantity: bigint
  plannedQuantity: bigint
  pendingQuantity: bigint
  filledQuantity: bigint
  cancelledQuantity: bigint
  plannedCollateral: bigint
  confirmedCollateral: bigint
  orderIds: string[]
  settlementIds: string[]
  createdAt: number
  updatedAt: number
  partialReasons: ExecutionPartialReason[]
  executionGuarantee: 'OFFCHAIN_IOC_ONLY'
}

function allowFields(input: Record<string, unknown>, allowed: string[]): void {
  invariant(Object.keys(input).every((key) => allowed.includes(key)), 'INVALID_EXECUTION', 'Unknown execution request field.')
}

export function parseMarketQuoteRequest(value: unknown): MarketQuoteRequest {
  const input = record(value)
  allowFields(input, ['account', 'outcomeId', 'side', 'quantity', 'slippageBps'])
  invariant(input.side === 'BUY' || input.side === 'SELL', 'INVALID_SIDE', 'side must be BUY or SELL.')
  const quantity = atomic(input.quantity, 'quantity')
  invariant(quantity > 0n, 'INVALID_AMOUNT', 'Market quantity must be positive.')
  return {
    account: textField(input.account, 'account'), outcomeId: integer(input.outcomeId, 'outcomeId', 0, 15),
    side: input.side, quantity, slippageBps: integer(input.slippageBps, 'slippageBps', 0, 10_000),
  }
}

export function parseMarketExecutionRequest(value: unknown): MarketExecutionRequest {
  const input = record(value)
  allowFields(input, ['intent', 'orders'])
  const intent = record(input.intent)
  allowFields(intent, ['type', 'quoteId', 'quoteHash', 'childrenHash'])
  invariant(intent.type === 'MARKET_IOC', 'INVALID_EXECUTION', 'Only authenticated off-chain MARKET_IOC execution is supported.')
  const quoteHash = textField(intent.quoteHash, 'quoteHash')
  const childrenHash = textField(intent.childrenHash, 'childrenHash')
  invariant(/^0x[0-9a-f]{64}$/.test(quoteHash) && /^0x[0-9a-f]{64}$/.test(childrenHash), 'INVALID_EXECUTION', 'Invalid quote binding hash.')
  invariant(Array.isArray(input.orders) && input.orders.length <= MAX_EXECUTION_CHILDREN, 'INVALID_EXECUTION', 'Too many signed execution children.')
  return {
    intent: { type: 'MARKET_IOC', quoteId: textField(intent.quoteId, 'quoteId'), quoteHash, childrenHash },
    orders: input.orders.map(parseSignedOrder),
  }
}

function childBinding(child: MarketExecutionChild): unknown[] {
  const order = child.order
  return [child.index, child.price.toString(), child.quantity.toString(), child.collateral.toString(),
    order.venue, order.chainId, order.marketId, order.maker, order.outcomeId, order.side,
    order.price.toString(), order.quantity.toString(), order.expiresAt]
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function hashExecutionChildren(children: readonly MarketExecutionChild[]): Promise<string> {
  return sha256(['SOLZ_MARKET_EXECUTION_CHILDREN_V1', children.map(childBinding)])
}

/** Canonical hash binds the complete account, venue, market, limits and child templates. */
export async function bindMarketExecutionQuote(quote: Omit<MarketExecutionQuote, 'childrenHash' | 'quoteHash'>): Promise<MarketExecutionQuote> {
  const childrenHash = await hashExecutionChildren(quote.children)
  const quoteHash = await sha256(['SOLZ_MARKET_EXECUTION_QUOTE_V1', quote.id, quote.venue, quote.chainId, quote.marketId,
    quote.account, quote.outcomeId, quote.side, quote.slippageBps, quote.requestedQuantity.toString(), quote.executableQuantity.toString(),
    quote.unfilledQuantity.toString(), quote.estimatedCollateral.toString(), quote.averagePrice?.toString() ?? null,
    quote.bestPrice?.toString() ?? null, quote.limitPrice?.toString() ?? null, quote.createdAt, quote.expiresAt, quote.orderExpiresAt,
    quote.partialReasons, quote.executionGuarantee, childrenHash])
  return { ...quote, childrenHash, quoteHash }
}
