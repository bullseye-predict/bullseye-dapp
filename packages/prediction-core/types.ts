/** Amounts and shares are atomic collateral units; prices use six decimal places. */
export const PRICE_SCALE = 1_000_000n
export const MAX_OUTCOMES = 16
export type VenueId = 'SOLANA' | 'SOMNIA' | 'DREAMDEX' | '0G' | 'ROBINHOOD' | 'EVM'
export type MarketStatus = 'PENDING' | 'TRADING' | 'LOCKED' | 'RESOLVED' | 'VOIDED'
export type OrderSide = 'BUY' | 'SELL'
export type OrderStatus = 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'EXPIRED'

export interface Outcome {
  id: number
  label: string
  entityId?: string
  metadata?: { teamId?: string; playerId?: string; agentId?: string }
}

/** All application timestamps are Unix milliseconds. Adapters convert to chain seconds. */
export interface Market {
  matchingEngine?: 'CUSTOM' | 'MANIFEST'
  id: string
  matchId: string
  venue: VenueId
  chainId: string
  marketAddress: string
  collateralToken: string
  collateralDecimals: number
  outcomes: Outcome[]
  status: MarketStatus
  createdAt: number
  tradingStartsAt: number
  tradingLocksAt: number
  expiresAt: number
  winningOutcomeId?: number
  paused: boolean
}

export interface MarketVenueBinding {
  matchId: string
  venue: VenueId
  chainId: string
  marketAddress: string
  marketId: string
}

export interface SignedOrder {
  orderId: string
  venue: VenueId
  chainId: string
  maker: string
  marketId: string
  outcomeId: number
  side: OrderSide
  price: bigint
  quantity: bigint
  nonce: bigint
  expiresAt: number
  signature: string
}

export interface Order extends SignedOrder {
  filled: bigint
  status: OrderStatus
  createdAt: number
  sequence: number
}

export interface OrderBookLevel {
  price: bigint
  quantity: bigint
  orderCount: number
}

export interface OutcomeOrderBook {
  outcomeId: number
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  lastTradePrice?: bigint
}

export interface OrderBook {
  marketId: string
  venue: VenueId
  chainId: string
  updatedAt: number
  outcomes: OutcomeOrderBook[]
}

export interface Fill {
  id: string
  venue: VenueId
  chainId: string
  marketId: string
  outcomeId: number
  buyOrderId: string
  sellOrderId: string
  price: bigint
  quantity: bigint
  txHash: string
  timestamp: number
}

export interface Position {
  account: string
  venue: VenueId
  chainId: string
  marketId: string
  outcomeId: number
  quantity: bigint
  reservedQuantity: bigint
  costBasis: bigint
  realizedPnl: bigint
}

export interface Balance {
  account: string
  collateralToken: string
  total: bigint
  available: bigint
  reserved: bigint
}

export interface PlaceOrderInput {
  marketId: string
  outcomeId: number
  side: OrderSide
  price: bigint
  quantity: bigint
  expiresAt: number
}

export interface TxResult {
  id: string
  status: 'SUBMITTED' | 'CONFIRMED'
  txHash?: string
}

export interface OrderResult {
  orderId: string
  status: OrderStatus
}

export interface SignedMatchResult {
  matchId: string
  marketId: string
  venue: VenueId
  chainId: string
  winningOutcomeId: number
  voided: boolean
  stateHash: string
  matchEndedAt: number
  /** Optional chain-specific nonce; single-finalization EVM results use the market as replay key. */
  nonce?: bigint
  expiresAt: number
  signature: string
}

export interface ParticipantState {
  id: string
  teamId?: string
  hp: number
  maxHp: number
  alive: boolean
  kills: number
}

export interface MatchTelemetry {
  matchId: string
  sequence: number
  timestamp: number
  remainingMs: number
  participants: ParticipantState[]
  score: Record<string, number>
  objectives: Record<string, number>
  kills: Array<{ id: string; killerId: string; victimId: string; timestamp: number }>
}

export interface HermesRiskPolicy {
  totalCapital: bigint
  maxTradeSize: bigint
  maxPositionSize: bigint
  maxLossPerMatch: bigint
  maxOpenOrders: number
  minimumConfidence: number
  minimumEdge: bigint
  maxSlippage: bigint
  stopTradingBeforeMatchEndSeconds: number
  maxTelemetryAgeMs: number
}
