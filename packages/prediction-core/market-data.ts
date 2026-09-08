import type { Fill, Market, MatchTelemetry, OrderBook, Position, VenueId } from './types'

/** Only explicitly public RPC endpoints may be put in this response. */
export interface PublicPredictionVenue {
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
export interface PredictionPublicConfig {
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
