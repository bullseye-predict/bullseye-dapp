import type { VenueId } from './types'
import { marketKey } from './validation'

/** One match may have several independent markets. Never key financial state by match alone. */
export interface EventMarketScope {
  matchId: string
  venue: VenueId
  chainId: string
  marketId: string
}

export interface EventMarketVolume extends EventMarketScope {
  collateralToken: string
  collateralSymbol: string
  collateralDecimals: number
  /** Trailing 24h quote volume, NOT complete-set backing or all-time volume. */
  volume24h: bigint
  trades24h: number
  readAt: number
}

export function eventMarketKey(scope: EventMarketScope): string {
  return marketKey(scope.venue, scope.chainId, scope.marketId)
}
