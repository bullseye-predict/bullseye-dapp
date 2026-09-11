import { useSyncExternalStore } from 'react'

const revisions = new Map<string, number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** Invalidate read models only after a confirmed chain transaction. */
export function refreshDreamDex(chainId: string) {
  revisions.set(chainId, (revisions.get(chainId) ?? 0) + 1)
  listeners.forEach(listener => listener())
}
export function useDreamDexRevision(chainId: string) {
  return useSyncExternalStore(subscribe, () => revisions.get(chainId) ?? 0, () => 0)
}
