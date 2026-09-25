import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
export type MarketCatalogueState = {
  items: CatalogueItem[]
  nextCursor: string | null
  asOf: number
  loaded: boolean
  available: boolean
  /**
   * The read outcome, kept apart from `items` so that a catalogue which FAILED
   * is never rendered as a catalogue that is EMPTY.
   *
   * The directory used to answer a dropped connection with "0 markets — No
   * markets available yet", which is a confident claim about the inventory made
   * from a read that never landed. Same discipline as `MiawPrixMarketsState`
   * (src/components/miawprix/miawPrixSource.ts) and the CATWALK spot ladder: a
   * read that failed is not a read that came back empty.
   *
   * `failed` with a non-empty `items` is a normal state and means the rows on
   * screen are the last read that landed.
   */
  status: 'unread' | 'failed' | 'read'
  /** The deeper inventory walk is running behind the rows already on screen. */
  extending: boolean
  /** The whole cursor chain has been read at least once this mount. */
  complete: boolean
}

/**
 * How much of the catalogue this caller needs.
 *
 * `head` is ONE request with no cursor. Paired with `status=eligible` it is a
 * complete answer rather than a first page: the backend selects the open rows by
 * kickoff and returns them without a cursor (apps/stake-api/market-catalogue.ts
 * in solz-prediction-backend). This is what the directory paints from.
 *
 * Note it is NOT "the newest page happens to hold the live markets" — measured
 * against the deployed catalogue that is false. The chain is ordered by creation
 * time, and page one held 120 cancelled and 48 resolved rows and nothing else;
 * the 47 live and 90 scheduled items were scattered across eight of fifteen
 * pages. Only a source-side selection answers this question in one request.
 *
 * `inventory` is the whole cursor chain, under `status=all`. It exists because
 * status and search filters are defined across the inventory rather than across
 * the current transport page — History is by definition the tail — so a reader
 * who asks for one of those must get the rows to answer it.
 *
 * The distinction is the point. Walking the chain eagerly cost 15 requests and
 * ~10,600 items for a grid that shows twelve cards, every ten seconds, for as
 * long as the tab stayed open; measured, one walk took 77s and never stopped
 * restarting. The rows are titles, schedules and settlement statuses. They do
 * not tick, so the tail is read ONCE, only when something on screen needs it.
 */
export type CatalogueDepth = 'head' | 'inventory'

/** The runaway guard on the cursor chain, unchanged: a backend replaying a
 *  cursor must not be able to spin this loop forever. */
const MAX_PAGES = 100

/** A page that fails is retried before the walk is abandoned. A 502 here is
 *  usually the stake-api dropping a socket under concurrent load rather than a
 *  catalogue that is down, and discarding an otherwise good walk for it made the
 *  directory flip to its fallback for a transient blip. */
const PAGE_ATTEMPTS = 3
const RETRY_BACKOFF_MS = [400, 1200]

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms)
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
})

/** Route-unavailable, which is a fact about the BACKEND rather than about the
 *  catalogue: 404 predates the endpoint, 503 is a backend built without one. */
const UNAVAILABLE = [404, 503]

/**
 * The catalogue, read head-first and extended only when asked.
 *
 * `pollMs` is how often the HEAD is re-read. The tail is not re-walked: a
 * settled match's title and result are final, so re-reading them on a timer buys
 * nothing and costs a full inventory crawl. A poll therefore merges the newest
 * page into what is held instead of rebuilding the list from empty — the old
 * behaviour published a one-page array over the complete inventory at the start
 * of every cycle, so the grid emptied itself and every downstream memo
 * (identity, then on-chain pricing over every row) re-ran from scratch.
 */
export function useMarketCatalogue(
  apiUrl: string,
  status: 'eligible' | 'all' = 'eligible',
  pollMs = 30_000,
  depth: CatalogueDepth = 'head',
  kind: 'all' | 'general' = 'all',
): MarketCatalogueState & { retry: () => void } {
  const [attempt, setAttempt] = useState(0)
  const retry = useCallback(() => setAttempt(value => value + 1), [])
  const [state, setState] = useState<MarketCatalogueState>({
    items: [], nextCursor: null, asOf: Date.now(), loaded: false, available: true,
    status: 'unread', extending: false, complete: false,
  })
  /** What was last published, so that WIDENING the read does not blank the grid.
   *  Changing `depth` or `status` re-runs the effect with a fresh accumulator;
   *  seeding it from the rows already on screen is what makes switching to
   *  History extend the directory instead of emptying it while the walk runs. */
  const published = useRef<CatalogueItem[]>([])
  published.current = state.items
  const sourceKey = useRef(`${apiUrl}:${kind}`)
  useEffect(() => {
    if (!apiUrl) { setState(previous => ({ ...previous, loaded: true, available: false, status: 'read' })); return }
    const controller = new AbortController()
    let timer: number | undefined
    const changedSource = sourceKey.current !== `${apiUrl}:${kind}`
    sourceKey.current = `${apiUrl}:${kind}`
    const seed = changedSource ? [] : published.current
    if (changedSource) setState(previous => ({ ...previous, items: [], loaded: false, extending: false, complete: false, status: 'unread' }))
    let failures = 0
    let items: CatalogueItem[] = []
    let indexes = new Map<string, number>()
    let complete = false

    const key = (item: CatalogueItem) => `${item.matchId}:${item.questionId}`
    /** Start a cycle from a known set. Keyed by (matchId, questionId) because a
     *  head-to-head event is several linked binary rows, each its own market. */
    const reset = (from: readonly CatalogueItem[]) => {
      items = [...from]
      indexes = new Map(items.map((item, index) => [key(item), index]))
    }
    reset(seed)

    const absorb = (page: CatalogueItem[]) => {
      for (const item of page) {
        const index = indexes.get(key(item))
        if (index === undefined) { indexes.set(key(item), items.length); items.push(item) }
        else items[index] = item
      }
    }

    /** One cursor page, retried through a transient upstream failure.
     *  Returns null when the BACKEND says it has no catalogue route. */
    const readPage = async (cursor: string | null) => {
      for (let attempt = 0; ; attempt += 1) {
        const url = predictionUrl('/market/list', apiUrl)
        url.searchParams.set('status', status)
        url.searchParams.set('limit', '100')
        if (kind !== 'all') url.searchParams.set('kind', kind)
        if (cursor) url.searchParams.set('cursor', cursor)
        try {
          // Inside the 15s budget the Astro proxy allows upstream
          // (src/server/upstream-proxy.ts), so a client timeout and an upstream
          // one stay distinguishable instead of racing each other.
          const response = await fetch(url, {
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
            headers: { accept: 'application/json' },
          })
          if (UNAVAILABLE.includes(response.status)) return null
          if (!response.ok) throw new Error(`Market catalogue unavailable (${response.status}).`)
          return parseMarketList(await response.json())
        } catch (reason) {
          if (controller.signal.aborted) throw reason
          if (attempt >= PAGE_ATTEMPTS - 1) throw reason
          await wait(RETRY_BACKOFF_MS[attempt] ?? RETRY_BACKOFF_MS.at(-1)!, controller.signal)
        }
      }
    }

    const publish = (extending: boolean, asOf: number, nextCursor: string | null) => {
      if (controller.signal.aborted) return
      setState({
        items: [...items], nextCursor, asOf,
        loaded: true, available: true, status: 'read', extending, complete,
      })
    }

    const load = async () => {
      try {
        const head = await readPage(null)
        // A `head` read is a COMPLETE answer for its scope: status=eligible is
        // selected at the source and comes back without a cursor, so the rows it
        // returns are all the open markets there are. Rebuilding from it - rather
        // than merging into what is held - is what lets a match that has just
        // settled leave the Live tab. An `inventory` walk is the opposite: its
        // pages are partial, so it accumulates and only ever grows.
        if (depth === 'head' && head && !head.nextCursor) reset([])
        // A route that is absent or unconfigured is not an empty catalogue.
        if (head === null) {
          if (!controller.signal.aborted) setState(previous => ({ ...previous, loaded: true, available: false, status: 'read' }))
          return
        }
        failures = 0
        absorb(head.items)
        // The grid can paint from here. Everything below only widens what the
        // filters can reach; it must never hold up the first render.
        publish(depth === 'inventory' && !complete && !!head.nextCursor, head.asOf, head.nextCursor)

        if (depth === 'inventory' && !complete) {
          let cursor = head.nextCursor
          let asOf = head.asOf
          for (let page = 1; page < MAX_PAGES && cursor; page += 1) {
            const next = await readPage(cursor)
            if (next === null) break
            absorb(next.items)
            asOf = next.asOf
            const previousCursor = cursor
            cursor = next.nextCursor
            // Opaque cursors should always advance. Guarding a buggy or replayed
            // cursor keeps one backend page from trapping the walk in a loop.
            if (cursor && cursor === previousCursor) break
            publish(!!cursor, asOf, cursor)
          }
          complete = !cursor
          publish(false, asOf, cursor)
        }
      } catch {
        failures = Math.min(failures + 1, 4)
        // Keep the last verified catalogue through a transient outage; the next
        // poll replaces it. Availability is not revoked by a timeout, only by the
        // backend explicitly saying it has no such route. `status: 'failed'` is
        // what lets the directory tell "the read did not land" apart from "the
        // catalogue is empty" — with rows held, it means the rows are the last
        // read that landed.
        if (!controller.signal.aborted) setState(previous => ({ ...previous, loaded: true, status: 'failed' }))
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), Math.min(300_000, pollMs * 2 ** failures))
      }
    }
    void load()
    return () => { controller.abort(); if (timer) window.clearTimeout(timer) }
  }, [apiUrl, status, pollMs, depth, kind, attempt])
  return useMemo(() => ({ ...state, retry }), [state, retry])
}
