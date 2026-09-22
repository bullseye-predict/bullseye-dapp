import { useEffect, useState } from 'react'
import { catwalkReadKey, catwalkSource, standingsByMint, type CatwalkBoard, type CatwalkLadderRead, type GrandPrixStanding } from '../solz/catwalkSource'
import { cachedValue, useCacheSeed } from '../solz/liveCache'
import type { LadderState, StandingsState } from './catwalkBands'
import type { CatwalkSpot } from '../solz/model'

/**
 * One poll for the whole board.
 *
 * Board, standings and the spot ladder are three reads of one screen, so they
 * share a single interval and a single AbortController: separate timers would
 * let the halves of a row disagree, and a per-slot poll would turn a 36-row
 * board into 36 requests.
 *
 * The board payload carries the authoritative next full-cycle lock boundary.
 * Reading MIAW PRIX as a fourth request cannot recover that fact because its
 * public programme intentionally contains assigned cards only.
 *
 * The reads are settled independently rather than joined, because they fail for
 * unrelated reasons. A closed ladder between seasons must not blank the board,
 * and a standings outage must not take the coins off the board - each simply
 * degrades to the honest fallback the page already renders.
 *
 * A ladder read that FAILS is not a ladder that is closed. The proxy answers 502
 * on an upstream error and 503 on a timeout, so folding a rejection into "not
 * available" made a momentary blip announce that the sale was shut while every
 * slot was on sale. The three states stay three.
 */

export type CatwalkFeed = {
  configuredSeats?: number
  closedReason?: string
  board: CatwalkBoard | null
  spots: CatwalkSpot[]
  /** How many seats the ladder publishes - the outbid lane's quota. It bounds
   *  the ladder as its own list, which is what keeps board positions out of it. */
  outbidSpots: number
  /** Open, closed, or unreadable. Only 'open' permits an ask on the page. */
  ladder: LadderState
  standings: Map<string, GrandPrixStanding>
  standingRows: GrandPrixStanding[]
  /** Whether the season record was actually read. A rejection used to be kept
   *  as the previous feed's Map, which on the first poll is empty — so the
   *  board stated "no record this season" about every coin over a 502. The
   *  ladder has kept these two apart since the first pass; this read had not. */
  standingsState: StandingsState
  loading: boolean
  /**
   * THE ROWS ON SCREEN WERE CARRIED IN, and the read that replaces them has not
   * landed yet.
   *
   * `loading` means there is nothing to show; this means there is, and it came
   * from the page the reader just left rather than from this mount's own read.
   * The page draws a quiet badge from it instead of a skeleton — blanking a
   * board somebody was looking at one click ago is the thing this exists to
   * stop, and saying nothing at all would pass those rows off as fresh.
   *
   * It is FALSE during the ordinary poll. A badge that reappears every thirty
   * seconds over rows that are already current says nothing and trains the
   * reader to ignore it.
   */
  refreshing: boolean
  /** When the rows on screen were read, in epoch ms, or 0 while none have been.
   *  Non-zero before the first read of THIS mount when the board was carried in
   *  from another route. */
  readAt: number
  /** Terminal, board-level failure only. A missing price is not an error. */
  error: string
}

/**
 * The ladder read, as one of three states.
 *
 * Exported because this is the distinction the page turns on: `available: false`
 * is the sale answering that it is shut, and a rejection is nobody answering at
 * all. Rendering the second as the first announced a closed sale over a 502.
 */
export function ladderStateOf(spots: PromiseSettledResult<{ available: boolean }>): LadderState {
  if (spots.status === 'rejected') return 'unknown'
  return spots.value.available ? 'open' : 'closed'
}

const POLL_MS = 30_000

/**
 * HOW SOON A FAILED BOARD READ IS TRIED AGAIN.
 *
 * The control plane's board read is the slow one on this site: cached it lands
 * in milliseconds, cold it has measured past the proxy's 25-second ceiling and
 * comes back 504. Waiting for the next poll meant a single slow read left the
 * board empty for a full cadence - thirty seconds on /catwalk and a minute on
 * the home panel, which is most of the time a reader spends on the page.
 *
 * Doubling from four seconds, capped at the poll, so a blip recovers in one
 * breath while a control plane that is genuinely down is not hammered.
 */
const RETRY_MS = 4_000

const EMPTY: CatwalkFeed = {
  board: null, spots: [], outbidSpots: 0, ladder: 'unknown', standings: new Map(), standingRows: [],
  standingsState: 'unknown', loading: true, refreshing: false,
  readAt: 0, error: '',
}

/**
 * THE BOARD THIS REALM ALREADY READ, as a first frame.
 *
 * `/` and `/catwalk` are two islands over one `<ClientRouter />` document, so a
 * reader who opens the board from the home page used to watch thirty-six rows
 * they had just been shown redraw from a skeleton. Everything the last read
 * landed is still in memory (src/components/solz/liveCache.ts); this hands it
 * back synchronously, before the first paint.
 *
 * It is a SEED, not an answer: `refreshing` is true beside it and the read goes
 * out regardless, so nothing on screen is older than one poll without saying so.
 * A realm that has read nothing falls through to EMPTY and the skeleton it
 * always drew.
 */
function seeded(endpoint: string): CatwalkFeed {
  const board = cachedValue<CatwalkBoard>(catwalkReadKey(endpoint, 'catwalk'))
  const standings = cachedValue<{ rows: GrandPrixStanding[] }>(catwalkReadKey(endpoint, 'standings'))
  const spots = cachedValue<CatwalkLadderRead>(catwalkReadKey(endpoint, 'catwalkSpots'))
  if (!board && !standings && !spots) return EMPTY
  const open = Boolean(spots?.value.available)
  return {
    ...EMPTY,
    board: board?.value ?? null,
    standings: standings ? standingsByMint(standings.value.rows) : EMPTY.standings,
    standingRows: standings?.value.rows ?? [],
    standingsState: standings ? 'read' : 'unknown',
    spots: open ? spots!.value.spots : [],
    outbidSpots: open ? spots!.value.outbidSpots : 0,
    // A remembered ladder still states what it stated when it was read. Only a
    // read that never happened is 'unknown'.
    ladder: spots ? (spots.value.available ? 'open' : 'closed') : 'unknown',
    configuredSeats: spots?.value.configuredSeats,
    closedReason: spots?.value.closedReason,
    loading: !board,
    refreshing: Boolean(board),
    readAt: board?.at ?? standings?.at ?? spots?.at ?? 0,
  }
}

export type CatwalkBoardOptions = {
  /** How often to re-read. A summary panel beside other live panels does not
   *  need the board page's cadence. */
  pollMs?: number
}

export function useCatwalkBoard(endpoint: string, { pollMs = POLL_MS }: CatwalkBoardOptions = {}): CatwalkFeed {
  // The first render is the SERVER's render: EMPTY, and identical to the markup
  // this island hydrates against. The seed lands in the layout effect below,
  // after that commit and before paint. See `useCacheSeed`.
  const [feed, setFeed] = useState<CatwalkFeed>(EMPTY)
  // A fresh endpoint is a different board, so it starts from that board's own
  // memory rather than from the rows of the last one.
  useCacheSeed(() => { setFeed(seeded(endpoint)) }, [endpoint])

  useEffect(() => {
    const source = catwalkSource(endpoint)
    const controller = new AbortController()
    let live = true
    /** Consecutive failed BOARD reads, for the backoff below. The board is what
     *  every row on the page is drawn from; a standings or ladder rejection
     *  degrades one column and is not worth a retry of its own. */
    let misses = 0
    let retry: ReturnType<typeof setTimeout> | undefined

    const read = async () => {
      const [board, standings, spots] = await Promise.allSettled([
        source.board(controller.signal),
        source.standings(controller.signal),
        source.spots(controller.signal),
      ])
      if (!live || controller.signal.aborted) return
      setFeed((previous) => ({
        board: board.status === 'fulfilled' ? board.value : previous.board,
        standings: standings.status === 'fulfilled' ? standingsByMint(standings.value.rows) : previous.standings,
        standingRows: standings.status === 'fulfilled' ? standings.value.rows : previous.standingRows,
        // A rejection keeps the last good rows on screen but drops back to
        // 'unknown', at EVERY poll and not just the first. Carrying the previous
        // 'read' forward let a stale Map answer for coins that joined the board
        // after it was taken — stating "no record this season" about a record
        // nobody had read. buildBoard still trusts the Map for coins that ARE in
        // it, which is the last thing actually known about them.
        standingsState: standings.status === 'fulfilled' ? 'read' : 'unknown',
        spots: spots.status === 'fulfilled' && spots.value.available ? spots.value.spots : [],
        outbidSpots: spots.status === 'fulfilled' && spots.value.available ? spots.value.outbidSpots : 0,
        ladder: ladderStateOf(spots),
        configuredSeats: spots.status === 'fulfilled' ? spots.value.configuredSeats : undefined,
        closedReason: spots.status === 'fulfilled' ? spots.value.closedReason : undefined,
        loading: false,
        refreshing: false,
        readAt: board.status === 'fulfilled' ? Date.now() : previous.readAt,
        error: board.status === 'rejected' && !previous.board ? String((board.reason as Error)?.message ?? 'The CATWALK board is unavailable.') : '',
      }))
      // THE PAGE HEALS ITSELF rather than waiting out a cadence it chose for
      // steady state. A landed read resets the count, so one bad minute does
      // not leave the board on a slow retry afterwards.
      if (board.status === 'fulfilled') { misses = 0; return }
      misses += 1
      if (retry) clearTimeout(retry)
      retry = setTimeout(() => void read(), Math.min(pollMs, RETRY_MS * 2 ** (misses - 1)))
    }

    void read()
    const timer = setInterval(() => void read(), pollMs)
    return () => {
      live = false
      controller.abort()
      clearInterval(timer)
      if (retry) clearTimeout(retry)
    }
  }, [endpoint, pollMs])

  return feed
}
