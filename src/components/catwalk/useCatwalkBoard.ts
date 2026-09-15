import { useEffect, useState } from 'react'
import { catwalkSource, standingsByMint, type CatwalkBoard, type GrandPrixStanding } from '../solz/catwalkSource'
import type { LadderState, StandingsState } from './catwalkBands'
import type { CatwalkSpot } from '../solz/model'

/**
 * One poll for the whole board.
 *
 * Board, standings and the spot ladder are three reads of one screen, so they
 * share a single interval and a single AbortController: three timers would let
 * the three halves of a row disagree, and a per-slot poll would turn a 36-row
 * board into 36 requests.
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

const EMPTY: CatwalkFeed = {
  board: null, spots: [], outbidSpots: 0, ladder: 'unknown', standings: new Map(), standingRows: [],
  standingsState: 'unknown', loading: true, error: '',
}

export function useCatwalkBoard(endpoint: string): CatwalkFeed {
  const [feed, setFeed] = useState<CatwalkFeed>(EMPTY)

  useEffect(() => {
    const source = catwalkSource(endpoint)
    const controller = new AbortController()
    let live = true

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
        loading: false,
        error: board.status === 'rejected' && !previous.board ? String((board.reason as Error)?.message ?? 'The CATWALK board is unavailable.') : '',
      }))
    }

    void read()
    const timer = setInterval(() => void read(), POLL_MS)
    return () => {
      live = false
      controller.abort()
      clearInterval(timer)
    }
  }, [endpoint])

  return feed
}
