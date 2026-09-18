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
 * CATWALK IS A ROTATION SYSTEM, NOT A LIST. The board has two bands and only
 * ever two: THE RUNWAY, the top `activeSlots`, which walk every MIAW PRIX
 * rotation; and THE LINE-UP, everybody else, who walk the runway in turn. The
 * runway's advantage is time on the board, not a different kind of slot - a
 * line-up coin is one rotation from walking in, and a runway coin is one
 * rotation from being walked down. Neither band is a bench.
 *
 * It used to cut the line-up into numbered CHALLENGE bands of `activeSlots`
 * each - 13-24 in round one, 25-36 in round two - which published a rotation
 * order the wire does not carry and split twenty-four positions across two
 * heads that said the same thing twice. One band says it once.
 *
 * Nothing here is hardcoded to 12 or 36: an admin moves either number and the
 * two bands follow.
 */
export type CatwalkBandKind = 'runway' | 'lineup'

export type CatwalkBand = {
  /** Stable key for lists: 'runway' or 'lineup'. */
  key: string
  /** Which band this is. NOTE the near-collision with `lineupSize`, which is the
   *  WHOLE board (36) - this kind is the band BELOW the runway (13-36). */
  kind: CatwalkBandKind
  label: string
  /** The right-hand note on the band head. Load-bearing: a viewer who cannot
   *  separate the shades still reads WALKS EVERY ROTATION from WALKS IN TURN. */
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

/**
 * Band ranges are derived from activeSlots and lineupSize, never hardcoded.
 *
 * Two bands when the board is deeper than the runway - 1..activeSlots and
 * activeSlots+1..lineupSize - and ONE when it is not, because a line-up of
 * nobody is not a band. Moving the cut to 8 on a 36-slot board gives 1-8 and
 * 9-36 without a line of this file changing.
 */
export function catwalkBands(activeSlots: number, lineupSize: number): CatwalkBand[] {
  const active = Math.max(0, Math.floor(activeSlots) || 0)
  const size = Math.max(active, Math.floor(lineupSize) || 0)
  if (size < 1) return []
  const step = active > 0 ? active : size
  const runway = Math.min(step, size)
  const bands: CatwalkBand[] = [{
    key: 'runway',
    kind: 'runway',
    // A board with no line-up under it is the whole board, and calling it THE
    // RUNWAY there would imply a second band that does not exist.
    label: runway === size ? 'THE BOARD' : 'THE RUNWAY',
    note: `TOP ${runway} — WALKS EVERY ROTATION`,
    start: 1,
    end: runway,
    walks: true,
  }]
  if (runway < size) {
    bands.push({
      key: 'lineup',
      kind: 'lineup',
      label: 'THE LINE-UP',
      note: `WALKS THE TOP ${runway} IN TURN`,
      start: runway + 1,
      end: size,
      walks: false,
    })
  }
  return bands
}

/**
 * The line on an open row. It describes the POSITION and its place in the
 * rotation, never the sale: a vacancy has no price.
 *
 * The line-up copy says plainly what the owner asked it to say - a coin down
 * here is one rotation from walking in, and a coin up there is one rotation
 * from being replaced. Neither is a bench.
 */
export function bandInvitation(band: CatwalkBand): string {
  if (band.kind === 'runway') return `Walks every rotation. Held only until a challenger walks it down.`
  return `One rotation away. Whoever stands here walks the top ${band.start - 1} in turn.`
}

/** Spoken band name, for the per-row aria-label. Band heads are hidden from
 *  assistive technology, so each row has to name its own band. */
export const bandSpoken = (band: CatwalkBand) =>
  band.kind === 'runway' ? 'runway' : 'line-up'

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

/** The three ways onto the board, in the order the hero stands them up. It is
 *  deliberately not `LANES`: that list is the wire vocabulary and carries
 *  'open', which is the absence of a lane rather than one of them. */
const FRONT_LANES = ['champion', 'outbid', 'ranked'] as const

/**
 * THE FRONT OF THE WALK: the three cards the hero stands up.
 *
 * ONE CARD PER LANE, AND EACH ONE IS THAT LANE'S TOP QUALIFIER - champion,
 * then outbid, then SOLZ ranked. That is the whole point of the row: the three
 * cards are not a podium and not the top of the board, they are the three ways
 * onto this board, each showing who currently leads it. A row that took the
 * best three holders in board order instead put the outbid lane in two cards
 * and left the ranked lane unrepresented, so the hero advertised two routes
 * where the board offers three.
 *
 * It is therefore a choice ACROSS THE LANES, not a slice of the board. It used
 * to be board positions 01, 02 and 03 by number, which on a board whose
 * champions had not been settled yet put three vacancies at the top of the page
 * while real coins stood at 04 and 05 - the page's loudest surface advertising
 * emptiness over its own holders.
 *
 * WITHIN A LANE THE TOP QUALIFIER IS THE LOWEST BOARD POSITION, and between
 * lanes the order is fixed: champion is the only lane that is WON and the only
 * one no price can take, so it leads. This function invents no ranking of its
 * own beyond that - inside a lane it defers to the board position the server
 * assigned, which already carries whatever priority the product intends.
 *
 * IT RANKS ON NOTHING THAT MIGHT NOT HAVE BEEN READ. Not wins (`standing` is
 * null both for a coin with no record and, whenever the standings read failed,
 * for every coin on the board), not the ask (`offer` is null in every ladder
 * state but 'open'), and not market cap (null means unpublished). A front row
 * that reshuffled itself when a side-read failed would restate the board on
 * every blip. `lane` and `spot` are the two fields every row always carries.
 *
 * EXACTLY THREE, ALWAYS. A lane with no holder yet does not leave a hole and
 * does not get a card fabricated for it: the row falls back to the remaining
 * HOLDERS in board order, and only then to the lowest-numbered VACANCIES. So an
 * empty board is the same code path as a full one, the hero never grows or
 * loses a card, and a board with two lanes running still shows two real coins
 * rather than one coin and two empty plinths. The fill rows are genuinely open
 * positions and render as vacancies.
 */
export function catwalkFront(shape: CatwalkBoardShape, cards = 3): CatwalkRow[] {
  const bySpot = (a: CatwalkRow, b: CatwalkRow) => a.spot - b.spot
  const held = shape.rows.filter((row) => row.lane !== 'open').sort(bySpot)
  // The lane order IS the card order, so this array is the row's contract.
  const leaders = FRONT_LANES.flatMap((lane) => {
    const top = held.find((row) => row.lane === lane)
    return top ? [top] : []
  })
  const rest = held.filter((row) => !leaders.includes(row))
  const vacant = shape.rows.filter((row) => row.lane === 'open').sort(bySpot)
  return [...leaders, ...rest, ...vacant].slice(0, Math.max(0, cards))
}
