import { useEffect, useState } from 'react'
import type { CatwalkBoard } from './catwalkSource'
import { resolvedTokenLogo, tokenIconUrl } from './tokenIcon'

/**
 * WHAT A COIN IS CALLED AND WHAT IT LOOKS LIKE, read from the chain's own
 * token registry and laid over the board.
 *
 * The board names its coins by mint and carries whatever the game's registry
 * recorded beside them, which for a freshly listed coin is the ticker twice
 * over (`symbol: "SOLZ", name: "SOLZ"`) and a root-relative logo path that 404s
 * on this origin. Both are identity, both are knowable from a mainnet mint, and
 * neither is worth rendering as a broken image and a repeated word.
 *
 * THE OVERLAY IS NARROW AND IT NEVER OUTRANKS THE BOARD. The symbol is never
 * touched - on this site a coin's ticker is what the game says it is. The name
 * is only filled in where the board published none of its own, and the logo only
 * where the board published none or published one that cannot resolve here. A
 * registry that does not answer leaves the board exactly as it arrived.
 */

export type TokenMeta = { mint: string; name: string; symbol: string; icon: string }

const CACHE_KEY = 'coola:token-meta:v1'
const CACHE_MAX_AGE_MS = 24 * 60 * 60_000
const QUERY_BATCH = 50

type CachedToken = TokenMeta & { at: number }

/** Token identity changes rarely. Keep the last known symbol/icon in the
 * browser so route changes do not turn a profile into a fresh Jupiter lookup. */
function cachedTokens(mints: readonly string[]): Map<string, TokenMeta> {
  if (typeof window === 'undefined') return new Map()
  try {
    const rows = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? '') as CachedToken[]
    const wanted = new Set(mints)
    return new Map((Array.isArray(rows) ? rows : [])
      .filter(row => wanted.has(row.mint) && Number.isSafeInteger(row.at) && Date.now() - row.at <= CACHE_MAX_AGE_MS && typeof row.name === 'string' && typeof row.symbol === 'string' && typeof row.icon === 'string')
      .map(({ at: _at, ...token }) => [token.mint, token]))
  } catch { return new Map() }
}
function cacheTokens(tokens: Map<string, TokenMeta>) {
  if (typeof window === 'undefined') return
  try {
    const now = Date.now()
    // Bound the cache so an unusually large market directory never consumes
    // local storage just because it was viewed once.
    const rows = [...tokens.values()].slice(-300).map(token => ({ ...token, at: now }))
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(rows))
  } catch { /* Caching is an optimisation, never a dependency. */ }
}

export function parseTokenMeta(payload: unknown): Map<string, TokenMeta> {
  const found = new Map<string, TokenMeta>()
  const rows = (payload as any)?.tokens
  if (!Array.isArray(rows)) return found
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const mint = typeof row.mint === 'string' ? row.mint : ''
    if (!mint) continue
    found.set(mint, {
      mint,
      name: typeof row.name === 'string' ? row.name : '',
      symbol: typeof row.symbol === 'string' ? row.symbol : '',
      // Rewritten to this origin on every parse, so a cached reply carrying an
      // older rule still loads. A host this site will not fetch becomes '' and
      // the row keeps the built-in mark.
      icon: typeof row.icon === 'string' ? tokenIconUrl(row.icon) : '',
    })
  }
  return found
}

/**
 * Whether a logo the BOARD published can actually be fetched from this origin.
 *
 * A root-relative path is the failing case and the reason this module exists:
 * the game API publishes `/solz_logo.svg`, which is correct on the game's own
 * origin and resolves to a 404 on this one. An absolute http(s) URL and a data
 * URI are left alone - whoever published them meant them.
 */
export const logoResolvesHere = (logoUrl: string | undefined | null) =>
  !!logoUrl && (/^https?:\/\//i.test(logoUrl) || logoUrl.startsWith('data:'))

/** A board name that is really just the ticker again, so there is no name. The
 *  `$` is stripped because `$FOOFIX` and `FOOFIX` are the same gesture. */
const bare = (symbol: string) => symbol.replace(/^\$/, '').trim().toLowerCase()
const namesNothing = (name: string, symbol: string) =>
  !name.trim() || bare(name) === bare(symbol)

/**
 * The board, with identity filled in where it was missing. Pure, so what the
 * overlay is allowed to change is testable without a network.
 *
 * Returns the SAME board object when nothing changed, so a poll that learns
 * nothing new does not re-render every row.
 */
export function overlayTokenMeta(board: CatwalkBoard | null, meta: Map<string, TokenMeta>): CatwalkBoard | null {
  if (!board || !meta.size) return board
  let changed = false
  const lineup = board.lineup.map((entry) => {
    const found = meta.get(entry.mint)
    const team = entry.team
    if (!found || !team) return entry
    const name = namesNothing(team.name, team.symbol) && found.name ? found.name : team.name
    const logoUrl = resolvedTokenLogo(team.logoUrl, found.icon)
    if (name === team.name && logoUrl === team.logoUrl) return entry
    changed = true
    return { ...entry, team: { ...team, name, logoUrl } }
  })
  return changed ? { ...board, lineup } : board
}

/**
 * One batched read for every mint on the board.
 *
 * Keyed on the sorted mint list, so it re-reads when the board's membership
 * changes and not on every 30-second poll that returns the same coins. Identity
 * does not move the way a price does.
 */
export function useTokenMeta(mints: readonly string[], endpoint = '/api/token-meta'): Map<string, TokenMeta> {
  const unique = [...new Set(mints)].sort()
  const key = unique.join(',')
  const [meta, setMeta] = useState<Map<string, TokenMeta>>(() => new Map())

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    let live = true
    void (async () => {
      const cached = cachedTokens(unique)
      if (cached.size && live) setMeta(previous => new Map([...previous, ...cached]))
      const missing = unique.filter(mint => !cached.has(mint))
      if (!missing.length) return
      try {
        const resolved = new Map(cached)
        // The proxy deliberately caps one request at 50 mints. Read larger
        // portfolios in small sequential batches instead of silently dropping
        // later teams (or sending a burst of registry requests).
        for (let offset = 0; offset < missing.length; offset += QUERY_BATCH) {
          const response = await fetch(`${endpoint}?mints=${encodeURIComponent(missing.slice(offset, offset + QUERY_BATCH).join(','))}`, {
            signal: controller.signal,
            headers: { accept: 'application/json' },
          })
          if (!response.ok) continue
          for (const [mint, token] of parseTokenMeta(await response.json())) resolved.set(mint, token)
        }
        if (live && !controller.signal.aborted && resolved.size) {
          cacheTokens(resolved)
          setMeta(previous => new Map([...previous, ...resolved]))
        }
      } catch { /* identity the registry would not answer is not an error the board reports */ }
    })()
    return () => { live = false; controller.abort() }
  }, [key, endpoint])

  return meta
}
