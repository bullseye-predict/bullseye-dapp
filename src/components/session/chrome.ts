import { create } from 'zustand'
import type { ComponentProps } from 'react'
import type { SiteHeader } from '../solz/SiteHeader'
import { brand, type Brand } from '../solz/brand'

export type HeaderActive = ComponentProps<typeof SiteHeader>['active']

/** What the page tells the site chrome about itself.
 *
 *  The header lives in one persisted island in SiteLayout, above every page
 *  island, so it can no longer be handed props by the page that is on screen.
 *  The page publishes here instead and the chrome reads it.
 *
 *  Only value-typed fields are reactive. The callbacks live in a mutable box
 *  because HomeApp builds a fresh arrow on every render: putting those in the
 *  store would notify on every render for a closure that never behaves
 *  differently, and comparing them by identity would churn the header. */
export type ChromeState = {
  /** Absent until the page's AppShell effect runs. The two islands mount
   *  independently, so the header would otherwise paint one frame lit by a
   *  default before the page could correct it; SiteChrome falls back to the
   *  URL, which is right for every page that is not the stateful home view. */
  active?: HeaderActive
  marketsHref?: string
  /** Fragment link to this page's <main>, for the skip link. */
  skipTo?: string
  skipLabel?: string
}

const DEFAULT: ChromeState = {}

const useChromeStore = create<ChromeState>(() => DEFAULT)

const handlers: { onArena?: () => void; onMarkets?: () => void } = {}

/** Read at click time rather than captured at render time, so the header always
 *  calls the handler belonging to the page currently on screen. */
export const chromeHandlers = () => handlers

export function setChrome(next: ChromeState, onArena?: () => void, onMarkets?: () => void) {
  handlers.onArena = onArena
  handlers.onMarkets = onMarkets
  const current = useChromeStore.getState()
  if (
    current.active === next.active &&
    current.marketsHref === next.marketsHref &&
    current.skipTo === next.skipTo &&
    current.skipLabel === next.skipLabel
  ) return
  useChromeStore.setState(next, true)
}

export const useChrome = () => useChromeStore()
/** Non-reactive read, for tests and for anything outside a component. */
export const chromeState = () => useChromeStore.getState()

/** The nav link a path lights, used until the page publishes its own. */
export function activeForPath(pathname: string, of: Brand = brand): HeaderActive {
  if (pathname === '/') return of.home === 'markets' ? 'markets' : 'highlight'
  if (pathname.startsWith('/markets') || pathname.startsWith('/live')) return 'markets'
  if (pathname.startsWith('/agent-arena')) return 'agents'
  if (pathname.startsWith('/catwalk')) return 'catwalk'
  if (pathname.startsWith('/miaw-prix')) return 'miawprix'
  if (pathname.startsWith('/colacat') || pathname.startsWith('/bet-or-market')) return 'colacat'
  if (pathname.startsWith('/profile') || /^\/(solana|somnia)\//.test(pathname)) return 'profile'
  return 'highlight'
}
