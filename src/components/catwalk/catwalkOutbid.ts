import type { CatwalkLadderSeat, CatwalkBoardShape, CatwalkRow, LadderState } from './catwalkBands'
import { seatHeld } from './catwalkBands'

/**
 * THE OUTBID LIST: the coins, one row each.
 *
 * The OUTBID tab used to render the spot ladder and nothing else, so with the
 * sale shut it published three anonymous strips reading "Configured seat -
 * BIDDING CLOSED" and named not one coin. That is the tab a holder opens to ask
 * "who is standing there, and what would it cost to take it from them" - and
 * the answer was a count of seats nobody could see.
 *
 * So this list is keyed on THE COIN. Every coin on the board appears exactly
 * once, whatever the ladder is doing, alongside every seat the ladder publishes
 * that nobody is standing on. A closed ladder therefore still lists the whole
 * field; what it loses is the prices, which is the honest thing to lose.
 *
 * WHAT IT NEVER DOES IS INVENT A PRICE. The seat a coin holds is resolved by
 * MINT, in buildBoard, and carried on the row; this module never looks a seat up
 * by number, never treats a board position as a seat, and prints no ask for a
 * coin the ladder publishes no seat for. See CatwalkLadder.tsx and the note on
 * `CatwalkRow.offer`.
 */

/** Why a coin on this list cannot be taken, or 'takeable' when it can.
 *
 *  'locked' is the distinction the tab exists to draw: a champion holds its slot
 *  on season wins and no price takes it, which is a rule of the product rather
 *  than a state of the sale. The other three are states of the sale and are kept
 *  apart for the reason the whole board keeps them apart - shut, unreadable and
 *  "this coin is not on the ladder" are three different facts. */
export type OutbidStatus = 'takeable' | 'open' | 'locked' | 'unlisted' | 'closed' | 'unknown'

/**
 * One row of the outbid list: a COIN, or a seat nobody is standing on.
 *
 * `seat` is the only member that may carry a price, and it is null unless the
 * ladder published a seat for this coin. `spot` is where the coin stands on the
 * board and is never used to look anything up - it is printed so a reader can
 * find the row again on the CATWALK tab.
 */
export type OutbidRow = {
  /** Stable across polls: the mint of the coin, or the seat's own number. */
  key: string
  status: OutbidStatus
  /** Null for a seat nobody holds - there is no coin to name. */
  mint: string | null
  symbol: string | null
  name: string | null
  logoUrl: string | null
  color: string | null
  /** Where the coin stands on the board, when it stands on it. Printed, never
   *  joined to a seat number. */
  spot: number | null
  lane: CatwalkRow['lane'] | null
  /** Whether this position walks every rotation. The walk-in band is the whole
   *  point of the list, so a row says which side of the line it is on. */
  walks: boolean
  /** The seat that is for sale. THE ONLY SOURCE OF A PRICE ON THIS LIST. */
  seat: CatwalkLadderSeat | null
  /** What the coin standing here paid, from its own entry or from the seat's
   *  own published figure - never from a board row that shares a number. */
  paidUsdMicros: number | null
  /** The coin's market cap, so the list reads as tokens rather than as prices
   *  with names attached. Null is unknown and renders as a dash, never $0. */
  marketCapUsd: number | null
}

/** A champion cannot be outbid at any price, so the sale's own state never
 *  decides its status. Everything else answers to the ladder. */
function statusOf(row: CatwalkRow, ladder: LadderState): OutbidStatus {
  if (row.lane === 'champion') return 'locked'
  if (ladder === 'unknown') return 'unknown'
  if (ladder === 'closed') return 'closed'
  if (row.offer && row.offer.askUsdMicros > 0) return 'takeable'
  return 'unlisted'
}

/** A numbered board position, whether or not a coin is standing in it. A
 *  VACANCY CARRIES NO PRICE: positions are not sold by their number, and the
 *  seat a buyer actually takes is on the ladder below. */
const boardRow = (row: CatwalkRow, ladder: LadderState): OutbidRow => ({
  key: row.entry ? row.entry.mint : `slot-${row.spot}`,
  status: row.lane === 'open' ? 'open' : statusOf(row, ladder),
  mint: row.entry?.mint ?? null,
  symbol: row.entry?.team?.symbol ?? null,
  name: row.entry?.team?.name ?? null,
  logoUrl: row.entry?.team?.logoUrl ?? null,
  color: row.entry?.team?.color ?? null,
  spot: row.spot,
  lane: row.lane,
  walks: row.walks,
  seat: row.offer,
  paidUsdMicros: row.paidUsdMicros,
  marketCapUsd: row.entry?.marketCapUsd ?? null,
})

const seatRow = (seat: CatwalkLadderSeat): OutbidRow => ({
  key: `seat-${seat.seat}`,
  status: seat.askUsdMicros > 0 ? 'takeable' : 'unlisted',
  mint: null,
  symbol: null,
  name: null,
  logoUrl: null,
  color: null,
  spot: null,
  lane: null,
  walks: true,
  seat,
  paidUsdMicros: null,
  marketCapUsd: null,
})

/**
 * THE WHOLE WALK-IN BAND, then anybody standing below it, then the seats.
 *
 * The list is EVERY position that walks every rotation - all twelve of them,
 * vacancies included - because those twelve are what this tab is about. Showing
 * only the positions that happened to have a coin in them meant a board with two
 * coins on it published a two-row list, which reads as a two-slot product rather
 * than as ten openings.
 *
 * Board order, not seat order: the reader has just come from a board numbered
 * 01..N, and re-sorting the same positions into the sale's numbering would make
 * the two lists look like two different fields.
 *
 * Then any coin standing BELOW the walk-in band, so no holder is missing from a
 * list that claims to name the field. Then the seats nobody is standing on, in
 * the sale's own numbering - those are the ladder's list, not the board's.
 *
 * A seat's HOLDER never appears twice: it was already named by its own board
 * row, which is where its price hangs.
 */
export function buildOutbidList(shape: CatwalkBoardShape, ladder: LadderState): OutbidRow[] {
  // THIS TAB IS ONE LANE, NOT THE WHOLE BOARD. It listed every position on the
  // runway, so coins that qualified by CLIMBING - which no price can take -
  // appeared on the page whose entire subject is what is for sale, marked NOT
  // FOR SALE. The merged field is the MIAW PRIX tab; this one is the outbid
  // lane and the positions it could still fill.
  const mine = (row: CatwalkRow) => row.lane === 'outbid' || row.lane === 'open'
  const walkIn = shape.rows.filter((row) => row.walks && mine(row)).map((row) => boardRow(row, ladder))
  const below = shape.rows.filter((row) => !row.walks && row.entry && mine(row)).map((row) => boardRow(row, ladder))
  const open = shape.seats.filter((seat) => !seatHeld(seat)).map(seatRow)
  return [...walkIn, ...below, ...open]
}

/** How many coins on the list could be taken right now. Stated only when the
 *  ladder answered, because under 'unknown' nobody has read whether any of them
 *  can be. */
export const takeableCount = (rows: readonly OutbidRow[]) =>
  rows.filter((row) => row.status === 'takeable').length
