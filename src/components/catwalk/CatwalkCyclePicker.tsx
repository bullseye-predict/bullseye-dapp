import { History } from 'lucide-react'
import type { CatwalkCycleHeader } from '../solz/catwalkSource'
import type { CycleIndexState } from './useCatwalkCycles'

/**
 * WHICH WALK THE BOARD IS SHOWING.
 *
 * The board used to be one thing only: whatever is standing there now. Every
 * previous walk had in fact been recorded at its lock, and none of it was
 * readable, so the page could not answer the most ordinary question anybody
 * asks of a leaderboard - what did it look like last time.
 *
 * LIVE IS THE DEFAULT AND IT IS FIRST. A viewer who has not chosen anything is
 * looking at the board as it stands, and the control has to say so rather than
 * leaving them wondering which walk they are reading.
 *
 * IT RENDERS NOTHING AT ALL WHEN THE INDEX HAS NOT BEEN READ. An empty picker
 * and a picker that has not loaded look identical and mean opposite things, and
 * a board whose history genuinely is empty - a season that has not locked once -
 * is not owed a dropdown with one option in it.
 */
export function CatwalkCyclePicker({ cycles, state, selected, onSelect, busy = false }: {
  cycles: readonly CatwalkCycleHeader[]
  state: CycleIndexState
  selected: number | null
  onSelect: (cycleIndex: number | null) => void
  busy?: boolean
}) {
  // Nothing recorded yet, and nothing read yet, both render no control. The
  // difference matters to the page, not to a viewer with no walks to pick from:
  // either way there is nothing here to choose.
  if (state !== 'read' || !cycles.length) return null
  return (
    <label className="cw-cycles" data-busy={busy ? 'true' : undefined}>
      <History size={13} aria-hidden="true" />
      <span className="sr-only">Which walk to show</span>
      <select
        value={selected === null ? 'live' : String(selected)}
        onChange={(event) => {
          const next = event.target.value
          onSelect(next === 'live' ? null : Number(next))
        }}
      >
        <option value="live">LIVE BOARD</option>
        {cycles.map((cycle) => (
          <option key={`${cycle.seasonId}:${cycle.cycleIndex}`} value={String(cycle.cycleIndex)}>
            {cycleLabel(cycle)}
          </option>
        ))}
      </select>
    </label>
  )
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/**
 * A walk's own name, and the day it ran.
 *
 * CATWALK #1 IS CYCLE INDEX 0. The column counts from zero because it is an
 * index; a human counting walks starts at one, and the owner asked for this list
 * in exactly those words - "CATWALK#1, #2, ETC". The offset lives here, in the
 * label, and never in the value sent back to the server.
 *
 * READ IN UTC, like every other date on this page: the rail renders on the
 * server and again in the browser, and a local-time format would print two
 * different days either side of midnight and fail hydration over a fact that is
 * the same instant in both places.
 */
export function cycleLabel(cycle: CatwalkCycleHeader): string {
  const day = cycleDate(cycle.startsAt || cycle.lockedAt)
  return `CATWALK #${cycle.cycleIndex + 1}${day ? ` — ${day}` : ''}`
}

export function cycleDate(at: number): string | null {
  if (!Number.isFinite(at) || at <= 0) return null
  const when = new Date(at)
  if (Number.isNaN(when.getTime())) return null
  return `${String(when.getUTCDate()).padStart(2, '0')} ${MONTHS[when.getUTCMonth()]}`
}

/**
 * WHAT A VIEWER IS LOOKING AT WHEN IT IS NOT THE LIVE BOARD.
 *
 * Loud on purpose, and above the rows rather than beside them. A recorded board
 * is pixel-for-pixel a live one - same numbers, same lanes, same chips - so
 * without this banner a viewer three screens down has no way to tell that the
 * coin at slot 01 was there three weeks ago and is not there now.
 *
 * IT CARRIES NO PRICE AND OFFERS NO SEAT, because the snapshot recorded neither
 * and the sale is not open on a board that has already walked.
 */
export function CatwalkCycleBanner({ cycle, onLive }: {
  cycle: CatwalkCycleHeader & { activeSlots?: number }
  onLive: () => void
}) {
  const day = cycleDate(cycle.startsAt || cycle.lockedAt)
  return (
    <div className="cw-cycle-banner" role="status">
      <strong>{cycleLabel(cycle)}</strong>
      <p>
        The board as it stood when this walk locked{day ? ` on ${day}` : ''} —
        {' '}{cycle.lineupSize} {cycle.lineupSize === 1 ? 'position' : 'positions'},
        {' '}{cycle.matchCount} {cycle.matchCount === 1 ? 'match' : 'matches'}.
        {' '}Nothing here is for sale: this walk is over.
      </p>
      <button type="button" className="cw-act" onClick={onLive}>BACK TO THE LIVE BOARD</button>
    </div>
  )
}
