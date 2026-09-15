import { useMemo } from 'react'
import type { ArenaMarket } from '../../solz/model'
import { useDreamDexSnapshot } from '../useDreamDexSnapshot'
import { refreshDreamDex } from './revision'
import { useSolanaMarket } from './useSolanaMarket'
import { EMPTY_VIEW, type DreamDexBinding, type SolanaBinding, type VenueBinding, type VenueMarketView } from './types'

/** Legacy markets carry no family because DreamDEX was the only venue. */
export function venueBinding(market: ArenaMarket): VenueBinding | null {
  const binding = market.onchain as (Record<string, unknown> & { family?: VenueBinding['family'] }) | undefined
  if (!binding) return null
  return (binding.family ? binding : { ...binding, family: 'DREAMDEX' }) as VenueBinding
}

/**
 * One hook, every venue. Components call this and render the result; they never
 * import a chain adapter, never read a chain-specific field, and do not change
 * when a venue is added. Both implementations run unconditionally because hook
 * order must be stable, and each is gated by its own `enabled` flag.
 */
export function useVenueMarket(market: ArenaMarket, owner?: string, enabled = true): VenueMarketView {
  const binding = venueBinding(market)
  const isDreamDex = binding?.family === 'DREAMDEX'
  const isSolana = binding?.family === 'SOLANA'

  // The DreamDEX hook reads market.onchain directly, so hide a foreign binding
  // from it rather than letting it dereference indexerUrl on a Solana record.
  const dreamDexMarket = useMemo(
    () => (isDreamDex ? market : ({ ...market, onchain: undefined } as ArenaMarket)),
    [market, isDreamDex],
  )
  const dreamDex = useDreamDexSnapshot(dreamDexMarket, owner)
  // Gated: PredictionDetail mounts one of these per market, so polling every
  // market's books at once multiplied a single refresh into ~96 RPC calls and
  // tripped the provider rate limit. Only the panel on screen polls.
  const solana = useSolanaMarket(isSolana && enabled ? (binding as SolanaBinding) : null, isSolana && enabled, owner)

  return useMemo(() => {
    if (isSolana) return solana
    if (!isDreamDex || !binding) return EMPTY_VIEW
    const data = dreamDex.data
    return {
      family: 'DREAMDEX',
      opened: true,
      book: data?.book
        // No complement ladders: DreamDEX's four sides are four views of one
        // CLOB, with noBids already derived from yesAsks, so its cross-book
        // depth is native depth and adding it again would double every level.
        ? { yesAsks: data.book.yesAsks, yesBids: data.book.yesBids, noAsks: data.book.noAsks, noBids: data.book.noBids, crossYesAsks: [], crossNoAsks: [] }
        : null,
      decimals: data?.market.decimals ?? 6,
      finalized: Boolean(data?.market.finalized),
      now: data?.now ?? 0,
      error: dreamDex.error,
      refreshing: dreamDex.refreshing,
      refresh: () => refreshDreamDex((binding as DreamDexBinding).chainId),
    }
  }, [isSolana, isDreamDex, binding, dreamDex, solana])
}

/** Narrows to the DreamDEX variant. The EVM write path legitimately needs
 *  chain-specific fields; this is the one sanctioned way to reach them, so the
 *  assumption is explicit instead of an unchecked property read. */
export function dreamDexBinding(market: ArenaMarket): DreamDexBinding | null {
  const binding = venueBinding(market)
  return binding?.family === 'DREAMDEX' ? binding : null
}
