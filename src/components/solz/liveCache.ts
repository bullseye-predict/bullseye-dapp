/**
 * THE LAST GOOD ANSWER, KEPT ACROSS A NAVIGATION.
 *
 * `/Users/Shared/march-2026/solz-prediction-market` is an Astro site with
 * `<ClientRouter />` in `src/layouts/SiteLayout.astro`, so moving from `/` to
 * `/catwalk` or `/miaw-prix` swaps the document WITHOUT reloading the page.
 * The JavaScript realm survives; only the islands are torn down and rebuilt.
 * Every island then started from nothing and drew a skeleton over data it had
 * read seconds earlier on the page the reader just left.
 *
 * This module is that realm's memory. A read that lands is remembered under its
 * request URL, and the next island to ask for the same URL paints the remembered
 * answer on its FIRST frame, then re-reads and replaces it in place.
 *
 * THE CACHE NEVER SUPPRESSES A READ. It seeds a first frame and nothing else:
 * callers always go to the network, and a caller that shows a remembered answer
 * must also say it is re-reading (`age`, below, is what that badge is built
 * from). Serving a remembered board INSTEAD of reading would publish a schedule,
 * a standings table and a set of asks that are minutes old with nothing on
 * screen admitting it.
 *
 * MEMORY ONLY, deliberately - no `sessionStorage`. The MIAW PRIX board is two
 * hundred cards and is re-read every sixty seconds; serialising it into storage
 * on every poll costs more than the one skeleton a hard reload draws. A full
 * reload is a new realm and starts empty, which is correct: nothing was carried
 * over because nothing was.
 */

import { useEffect, useLayoutEffect } from 'react'

export type CachedRead<T> = {
  value: T
  /** When this answer landed, in epoch ms. */
  at: number
}

const entries = new Map<string, CachedRead<unknown>>()

/** The remembered answer for this request, or null when nobody has read it in
 *  this realm yet. Callers seed from it and MUST still read. */
export function cachedValue<T>(key: string): CachedRead<T> | null {
  return (entries.get(key) as CachedRead<T> | undefined) ?? null
}

/**
 * WHERE A SEED IS APPLIED: after hydration, before the browser paints.
 *
 * NEVER IN THE FIRST RENDER. `/catwalk` and `/miaw-prix` are `client:load`
 * islands, so the server renders their markup and React hydrates against it.
 * Seeding inside `useState` put remembered rows into the client's first render
 * while the server - where this map is always empty - had rendered a skeleton,
 * and React responded by discarding the server's markup and rebuilding the
 * whole island. That is the exact opposite of what the seed exists to do, and
 * it took the visible page down with it.
 *
 * A layout effect runs after the first commit and before paint, so the first
 * render matches the server exactly, nothing flashes, and the rows are there by
 * the time anybody sees the frame. On the server it falls back to `useEffect`,
 * which never runs, purely to avoid React's "useLayoutEffect does nothing on
 * the server" warning.
 */
export const useCacheSeed = typeof document === 'undefined' ? useEffect : useLayoutEffect

/**
 * Remember an answer that landed. Only ever called with a PARSED value, so the
 * next island takes the same shape the network one would have handed it.
 *
 * NEVER FROM A SERVER RENDER. This map is a module global: in Node it is shared
 * by every request in flight at once, so a write during SSR would put one
 * visitor's board in another visitor's HTML. It holds today because every
 * caller writes from inside an effect, and effects do not run on the server -
 * keep it that way. A read that needs to happen during SSR must return its
 * value through props, not through here.
 */
export function rememberValue<T>(key: string, value: T): CachedRead<T> {
  const entry: CachedRead<T> = { value, at: Date.now() }
  entries.set(key, entry)
  return entry
}

/** Forget everything. For tests, which must not read one another's answers. */
export function forgetCachedValues(): void {
  entries.clear()
}

/** How old a seeded frame is, in words, for the badge beside it. Empty when the
 *  answer is fresh enough that saying anything would be noise. */
export function cachedAge(at: number, now = Date.now()): string {
  const seconds = Math.floor(Math.max(0, now - at) / 1_000)
  if (seconds < 20) return ''
  if (seconds < 90) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}
