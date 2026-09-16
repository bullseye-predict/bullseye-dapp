import { useEffect, useState } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import { parseMarketList, type CatalogueItem } from './marketList'

/** Reads GET /market/list, the unified catalogue (docs/MARKET_LIST_API.md).
 *
 *  `available` is deliberately distinct from `loaded` and from an empty list. A
 *  backend that predates this endpoint answers 404, and one built without a
 *  catalogue answers 503 CATALOGUE_UNAVAILABLE; neither means "no markets". The
 *  caller falls back to the older per-source composition in that case, so the
 *  directory keeps working across a rolling deploy. Once every backend serves
 *  /market/list this flag and the fallback can both go.
 */
export type MarketCatalogueState = { items: CatalogueItem[]; nextCursor: string | null; asOf: number; loaded: boolean; available: boolean }

export function useMarketCatalogue(apiUrl: string, status: 'eligible' | 'all' = 'eligible'): MarketCatalogueState {
  const [state, setState] = useState<MarketCatalogueState>({ items: [], nextCursor: null, asOf: Date.now(), loaded: false, available: true })
  useEffect(() => {
    setState({ items: [], nextCursor: null, asOf: Date.now(), loaded: false, available: true })
    if (!apiUrl) { setState(previous => ({ ...previous, loaded: true, available: false })); return }
    const controller = new AbortController()
    let timer: number | undefined
    const load = async () => {
      try {
        // Generous, matching the question catalogue: a cold cross-region Neon read
        // can take seconds, and a timeout that straddles the backend would make the
        // directory flicker between the catalogue and its fallback.
        const items: CatalogueItem[] = []
        const itemIndexes = new Map<string, number>()
        let cursor: string | null = null
        let asOf = Date.now()
        // Match identity is the inventory boundary, not the first 100 rows.
        // Walk the opaque cursor so older settled and one-player matches remain
        // searchable instead of silently disappearing behind the first page.
        for (let page = 0; page < 100; page += 1) {
          const url = predictionUrl('/market/list', apiUrl)
          url.searchParams.set('status', status)
          url.searchParams.set('limit', '100')
          if (cursor) url.searchParams.set('cursor', cursor)
          const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]), headers: { accept: 'application/json' } })
          const value = await response.json().catch(() => null)
          // A route that is absent or unconfigured is not an empty catalogue.
          if (response.status === 404 || response.status === 503) {
            if (!controller.signal.aborted) setState(previous => ({ ...previous, loaded: true, available: false }))
            return
          }
          if (!response.ok) throw new Error('Market catalogue unavailable.')
          const parsed = parseMarketList(value)
          for (const item of parsed.items) {
            const key = `${item.matchId}:${item.questionId}`
            const index = itemIndexes.get(key)
            if (index === undefined) {
              itemIndexes.set(key, items.length)
              items.push(item)
            } else {
              items[index] = item
            }
          }
          asOf = parsed.asOf
          const previousCursor = cursor
          cursor = parsed.nextCursor
          // A catalogue page is already useful inventory. Publish it now instead
          // of hiding every current market until the complete historical cursor
          // walk finishes; a large ranked/stake history can take several seconds.
          if (!controller.signal.aborted) setState({ items: [...items], nextCursor: cursor, asOf, loaded: true, available: true })
          // Opaque cursors should always advance. Guarding a buggy/replayed cursor
          // keeps one backend page from trapping the directory in a fetch loop.
          if (cursor && cursor === previousCursor) break
          if (!cursor) break
        }
        if (!controller.signal.aborted) setState({ items, nextCursor: cursor, asOf, loaded: true, available: true })
      } catch {
        // Keep the last verified catalogue through a transient outage; the next
        // poll replaces it. Availability is not revoked by a timeout, only by the
        // backend explicitly saying it has no such route.
        if (!controller.signal.aborted) setState(previous => ({ ...previous, loaded: true }))
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), 10_000)
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, status])
  return state
}
