import { create } from 'zustand'

/** Venue-neutral read-model invalidation. Keyed by an opaque scope string so a
 *  DreamDEX chain id and a Solana rpc+market can share one bus without either
 *  side knowing about the other; each venue namespaces its own scopes, so the
 *  two key spaces cannot collide.
 *
 *  This was written twice — once here and once as dreamDexRefresh.ts, the same
 *  fourteen lines modulo naming. One store now, so a confirmed transaction on
 *  either venue invalidates through the same path. */
type Revisions = { revisions: Record<string, number>; bump: (scope: string) => void }

const useRevisions = create<Revisions>(set => ({
  revisions: {},
  bump: scope => set(state => ({ revisions: { ...state.revisions, [scope]: (state.revisions[scope] ?? 0) + 1 } })),
}))

export function bumpVenue(scope: string) { useRevisions.getState().bump(scope) }
export function useVenueRevision(scope: string) { return useRevisions(state => state.revisions[scope] ?? 0) }

/** DreamDEX invalidates by chain id, and reads better saying so at the call
 *  site than assembling a scope string there. */
const dreamDexScope = (chainId: string) => `dreamdex:${chainId}`
/** Invalidate read models only after a confirmed chain transaction. */
export function refreshDreamDex(chainId: string) { bumpVenue(dreamDexScope(chainId)) }
export function useDreamDexRevision(chainId: string) { return useVenueRevision(dreamDexScope(chainId)) }
