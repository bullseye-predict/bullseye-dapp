import type { DepthLevel } from '../LiveOrderBook'

/** Which venue a market lives on. The UI must branch on this and nothing else. */
export type VenueFamily = 'DREAMDEX' | 'SOLANA'

/** Fields every venue binding exposes. Chain-specific fields live on the
 *  variants below and must never be read outside that venue's own hook. */
export type VenueBindingBase = {
  family: VenueFamily
  marketId: string
  tradingStartsAt: number
  tradingLocksAt: number
  creationTxHash?: string
  sponsoredTransactions?: { label: string; hash: string }[]
  volume24h?: { amount: string; decimals: number; trades: number }
  /** Enough for explorerTxUrl() to build a link on the right chain. */
  explorer?: { family?: string; chainId?: string; explorerUrl?: string }
}

export type DreamDexBinding = VenueBindingBase & {
  family: 'DREAMDEX'
  chainId: '5031' | '50312'
  marketId: `0x${string}`
  oracleQuestionId: string
  voidPolicy: 0 | 2
  indexerUrl: string
  wsRpcUrl: string
}

export type SolanaBinding = VenueBindingBase & {
  family: 'SOLANA'
  /** Question market PDA, base58. */
  marketId: string
  rpcUrl: string
  genesisHash: string
  predictionProgram: string
  manifestProgram: string
  collateralMint: string
  collateralDecimals: number
}

export type VenueBinding = DreamDexBinding | SolanaBinding

/** The order book as the UI renders it, in the venue's own collateral atoms. */
export type VenueBook = { yesAsks: DepthLevel[]; yesBids: DepthLevel[]; noAsks: DepthLevel[]; noBids: DepthLevel[] }

/** Everything a market view needs, with no venue-specific field left in it.
 *  A component receiving this cannot tell which chain it is rendering. */
export type VenueMarketView = {
  family: VenueFamily | null
  /** False when no on-chain market exists yet for this question. */
  opened: boolean
  book: VenueBook | null
  decimals: number
  last?: number
  finalized: boolean
  /** Milliseconds; the timestamp the data was read at. */
  now: number
  error: string | null
  refreshing: boolean
  refresh: () => void
}

export const EMPTY_VIEW: VenueMarketView = {
  family: null, opened: false, book: null, decimals: 6,
  finalized: false, now: 0, error: null, refreshing: false, refresh: () => {},
}
