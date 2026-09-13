import { useSyncExternalStore } from 'react'

/** Venue-neutral read-model invalidation. Keyed by an opaque scope string so a
 *  DreamDEX chain id and a Solana rpc+market can share one bus without either
 *  side knowing about the other. */
const revisions = new Map<string, number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

export function bumpVenue(scope: string) {
  revisions.set(scope, (revisions.get(scope) ?? 0) + 1)
  listeners.forEach(listener => listener())
}
export function useVenueRevision(scope: string) {
  return useSyncExternalStore(subscribe, () => revisions.get(scope) ?? 0, () => 0)
}
