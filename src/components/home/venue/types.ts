import type { DepthLevel } from '../LiveOrderBook'

/** Which venue a market lives on. The UI must branch on this and nothing else. */
export type VenueFamily = 'DREAMDEX' | 'SOLANA'

/** One row of market activity, in the shape the renderer already consumes.
 *  Field-compatible with the DreamDEX indexer's MarketActivity so that path
 *  passes through unchanged. `block` is an EVM block number on DreamDEX and a
 *  Solana slot here; both only ever order rows against their own venue. */
export type VenueActivityRow = {
  id: string
  at: number
  hash: string
  label: string
  detail: string
  owner?: string
  kind: 'fill' | 'order' | 'cancel'
  block: bigint
}

/** One wallet's holding of one outcome, in that outcome's own shares.
 *
 *  `outcomeId` is the market's own outcome id rather than a venue index, so the
 *  leaderboard can group and colour rows without knowing which chain produced
 *  them. There is deliberately no average price or P&L here: no account on any
 *  of these venues stores a cost basis, so a third party's entry price is not
 *  derivable and must not be rendered. */
export type VenueHolderRow = { owner: string; outcomeId: string; shares: number; self: boolean }

/** Fields every venue binding exposes. Chain-specific fields live on the
 *  variants below and must never be read outside that venue's own hook. */
export type VenueBindingBase = {
  family: VenueFamily
  marketId: string
  /** True only after the venue market account actually exists. A deterministic
   * address alone is eligibility, not an on-chain market. */
  opened?: boolean
  tradingStartsAt: number
  tradingLocksAt: number
  creationTxHash?: string
  sponsoredTransactions?: { label: string; hash: string }[]
  /** Lifetime matched collateral reported by the venue market accounts. */
  volume?: { amount: string; decimals: number }
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

/** The order book as the UI renders it, in the venue's own collateral atoms.
 *  Each DepthLevel is one aggregated price level, never one resting order. */
export type VenueBook = {
  yesAsks: DepthLevel[]; yesBids: DepthLevel[]; noAsks: DepthLevel[]; noBids: DepthLevel[]
  /** Levels denominated in THIS outcome but resting on the other outcome's book,
   *  reachable only through the complete-set route. A NO bid at 80c is a YES ask
   *  at 20c, and nextBinaryBuy already fills against it, so a ladder that omits
   *  them contradicts the ticket and the Buy button on the same screen.
   *
   *  Empty on any venue whose four sides are already four views of one CLOB:
   *  DreamDEX derives noBids from yesAsks, so its complement is native and
   *  applying the transform again would render every level twice at one price.
   *  That is why this is published per venue rather than derived in the panel. */
  crossYesAsks: DepthLevel[]; crossNoAsks: DepthLevel[]
}

/** Best executable prices for one outcome, in the venue's collateral atoms.
 *  `mid` is present only when both sides exist: a lone bid is not a market. */
export type VenueQuote = { bid?: bigint; ask?: bigint; mid?: bigint; crossed?: boolean }

/** Everything a market view needs, with no venue-specific field left in it.
 *  A component receiving this cannot tell which chain it is rendering. */
export type VenueMarketView = {
  family: VenueFamily | null
  /** False when no on-chain market exists yet for this question. */
  opened: boolean
  book: VenueBook | null
  decimals: number
  /** Most recent executed trade, per outcome, in that outcome's own terms.
   *  Per-side rather than scalar because one LiveOrderBook is mounted per
   *  outcome; a single `last` printed the other book's price in half of them.
   *  These are historical executions, not current complementary quotes. */
  last?: { yes?: number; no?: number }
  /** Best bid/ask/mid per outcome, in collateral atoms. */
  quote?: { yes?: VenueQuote; no?: VenueQuote }
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
