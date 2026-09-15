import { useEffect, useSyncExternalStore } from 'react'
import { create } from 'zustand'
import { isWalletAddress, type TraderProfile } from './profile'

/**
 * One wallet directory for the whole app.
 *
 * Every surface that shows a wallet — the holders board, the tape, positions,
 * the portfolio header, the wallet chip — asks this store, and this store is the
 * only thing that talks to the directory endpoint. Two properties follow from
 * that and are the reason it exists:
 *
 *  - One request per frame, not one per row. Forty holders mounting forty
 *    `useTraderProfile` calls in the same commit produce a single POST, because
 *    the queue is flushed on a timer rather than per call.
 *  - One answer per wallet per session. A wallet that appears in the holders
 *    list and again three rows down the tape is resolved once and rendered from
 *    the same entry, so the two can never disagree.
 *
 * It is a module singleton on purpose: Astro gives each page its own island, and
 * a cache built per component tree would be rebuilt on every tab switch.
 */

export type IdentityStatus = 'loading' | 'ready' | 'unavailable'
export type IdentityEntry = {
  status: IdentityStatus
  /** null once read: this wallet answered, and it has no public handle. */
  profile: TraderProfile | null
  at: number
}

type IdentityState = { entries: Record<string, IdentityEntry> }

const useIdentityStore = create<IdentityState>(() => ({ entries: {} }))

/** Re-read a resolved handle occasionally; back off briefly after a failure so a
 *  directory outage does not turn into a request per render. */
const READY_TTL_MS = 15 * 60_000
const UNAVAILABLE_TTL_MS = 60_000
/** One frame is enough to collect a whole list's worth of rows; the queue is
 *  flushed on a timer rather than a microtask so that a tab switch which mounts
 *  its rows across two commits still produces one request. */
const BATCH_DELAY_MS = 24
const MAX_BATCH = 50

const ENDPOINT = '/api/identity/profiles'

const stale = (entry: IdentityEntry, now: number) =>
  entry.status === 'ready' ? now - entry.at > READY_TTL_MS
  : entry.status === 'unavailable' ? now - entry.at > UNAVAILABLE_TTL_MS
  : false

let queue = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null

function patch(changes: Record<string, IdentityEntry>) {
  if (!Object.keys(changes).length) return
  useIdentityStore.setState(state => ({ entries: { ...state.entries, ...changes } }))
}

async function flush() {
  timer = null
  const addresses = [...queue]
  queue = new Set()
  for (let index = 0; index < addresses.length; index += MAX_BATCH) {
    const chunk = addresses.slice(index, index + MAX_BATCH)
    const now = Date.now()
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addresses: chunk }),
      })
      if (!response.ok) throw new Error(`identity_${response.status}`)
      const body = await response.json() as { profiles?: Record<string, TraderProfile | null>; unavailable?: string[] }
      const missed = new Set(body.unavailable ?? [])
      patch(Object.fromEntries(chunk.map(address => [address, missed.has(address)
        ? { status: 'unavailable' as const, profile: body.profiles?.[address] ?? null, at: now }
        : { status: 'ready' as const, profile: body.profiles?.[address] ?? null, at: now }])))
    } catch {
      // Never throws outward: an unnamed wallet renders as its address, which is
      // exactly what every one of these surfaces did before this store existed.
      patch(Object.fromEntries(chunk.map(address => [address, { status: 'unavailable' as const, profile: null, at: now }])))
    }
  }
}

/** Queue wallets for resolution. Safe to call with anything: non-addresses,
 *  duplicates and already-resolved wallets are dropped here rather than by each
 *  caller. */
export function requestTraderProfiles(addresses: Iterable<string | undefined | null>) {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const { entries } = useIdentityStore.getState()
  const queued: Record<string, IdentityEntry> = {}
  for (const address of addresses) {
    if (!isWalletAddress(address) || queue.has(address)) continue
    const entry = entries[address]
    if (entry && !stale(entry, now)) continue
    queue.add(address)
    queued[address] = { status: 'loading', profile: entry?.profile ?? null, at: now }
  }
  patch(queued)
  if (queue.size && !timer) timer = setTimeout(() => void flush(), BATCH_DELAY_MS)
}

const NOT_ASKED: IdentityEntry = { status: 'loading', profile: null, at: 0 }

/** One wallet's identity, resolving it if this is the first time it is seen.
 *
 *  Subscribed by hand rather than through the store hook, because that one
 *  answers a server render with the store's *initial* state. Rendered to static
 *  markup — which is what the test suite and any non-island surface do — that
 *  reports every wallet as unknown however much the store already holds. Both
 *  snapshots read the live entry, and entries are replaced only when they
 *  change, which is what useSyncExternalStore requires. */
export function useTraderProfile(address?: string | null): IdentityEntry {
  const read = () => (address ? useIdentityStore.getState().entries[address] : undefined)
  const entry = useSyncExternalStore(useIdentityStore.subscribe, read, read)
  useEffect(() => { requestTraderProfiles([address]) }, [address])
  return entry ?? NOT_ASKED
}

/** Non-reactive read, for tests and for anything outside a component. */
export const traderProfileEntry = (address: string): IdentityEntry | undefined =>
  useIdentityStore.getState().entries[address]

/** Test seam. The store is a module singleton by design, so a test that seeds it
 *  must be able to empty it again. */
export function resetTraderProfiles(seed: Record<string, IdentityEntry> = {}) {
  queue = new Set()
  if (timer) { clearTimeout(timer); timer = null }
  useIdentityStore.setState({ entries: seed }, true)
}
