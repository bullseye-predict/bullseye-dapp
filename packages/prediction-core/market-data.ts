import type { Fill, Market, MatchTelemetry, OrderBook, Position, VenueId } from './types'

/** Only explicitly public RPC endpoints may be put in this response. */
export interface PublicPredictionVenue {
  arenaMarketBindings?: { eventId: string; marketId: string }[]
  matchingEngine?: 'CUSTOM' | 'MANIFEST'
  manifestProgramId?: string
  manifestMarkets?: { address: string; matchId: string; label: string; outcomes: string[] }[]
  family: 'EVM' | 'SOLANA'
  venue: VenueId
  chainId: string
  label: string
  collateralToken: string
  collateralDecimals: number
  collateralSymbol: string
  publicRpcUrl?: string
  settlementAddress?: string
  factoryAddress?: string
  oracleAddress?: string
  programId?: string
  networkDomain?: string
  explorerUrl?: string
}
export interface DreamDexPublicConfig {
  demoCreation?: boolean
  chainId: '5031' | '50312'
  label: string
  indexerUrl: string
  wsRpcUrl: string
  markets: { eventId: string; questionId?: string; subjectId?: string; label: string; marketId: `0x${string}`; oracleQuestionId: string; tradingStartsAt: number; tradingLocksAt: number; voidPolicy: 0 | 2; creationTxHash?: `0x${string}`; sponsoredTransactions?: { label: string; hash: `0x${string}` }[] }[]
}
export interface PredictionPublicConfig {
  dreamdex?: DreamDexPublicConfig[]
  audience: string
  venues: PublicPredictionVenue[]
}
export interface Candle {
  timestamp: number
  open: bigint
  high: bigint
  low: bigint
  close: bigint
  volume: bigint
  collateralVolume: bigint
  trades: number
}
/** One sampled market price, YES-denominated micros.
 *
 *  Separate from `Candle` on purpose: a candle describes trades in a bucket,
 *  and cannot say "bid 40, ask 60, and this number is a wide-spread midpoint".
 *  Overloading the candle shape to carry that would make `Candle[]` lie about
 *  what it is. */
export interface PricePoint {
  t: number
  p: bigint
  basis: string
  bid?: bigint
  ask?: bigint
}
export interface PriceSeries {
  fidelityMs: number
  points: PricePoint[]
}
export interface MarketSnapshot {
  market: Market
  book: OrderBook
  trades: Fill[]
  /** Cursor is sampled BEFORE the state, so reconnect can duplicate but never skip a change. */
  sequence: number
  serverTime: number
  telemetry?: MatchTelemetry
}
export interface PortfolioProvenance {
  source: 'ONCHAIN' | 'INDEXER'
  observedAt: number
  finality?: 'FINALIZED' | 'CONFIRMED'
  blockNumber?: string
  slot?: number
}
/** Transfers and redemptions need a complete index to determine acquisition cost/PnL. */
export type PortfolioPosition = Omit<Position, 'costBasis' | 'realizedPnl'> & {
  costBasis: bigint | null
  realizedPnl: bigint | null
  accountingComplete?: boolean
  provenance?: PortfolioProvenance
}
