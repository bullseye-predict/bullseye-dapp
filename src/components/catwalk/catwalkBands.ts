import type { CatwalkBoard, CatwalkLineupRow, GrandPrixStanding } from '../solz/catwalkSource'
import type { CatwalkLane, CatwalkSpot } from '../solz/model'

/**
 * The shape of the CATWALK table: which slots sit in which band of the
 * rotation, what a slot currently holds, and where a long stretch of vacancies
 * collapses.
 *
 * Everything here is pure so the board can be drawn before any read resolves,
 * and so the one rule the whole page rests on - a slot number is absolute
 * identity, never a position within a filtered list, and never a ladder seat
 * number - is testable on its own.
 */

/**
 * A BAND OF THE ROTATION.
 *
 * The board is not a race and has no podium, no grid and no back row. Coins
 * WALK IN: the top `activeSlots` walk every rotation, and the coins below them
 * walk against that band in turn - the twelve against 13-24, the twelve against
 * 25-36, then the twelve against each other. So the bands ARE the rotation, and
 * they are all the same size: one band of `activeSlots`, then as many further
 * bands of `activeSlots` as `lineupSize` holds.
 *
 * 'walk' is the band that walks every rotation. 'challenge' is a band that
 * walks it in one numbered round; `round` says which. Nothing here is
 * hardcoded to 12 or 36 - an admin moves either number and the bands follow.
 */
export type CatwalkBandKind = 'walk' | 'challenge'

export type CatwalkBand = {
  /** Stable key for lists and expand state: 'walk', 'challenge-1', ... */
  key: string
  kind: CatwalkBandKind
  /** Which rotation round this band walks the walk-in band in. 0 for the
   *  walk-in band itself, which walks in every round. */
  round: number
  label: string
  /** The right-hand note on the band head. Load-bearing: a viewer who cannot
   *  separate the shades still reads WALKS EVERY ROTATION from ONE ROTATION AWAY. */
  note: string
  start: number
  end: number
  /** True only for the band that walks every rotation. */
  walks: boolean
}

/** The board's shape is a product constant the server confirms rather than
 *  invents: twelve walk in, thirty-six stand on the board. Holding it here is
 *  what lets the first frame draw real bands, number chips, band copy and the
 *  walk line instead of a spinner standing where the structure will be. */
export const DEFAULT_ACTIVE_SLOTS = 12
export const DEFAULT_LINEUP_SIZE = 36

const ORDINAL = ['', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH']

const ordinal = (round: number) => ORDINAL[round] ?? `ROUND ${round}`

/**
 * Band ranges are derived from activeSlots and lineupSize, never hardcoded.
 *
 * The first band is 1..activeSlots. Every band after it is another activeSlots
 * positions, until lineupSize runs out - so 12 and 36 give 1-12, 13-24, 25-36,
 * and moving the cut to 8 gives 1-8, 9-16, 17-24, 25-32, 33-36 without a line
 * of this file changing. A final short band is kept rather than padded: the
 * positions it holds exist, and a band that claimed 33-40 would number eight
 * positions where the board has four.
 */
export function catwalkBands(activeSlots: number, lineupSize: number): CatwalkBand[] {
  const active = Math.max(0, Math.floor(activeSlots) || 0)
  const size = Math.max(active, Math.floor(lineupSize) || 0)
  if (size < 1) return []
  const step = active > 0 ? active : size
  const bands: CatwalkBand[] = [{
    key: 'walk',
    kind: 'walk',
    round: 0,
    label: `THE ${step === size ? 'BOARD' : 'WALK-IN'}`,
    note: `TOP ${step} — WALKS EVERY ROTATION`,
    start: 1,
    end: Math.min(step, size),
    walks: true,
  }]
  let round = 0
  for (let start = step + 1; start <= size; start += step) {
    round += 1
    bands.push({
      key: `challenge-${round}`,
      kind: 'challenge',
      round,
      label: `${ordinal(round)} CHALLENGE`,
      note: `WALKS THE TOP ${step} IN ROUND ${round}`,
      start,
      end: Math.min(start + step - 1, size),
      walks: false,
    })
  }
  return bands
}

/**
 * The line on an open row. It describes the POSITION and its place in the
 * rotation, never the sale: a vacancy has no price.
 *
 * The challenge copy says plainly what the owner asked it to say - a coin down
 * here is one rotation from walking in, and a coin up there is one rotation
 * from being replaced. Neither is a bench.
 */
export function bandInvitation(band: CatwalkBand): string {
  if (band.kind === 'walk') return `Walks every rotation. Held only until a challenger walks it down.`
  return `One rotation away. Whoever stands here walks the top ${band.start - 1} in round ${band.round}.`
}

/** Spoken band name, for the per-row aria-label. Band heads are hidden from
 *  assistive technology, so each row has to name its own band. */
export const bandSpoken = (band: CatwalkBand) =>
  band.kind === 'walk' ? 'walk-in' : `${ordinal(band.round).toLowerCase()} challenge`

export const bandRange = (band: CatwalkBand) => `${pad(band.start)}–${pad(band.end)}`

export function pad(spot: number) {
  return String(Math.max(0, Math.floor(spot))).padStart(2, '0')
}

/**
 * What is known about the spot ladder right now.
 *
 * Three-valued on purpose. 'closed' is a claim - the sale is not running - and
 * 'unknown' is the absence of one. Collapsing them into a boolean made a 502
 * from the proxy announce that the sale was closed while every slot was in fact
 * on sale, which is the worst of the three states to state wrongly.
 */
export type LadderState = 'open' | 'closed' | 'unknown'

/**
 * The season record read, as two states rather than one nullable Map.
 *
 * Same discipline as LadderState, for the same reason and one read over. A
 * rejected standings read used to be kept as the previous feed's empty Map,
 * which on the first poll is genuinely empty — so "this coin has no MIAW PRIX
 * matches this season" and "nobody answered" became the same value, and the
 * board stated the first about every coin on it. The CHAMPIONS tab made it
 * worst: a band head reading WON ON RAW WIN COUNT over a column of em dashes.
 */
export type StandingsState = 'read' | 'unknown'

/** One numbered position on the board, whether or not a coin is standing in it. */
export type CatwalkRow = {
  /** The BOARD POSITION. Never a ladder seat, and never joined to one. */
  spot: number
  /** The band of the rotation this position stands in. Carried whole rather
   *  than as a key, because the row's copy and its spoken label are both the
   *  band's, and looking them up again risked two answers for one row. */
  band: CatwalkBand
  /** 'open' is a fourth value here and never a lane on the wire: a vacancy is a
   *  first-class row, not a team with missing fields. */
  lane: CatwalkLane | 'open'
  entry: CatwalkLineupRow | null
  /**
   * The ladder seat THIS COIN HOLDS, whose ask is the price to take it from
   * them. Resolved by mint and only ever for an outbid-lane holder.
   *
   * A VACANCY IS ALWAYS null. Board positions are sequential 1..N in lane
   * priority order and do not track ladder seat numbers, so handing seat N to
   * the entry-less board row numbered N published an already-sold seat twice:
   * once as the outbid row of the coin that bought it, and again as an "OPEN
   * SLOT" under an unrelated number. The board says who walks; the ladder
   * (see `CatwalkLadderSeat`) says what is for sale. They are not joined.
   *
   * It is a `CatwalkLadderSeat` and never a raw `CatwalkSpot`, because the row
   * invites the viewer to take this seat ON THE OUTBID TAB: typing it as the
   * ladder's own seat is what makes it impossible to advertise a seat the
   * ladder does not publish.
   */
  offer: CatwalkLadderSeat | null
  /** What the coin standing here paid, from its own entry - never from a seat
   *  looked up by position, which is somebody else's price. */
  paidUsdMicros: number | null
  /** True when an operator placed this holder rather than anybody paying for it.
   *
   *  Carried alongside the amount rather than folded into it, and deliberately
   *  NOT rendered on the public board: by the owner's launch call a seeded
   *  holder draws exactly like a bought one (PAID plus the amount, in the label
   *  and in the accessible name), and a real outbid takes the seat over. The
   *  flag is threaded this far anyway because it is the same backend field the
   *  admin panel at :3101 reads to show "seeded — not a payment", and because
   *  dropping it from the model would mean re-threading it the day the board
   *  wants the distinction back. No public renderer may branch on it. */
  seeded: boolean
  /** The only permitted source of a win/loss record. Null means the read landed
   *  and this coin has none; `recordKnown` false means nobody answered, and the
   *  two must not render alike — one is a fact about the coin, the other is a
   *  fact about the network. */
  standing: GrandPrixStanding | null
  recordKnown: boolean
  /** Whether this position walks every rotation. Never "races": nothing on this
   *  board races, and the word taught viewers a metaphor the product does not
   *  have. */
  walks: boolean
}

/**
 * One seat on the spot ladder: a thing that is actually for sale.
 *
 * The ladder is exactly the outbid lane's quota (`outbidSpots` on the wire), it
 * numbers itself, and it carries its own holder. It is a separate list from the
 * board on purpose - a seat's number means "the Nth seat on sale" and a board
 * row's number means "the Nth position on the board", and the two are unrelated.
 */
export type CatwalkLadderSeat = {
  seat: number
  /** What it costs to take this seat now. */
  askUsdMicros: number
  /** The coin holding it, or null when nobody has bought it yet. */
  mint: string | null
  symbol: string | null
  name: string | null
  logoUrl: string | null
  /** What the current holder paid, when there is one. */
  heldUsdMicros: number | null
}

export const seatHeld = (seat: CatwalkLadderSeat) => Boolean(seat.mint)

/** The cheapest seat nobody is standing on, or null when none is priced. This
 *  is the ONLY thing the page may call "the floor": it is a fact about the
 *  ladder, and the board has no floor because board positions are not sold. */
export function cheapestSeat(seats: readonly CatwalkLadderSeat[]): CatwalkLadderSeat | null {
  let best: CatwalkLadderSeat | null = null
  for (const seat of seats) {
    if (seatHeld(seat) || seat.askUsdMicros <= 0) continue
    if (!best || seat.askUsdMicros < best.askUsdMicros) best = seat
  }
  return best
}

/**
 * The priced ladder, in its own numbering.
 *
 * Nothing is synthesised: a seat exists here only because the ladder published
 * it. `outbidSpots` bounds the list because the server publishes exactly the
 * outbid quota, and anything past it is a position nobody can buy. A ladder
 * that did not answer - or answered that it is shut - has no seats at all,
 * because there is then no fact to render.
 */
export function buildLadder(
  spots: readonly CatwalkSpot[],
  outbidSpots: number,
  ladder: LadderState,
): CatwalkLadderSeat[] {
  if (ladder !== 'open') return []
  const bound = Math.max(0, Math.floor(outbidSpots) || 0)
  const seen = new Set<number>()
  const seats: CatwalkLadderSeat[] = []
  for (const spot of [...spots].sort((a, b) => a.spot - b.spot)) {
    if (spot.spot < 1 || seen.has(spot.spot)) continue
    if (bound > 0 && spot.spot > bound) continue
    seen.add(spot.spot)
    seats.push({
      seat: spot.spot,
      askUsdMicros: spot.askUsdMicros,
      mint: spot.mint ?? null,
      symbol: spot.symbol ?? null,
      name: spot.name ?? null,
      logoUrl: spot.logoUrl ?? null,
      heldUsdMicros: spot.heldUsdMicros ?? null,
    })
  }
  return seats
}

export type CatwalkBoardShape = {
  activeSlots: number
  lineupSize: number
  bands: CatwalkBand[]
  rows: CatwalkRow[]
  /** The ladder, which is NOT the board. Empty unless the ladder read is open. */
  seats: CatwalkLadderSeat[]
  claimed: number
  /** How many of the walk-in positions a coin is standing in. */
  walkingClaimed: number
  /** The cheapest ask among ladder seats nobody holds, or null when none is. */
  floorUsdMicros: number | null
  /** What every unheld ladder seat together would cost at the current asks. */
  openSeatUsdMicros: number
  /** False when the season record could not be read at all. The page discloses
   *  this once, rather than each row implying it about its own coin. */
  recordsKnown: boolean
}

type BuildInput = {
  board: CatwalkBoard | null
  spots: readonly CatwalkSpot[]
  /** How many seats the ladder publishes. Defaults to however many arrived. */
  outbidSpots?: number
  standings: Map<string, GrandPrixStanding>
  /** 'unknown' forbids stating that any coin has no record. Defaults to 'read'
   *  so an existing caller that never had an outage keeps its meaning. */
  standingsState?: StandingsState
  /** Anything but 'open' means no ask may be rendered: between seasons because
   *  there is no sale, and on an unreadable read because there is no fact. */
  ladder: LadderState
}

export function buildBoard({ board, spots, outbidSpots, standings, standingsState = 'read', ladder }: BuildInput): CatwalkBoardShape {
  const activeSlots = board ? board.activeSlots || DEFAULT_ACTIVE_SLOTS : DEFAULT_ACTIVE_SLOTS
  const lineupSize = Math.max(activeSlots, board ? board.lineupSize || DEFAULT_LINEUP_SIZE : DEFAULT_LINEUP_SIZE)
  const bands = catwalkBands(activeSlots, lineupSize)
  const entries = new Map<number, CatwalkLineupRow>()
  for (const entry of board?.lineup ?? []) if (entry.spot >= 1) entries.set(entry.spot, entry)
  // The ladder is built FIRST, because it is the only list a board row may point
  // at. Every seat the board advertises is one of these.
  const seats = buildLadder(spots, outbidSpots ?? spots.length, ladder)
  // ONE index, ONE question: "what does the seat THIS coin holds cost to take".
  // Only the mint can answer it. There is deliberately no index by number - a
  // board position and a ladder seat are different numbers, and looking one up
  // by the other is what put a sold seat on the board twice.
  //
  // And it is indexed off THE PUBLISHED LADDER, not off the raw `spots` payload.
  // buildLadder drops everything past the outbid quota, so a map built from
  // `spots` let a held row advertise "SEAT 05 - $5,040" and send the viewer to
  // an OUTBID tab that publishes seats 1..3, where seat 5 does not exist.
  const seatByMint = new Map<string, CatwalkLadderSeat>()
  for (const seat of seats) if (seat.mint) seatByMint.set(seat.mint, seat)

  const rows: CatwalkRow[] = []
  for (const band of bands) {
    for (let spot = band.start; spot <= band.end; spot += 1) {
      const entry = entries.get(spot) ?? null
      rows.push({
        spot,
        band,
        lane: entry ? entry.lane : 'open',
        entry,
        // Champion and ranked seats are earned, so they are never on the ladder
        // however the numbers happen to line up - and a vacancy is not on it
        // either, because a vacancy is a position, not a thing for sale.
        offer: entry && entry.lane === 'outbid' ? seatByMint.get(entry.mint) ?? null : null,
        paidUsdMicros: entry?.paidUsdMicros ?? null,
        seeded: entry?.seeded === true,
        standing: entry ? standings.get(entry.mint) ?? null : null,
        // A coin the Map holds has a record — possibly from the previous poll,
        // but a real one. A coin the Map does NOT hold is only known to have no
        // record when the read landed; otherwise it may simply have joined the
        // board after the Map was taken, and its absence is our ignorance
        // rather than its history.
        recordKnown: standingsState === 'read' || !!(entry && standings.has(entry.mint)),
        walks: band.walks,
      })
    }
  }

  // The floor is a fact about the LADDER, not about the board: it is the
  // cheapest seat nobody is standing on.
  const asks = seats.filter((seat) => !seatHeld(seat) && seat.askUsdMicros > 0).map((seat) => seat.askUsdMicros)
  const open = rows.filter((row) => row.lane === 'open')
  return {
    activeSlots,
    lineupSize,
    bands,
    rows,
    seats,
    claimed: rows.length - open.length,
    walkingClaimed: rows.filter((row) => row.walks && row.lane !== 'open').length,
    floorUsdMicros: asks.length ? Math.min(...asks) : null,
    openSeatUsdMicros: asks.reduce((total, ask) => total + ask, 0),
    recordsKnown: standingsState === 'read',
  }
}
