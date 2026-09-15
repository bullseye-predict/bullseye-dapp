import { useMemo } from 'react'
import type { ArenaMarket } from '../../solz/model'
import type { SolanaBinding, VenueHolderRow } from './types'
import { useSolanaTopHolders } from './useSolanaTopHolders'
import { venueBinding } from './useVenueMarket'

export type VenueHoldersView = {
  /** null until a venue has actually answered. An empty array is a real answer:
   *  nobody holds this question yet. */
  rows: VenueHolderRow[] | null
  /** A source could not be read, so the list is a floor rather than the board. */
  partial: boolean
  /** True when this market's venue can enumerate holders at all. DreamDEX
   *  settles through a pool and exposes no per-wallet position to read, so its
   *  panel says so instead of showing an empty leaderboard. */
  supported: boolean
  error: string
  loading: boolean
}

const EMPTY: VenueHoldersView = { rows: null, partial: false, supported: false, error: '', loading: false }

/**
 * One holders hook, every venue — the third of the useVenueMarket family.
 *
 * Both implementations run unconditionally because hook order must be stable,
 * and each is gated by its own `enabled` flag. The component that calls this
 * renders wallets and share counts and cannot tell which chain produced them.
 */
export function useVenueHolders(market: ArenaMarket, owner: string | undefined, enabled = true): VenueHoldersView {
  const binding = venueBinding(market)
  const isSolana = binding?.family === 'SOLANA'
  const solana = useSolanaTopHolders(isSolana && enabled ? (binding as SolanaBinding) : null, isSolana && enabled)
  const decimals = isSolana ? (binding as SolanaBinding).collateralDecimals : 6
  // The venue reports outcome 0 and 1; the market names them. Mapping here is
  // what keeps the venue index out of the renderer.
  const outcomeIds = market.outcomes.map(outcome => outcome.id)

  return useMemo(() => {
    if (!isSolana) return EMPTY
    return {
      supported: true,
      partial: solana.partial,
      error: solana.error,
      loading: solana.loading,
      rows: solana.holders?.flatMap(holder => {
        const outcomeId = outcomeIds[holder.outcome]
        if (!outcomeId) return []
        return [{
          owner: holder.owner,
          outcomeId,
          shares: Number(holder.totalShares) / 10 ** decimals,
          self: owner !== undefined && holder.owner === owner,
        }]
      }) ?? null,
    }
    // outcomeIds is rebuilt every render; join it so the memo tracks its value.
  }, [isSolana, solana, owner, decimals, outcomeIds.join('|')])
}
