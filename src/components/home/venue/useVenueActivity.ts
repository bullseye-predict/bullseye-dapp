import type { ArenaMarket } from '../../solz/model'
import { useDreamDexActivity } from '../useDreamDexActivity'
import type { SolanaBinding } from './types'
import { useSolanaActivity, type VenueActivityView } from './useSolanaActivity'
import { venueBinding } from './useVenueMarket'

/**
 * One activity hook, every venue — the twin of useVenueMarket.
 *
 * Both implementations run unconditionally because hook order must be stable,
 * and each is gated by its own `enabled` flag. The component that calls this
 * renders the rows and cannot tell which chain produced them.
 */
export function useVenueActivity(market: ArenaMarket, enabled = true): VenueActivityView {
  const binding = venueBinding(market)
  const isSolana = binding?.family === 'SOLANA'
  // The DreamDEX hook reads market.onchain directly, so hide a foreign binding
  // from it rather than letting it dereference indexerUrl on a Solana record.
  const dreamDex = useDreamDexActivity(isSolana ? ({ ...market, onchain: undefined } as ArenaMarket) : market, enabled && !isSolana)
  const solana = useSolanaActivity(isSolana && enabled ? (binding as SolanaBinding) : null, isSolana && enabled)
  if (isSolana) return solana
  return binding ? dreamDex : { rows: [], error: '', loading: false }
}
