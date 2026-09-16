import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CatwalkApp, CatwalkFooter, CatwalkPanel, CatwalkSearchPanel, CatwalkSplit, searchOutcome,
} from '../src/components/catwalk/CatwalkApp'
import { CatwalkHero, clockParts, frontCardKey } from '../src/components/catwalk/CatwalkHero'
import { CatwalkClock, ClockPending } from '../src/components/catwalk/CatwalkLockFace'
import { CatwalkRankedRail, boardHolds, formatBaseUnits } from '../src/components/catwalk/CatwalkRankedRail'
import { CatwalkComposition } from '../src/components/catwalk/CatwalkComposition'
import { CatwalkLadderList, CatwalkOutbidList, CatwalkSeatRow } from '../src/components/catwalk/CatwalkLadder'
import { buildOutbidList, takeableCount } from '../src/components/catwalk/catwalkOutbid'
import { CatwalkSlotRow, pickCoin } from '../src/components/catwalk/CatwalkSlotRow'
import { TeamMark } from '../src/components/home/HomePrimitives'
import { logoResolvesHere, overlayTokenMeta, parseTokenMeta } from '../src/components/solz/tokenMeta'
import { allowedIconHost, tokenIconUrl } from '../src/components/solz/tokenIcon'
import { buildBoard, buildLadder, catwalkBands, catwalkFront } from '../src/components/catwalk/catwalkBands'
import { nextCatwalkLock } from '../src/components/catwalk/catwalkLock'
import { PAIRING_LOCK_MS } from '../src/components/miawprix/board'
import {
  boardSearchLayer, CATWALK_TABS, catwalkBoardLayer, isCatwalkTab, matchedSpots, parseCatwalkQuery, tabRows,
  type CatwalkPanelId,
} from '../src/components/catwalk/catwalkQuery'
import { ladderStateOf } from '../src/components/catwalk/useCatwalkBoard'
import {
  parseCatwalkBoard, parseGrandPrixStandings, standingsByMint,
  type CatwalkRankedLaneRead, type CatwalkRankedProjectRow,
} from '../src/components/solz/catwalkSource'
import type { CatwalkLane, CatwalkSpot } from '../src/components/solz/model'

// Structurally valid base58 that decodes to 32 bytes but belongs to nobody. A
// real mainnet mint as a stand-in (MINT_B used to be Raydium's) invites someone
// to copy a fixture address out of a test and treat it as this product's.
// Prefixes chosen so they appear in no symbol or name used below: the mint-only
// search assertions have to be testing the mint, not colliding with a ticker.
const MINT_A = 'ZqTestM1nt' + 'A'.repeat(34)
const MINT_B = 'YwTestM1nt' + 'B'.repeat(34)
const MINT_C = 'XvTestM1nt' + 'C'.repeat(34)

// The fixture tickers are $FOOFIX / $BARFIX: foo-and-bar placeholders nobody can
// mistake for a listing. They used to be $MIAW and $GIGA, and $MIAW is the
// owner's OWN product name (MIAW PRIX) - reading the file, a fixture row looked
// like a coin that had quietly been added to the board. The pair still carries
// the relationships several tests turn on: $BARFIX is P02's ticker AND a word
// inside P01's name, so ticker-over-name ranking has something to rank, and
// neither string shares a prefix with MINT_A / MINT_B so the mint-only search
// assertions are testing the mint.
// A bid is now an amount and nothing else: /api/v1/catwalk stopped publishing
// `seeded`, `wallet` and `paidAt`, so the fixtures carry the shape the board
// actually receives. The legacy shape is exercised on purpose in
// `legacyEntry` below, which is the compatibility test's fixture and nothing
// else's.
const entry = (spot: number, lane: CatwalkLane, mint: string, symbol: string, name = symbol, paidUsdMicros?: number) => ({
  spot, mint, lane, active: true,
  team: { mint, symbol, name, logoUrl: 'https://cdn.test/a.png', color: '#ff6ab2' },
  bid: paidUsdMicros ? { usdMicros: paidUsdMicros } : null,
})

/** The same row as it arrives from a server that has not shipped the drop yet:
 *  the amount, plus the three fields the public payload no longer carries. */
const legacyEntry = (spot: number, lane: CatwalkLane, mint: string, symbol: string, usdMicros: number) => ({
  spot, mint, lane, active: true,
  team: { mint, symbol, name: symbol, logoUrl: 'https://cdn.test/a.png', color: '#ff6ab2' },
  bid: { usdMicros, wallet: 'BuyerWa11etAddress', paidAt: 1_700_000_000_000, seeded: true },
})

const board = (lineup: unknown[], activeSlots = 12, lineupSize = 36) => parseCatwalkBoard({
  ok: true, gameKey: 'solz', activeSlots, lineupSize,
  season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 0, endsAt: 1 },
  lineup,
})

/**
 * A RANKED LANE READ, whole.
 *
 * The parser fills `projects`, `registryTokens` and `registryUpdatedAt` on every
 * read, so a fixture that omitted them would be testing a shape the wire never
 * produces - and the three-valued state is the thing these tests exist to hold,
 * so it is the one field every caller states for itself.
 */
const lane = (state: string, over: Partial<CatwalkRankedLaneRead> = {}): CatwalkRankedLaneRead => ({
  state, candidates: 0, projects: [], registryTokens: null, registryUpdatedAt: null, ...over,
})

/** One coin as the chain answered for it. The figures are DECIMAL STRINGS: they
 *  are u64s and a u128 on the wire, and a Number here would be the exact
 *  coercion the parser refuses. */
const project = (symbol: string, over: Partial<CatwalkRankedProjectRow> = {}): CatwalkRankedProjectRow => ({
  mint: `${symbol}M1nt` + 'Z'.repeat(30),
  symbol,
  name: `${symbol} token`,
  logoUrl: null,
  matches: '1427',
  playerEntries: '8194',
  poolBaseUnits: '1208317450000000',
  poolDecimals: 6,
  ...over,
})

const standings = (rows: unknown[]) => standingsByMint(parseGrandPrixStandings({ ok: true, season: null, rows }).rows)

/**
 * The ladder is the outbid lane's quota, not the whole board: it publishes only
 * positions that can actually be bought, in ITS OWN numbering. `holders` names
 * the coin sitting on a seat, which the ladder publishes for itself - the board
 * never looks a holder up by seat number, and a seat never looks one up by
 * board position.
 */
const ladder = (seats: number, holders: Record<number, string> = {}, ask = 1_900_000_000): CatwalkSpot[] =>
  Array.from({ length: seats }, (_unused, index) => ({
    spot: index + 1,
    askUsdMicros: ask + index,
    mint: holders[index + 1],
  }))

/** P01 champion, P04 bought its slot through ladder seat 1, three seats on sale. */
const launch = () => buildBoard({
  board: board([entry(1, 'champion', MINT_A, '$FOOFIX'), entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
  spots: ladder(3, { 1: MINT_B }),
  standings: standings([{ mint: MINT_A, symbol: '$FOOFIX', name: 'Foofix', wins: 3, losses: 0, matches: 3 }]),
  ladder: 'open',
})

/** The numbered list alone, without the toolbar, the key or the footer around
 *  it. Assertions about what the BOARD states belong against this rather than
 *  against the whole document, where a legend that names the lanes and a tab
 *  that names a lane both carry the same words a row would. */
const boardList = (html: string) => html.slice(html.indexOf('id="cw-list"'))

/** The numbered TABLE alone, out of the CATWALK tab's two columns. The tab is a
 *  split - the board on the left, the outbid rail on the right - so a count of
 *  rows taken over the whole panel counts both, and every assertion about the
 *  BOARD's structure has to say which half it means. */
const splitBoard = (html: string) => {
  const start = html.indexOf('cw-split-board')
  if (start < 0) return html
  const end = html.indexOf('cw-split-rail')
  return html.slice(start, end < 0 ? undefined : end)
}

/* ── bands ───────────────────────────────────────────────────────────────── */

/**
 * THE BOARD IS A ROTATION AND IT HAS TWO BANDS.
 *
 * They used to be podium 1-3, grid 4-8, back row 9-12, reserve 13-36 - four
 * tiers of a race that does not exist, and a "reserve" of twenty-four coins
 * described as not taking part. Then they became numbered CHALLENGE bands of
 * `activeSlots` each, which published a round order the wire does not carry and
 * split twenty-four positions across two heads saying the same thing twice.
 *
 * THE RUNWAY walks every rotation; THE LINE-UP walks it in turn. Two bands, and
 * both derived from activeSlots and lineupSize rather than hardcoded.
 */
test('the board is one runway and one line-up, derived rather than hardcoded', () => {
  expect(catwalkBands(12, 36).map((band) => `${band.key} ${band.start}-${band.end}`)).toEqual([
    'runway 1-12', 'lineup 13-36',
  ])
  // Moving the cut moves both bands with it, and no slot is left unbanded.
  expect(catwalkBands(8, 36).map((band) => `${band.key} ${band.start}-${band.end}`)).toEqual([
    'runway 1-8', 'lineup 9-36',
  ])
  // The line-up ends at the board's real size, never padded past it.
  expect(catwalkBands(8, 36).at(-1)).toMatchObject({ start: 9, end: 36 })
  // Nothing below the cut means no line-up band is drawn at all.
  expect(catwalkBands(12, 12).map((band) => band.key)).toEqual(['runway'])
  // And a board with no band under it is THE BOARD, not a runway implying one.
  expect(catwalkBands(12, 12)[0]!.label).toBe('THE BOARD')
  // The bands say what they DO in the rotation, in no racing words and no
  // numbered rounds - the wire carries no rotation order to number.
  const [runway, lineup] = catwalkBands(12, 36)
  expect(runway!.label).toBe('THE RUNWAY')
  expect(runway!.note).toBe('TOP 12 — WALKS EVERY ROTATION')
  expect(lineup!.label).toBe('THE LINE-UP')
  expect(lineup!.note).toBe('WALKS THE TOP 12 IN TURN')
  expect(lineup!.walks).toBe(false)
  expect(JSON.stringify(catwalkBands(12, 36))).not.toContain('ROUND')
})

/**
 * A STRETCH OF VACANCIES IS STILL A STRETCH OF NUMBERED POSITIONS.
 *
 * This test used to pin the opposite: a run of four or more vacancies collapsed
 * into a strip of number chips behind a SHOW ALL control, so a band of twelve
 * empties rendered three rows and a summary. On the board's launch state - every
 * position open - that hid most of the structure the board exists to show, which
 * is exactly what the owner rejected. There is no collapsing left; the board is
 * thirty-six positions and it draws thirty-six rows.
 */
test('a band of vacancies draws every one of its numbered positions', () => {
  const shape = buildBoard({ board: board([], 12, 36), spots: [], standings: new Map(), ladder: 'closed' })
  const html = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="closed" />)
  expect(splitBoard(html).match(/class="cw-slot/g)).toHaveLength(36)
  expect(html).not.toContain('cw-run')
  expect(html).not.toContain('SHOW ALL')
  expect(html).not.toMatch(/AND \d+ MORE/)
})

/**
 * activeSlots === lineupSize is permitted by the settings schema. The explainer
 * strip that used to be tested here rendered "13–12 are qualified and waiting"
 * for it - a range describing nobody - and the strip is gone, so the guarantee
 * moves to the thing that survived: at that setting the board draws ONE band,
 * and no head anywhere claims an inverted range.
 */
test('a board with no line-up under it draws one band, never an inverted range', () => {
  const full = buildBoard({ board: board([], 12, 12), spots: [], standings: new Map(), ladder: 'closed' })
  const html = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={full} ladder="closed" />)
  expect(html).not.toContain('13–12')
  expect(html).not.toContain('THE LINE-UP')
  expect(html).toContain('THE BOARD')

  const banded = buildBoard({ board: board([], 12, 36), spots: [], standings: new Map(), ladder: 'closed' })
  const drawn = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={banded} ladder="closed" />)
  expect(drawn).toContain('THE LINE-UP')
  expect(drawn).toContain('13–36')
  // Below the cut is one rotation away, said plainly - never a bench, and never
  // a numbered round the schedule does not publish.
  expect(drawn).toContain('One rotation away.')
  expect(drawn).not.toContain('bench')
  expect(drawn).not.toContain('ROUND ')
})

/* ── the hard ban on fabricated records ──────────────────────────────────── */

test('a coin with no standings row renders an em dash, never 0-0', () => {
  const shape = launch()
  const barfix = shape.rows.find((row) => row.spot === 4)!
  expect(barfix.standing).toBeNull()
  const html = renderToStaticMarkup(<CatwalkSlotRow row={barfix} metric="record" state="filled" ladder="open" />)
  expect(html).toContain('—')
  expect(html).toContain('No MIAW PRIX matches recorded this season.')
  expect(html).not.toContain('0–0')
  expect(html).not.toContain('0-0')
})

test('a record renders only from standings, and the ranked lane never shows a number', () => {
  const shape = buildBoard({
    board: board([entry(1, 'ranked', MINT_A, '$FOOFIX')]),
    spots: [], ladder: 'closed',
    standings: standings([{ mint: MINT_A, symbol: '$FOOFIX', name: 'Foofix', wins: 4, losses: 1, matches: 5 }]),
  })
  const row = shape.rows[0]!
  expect(renderToStaticMarkup(<CatwalkSlotRow row={row} metric="record" state="filled" />)).toContain('4–1')
  const lane = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="lane" state="filled" />)
  expect(lane).toContain('RANKED')
  expect(lane).not.toMatch(/RANKED\s*<\/b>\s*<small>#/)
  expect(lane).not.toContain('#1')
})

/* ── board position is not ladder seat ───────────────────────────────────── */

test('a held row prices itself from its own bid, never from the seat with its number', () => {
  // The old server sold ladder positions 1..activeSlots and the board joined them
  // to rows by number: $BARFIX, which paid for seat 1, was rendered against the ask
  // of seat 4 because it happens to stand at board position 4.
  const shape = buildBoard({
    board: board([entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: [
      { spot: 1, askUsdMicros: 1_100_000_000, mint: MINT_B, heldUsdMicros: 999_000_000 },
      { spot: 4, askUsdMicros: 9_900_000_000 },
    ],
    standings: new Map(),
    ladder: 'open',
  })
  const row = shape.rows.find((slot) => slot.spot === 4)!
  expect(row.paidUsdMicros).toBe(4_200_000_000)
  // Board position 4, ladder seat 1. The two numbers are unrelated by design.
  // `offer` is now the LADDER's own seat rather than a raw wire spot, so the
  // field naming it is `seat`: a row can only ever point at a published seat.
  expect(row.offer?.seat).toBe(1)

  const html = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />)
  expect(html).toContain('PAID $4,200')
  expect(html).toContain('$1,100')
  expect(html).not.toContain('$9,900')
  expect(html).not.toContain('$999')
})

test('champion and ranked holders are never matched to a ladder seat at all', () => {
  const shape = buildBoard({
    board: board([entry(1, 'champion', MINT_A, '$FOOFIX')]),
    spots: ladder(3, { 1: MINT_A }),
    standings: new Map(),
    ladder: 'open',
  })
  expect(shape.rows[0]!.offer).toBeNull()
  const html = renderToStaticMarkup(<CatwalkSlotRow row={shape.rows[0]!} metric="record" state="filled" ladder="open" />)
  expect(html).toContain('HELD BY RECORD')
  expect(html).toContain('Champion and ranked slots are earned, not bought.')
  expect(html).not.toContain('cw-act--claim')
})

/**
 * BLOCKER 2, at its root.
 *
 * This test used to assert the opposite: that a vacancy whose number matched a
 * ladder seat should render that seat's ask and a live CLAIM button. That is the
 * defect. Board positions are sequential 1..N in lane-priority order and do not
 * track ladder seat numbers, so a seat already sold to a coin standing elsewhere
 * on the board was published twice - once as that coin's outbid row, and again
 * as an "OPEN SLOT" under an unrelated number, at a price nobody could pay.
 */
test('a sold ladder seat is published once, and never again as a vacancy carrying its number', () => {
  const shape = buildBoard({
    board: board([entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: ladder(3, { 1: MINT_B }),
    standings: new Map(),
    ladder: 'open',
  })
  // Board position 1 is vacant. Ladder seat 1 is SOLD - $BARFIX stands on it, from
  // board position 4. The old join handed seat 1 to the vacancy at P01.
  const p01 = shape.rows.find((row) => row.spot === 1)!
  expect(p01.lane).toBe('open')
  expect(p01.offer).toBeNull()
  // Not one vacancy on the board carries a price, at any number.
  expect(shape.rows.filter((row) => row.lane === 'open').every((row) => row.offer === null)).toBe(true)
  // The seat appears exactly once, on the ladder, carrying its own holder.
  expect(shape.seats.map((seat) => seat.seat)).toEqual([1, 2, 3])
  expect(shape.seats.filter((seat) => seat.mint === MINT_B)).toHaveLength(1)
  expect(shape.seats[0]!.mint).toBe(MINT_B)
  // And the floor is the cheapest seat nobody holds, never the sold one.
  expect(shape.floorUsdMicros).toBe(1_900_000_001)

  const vacancy = renderToStaticMarkup(<CatwalkSlotRow row={p01} metric="record" state="open" ladder="open" />)
  expect(vacancy).toContain('OPEN SLOT')
  expect(vacancy).not.toContain('$1,900')
  expect(vacancy).not.toContain('FLOOR')
  expect(vacancy).not.toMatch(/CLAIM P\d/)
})

test('the ladder is its own list, numbered by the sale rather than by the board', () => {
  const seats = buildLadder(
    [
      { spot: 1, askUsdMicros: 5_040_000_000, mint: MINT_B, symbol: '$BARFIX', name: 'Barfix', heldUsdMicros: 4_200_000_000 },
      { spot: 2, askUsdMicros: 1_900_000_000 },
    ],
    2,
    'open',
  )
  const html = renderToStaticMarkup(<CatwalkLadderList seats={seats} onClaim={() => undefined} />)
  expect(html).toContain('SPOT LADDER')
  // A held seat names its holder and what they paid, both from the ladder's own
  // payload - never re-joined to a board row that shares the number.
  expect(html).toContain('$BARFIX')
  expect(html).toContain('HELD AT $4,200')
  expect(html).toContain('OUTBID $5,040')
  // An unheld seat is the thing that is actually for sale.
  expect(html).toContain('SEAT 02')
  expect(html).toContain('TAKE $1,900')

  // A ladder that did not answer, or answered that it is shut, publishes no
  // seats at all: there is then no fact to render.
  expect(buildLadder([{ spot: 1, askUsdMicros: 1 }], 1, 'unknown')).toHaveLength(0)
  expect(buildLadder([{ spot: 1, askUsdMicros: 1 }], 1, 'closed')).toHaveLength(0)
  // Nothing is synthesised past what the sale published.
  expect(buildLadder([{ spot: 1, askUsdMicros: 1 }], 6, 'open')).toHaveLength(1)
  expect(buildLadder([{ spot: 1, askUsdMicros: 1 }, { spot: 9, askUsdMicros: 2 }], 3, 'open').map((seat) => seat.seat)).toEqual([1])
})

/* ── the open slot ───────────────────────────────────────────────────────── */

test('an open slot carries no symbol, no mint, no crest and no record', () => {
  const shape = launch()
  const open = shape.rows.find((row) => row.spot === 2)!
  const html = renderToStaticMarkup(<CatwalkSlotRow row={open} metric="record" state="open" ladder="open" />)
  expect(html).toContain('OPEN SLOT')
  expect(html).toContain('Walks every rotation.')
  expect(html).toContain('cw-open-well')
  expect(html).not.toContain('sh-team-mark')
  expect(html).not.toContain('cw-mint')
  expect(html).not.toContain('RECORD')
  // A vacancy is numbered, and its chip is the outlined one.
  expect(html).toContain('>02<')
  expect(html).toContain('cw-slot--open')
  expect(html).toContain('data-lane="open"')
})

/**
 * This test used to be called "a position the ladder does not sell says so", and
 * it pinned the number-join: a vacancy inside the outbid quota was expected to
 * light a CLAIM control from the seat sharing its number, and one outside it was
 * expected to print NOT FOR SALE. Both are claims about a sale that does not
 * concern this row. A board position is never sold - the ladder is - so a
 * vacancy states what the position IS and points at the ladder, or nothing.
 */
test('a board vacancy quotes no price at any number, and never claims to be a listing', () => {
  const shape = launch()
  const row = (spot: number, onLadder?: () => void) =>
    renderToStaticMarkup(<CatwalkSlotRow row={shape.rows.find((slot) => slot.spot === spot)!} metric="record" state="open" ladder="open" onLadder={onLadder} />)

  // P02 sits inside the outbid quota by number. It still quotes nothing.
  const walkIn = row(2)
  expect(walkIn).not.toContain('$')
  expect(walkIn).not.toContain('FLOOR')
  expect(walkIn).not.toContain('NOT FOR SALE')
  expect(walkIn).not.toMatch(/CLAIM P\d/)
  expect(walkIn).toContain('FILLS FROM THE LANES')

  // With seats actually on sale, a walk-in vacancy points at the ladder - which
  // is a list, not this number.
  const pointing = row(2, () => undefined)
  expect(pointing).toContain('TAKE A SEAT')
  expect(pointing).toContain('Seats are bought on the spot ladder')
  expect(pointing).not.toMatch(/CLAIM P\d/)

  // A challenge position is not sent to the ladder at all - and it is described
  // as one rotation away, never as a reserve sitting out.
  const challenge = row(20, () => undefined)
  expect(challenge).toContain('OPEN TO CHALLENGERS')
  expect(challenge).toContain('One rotation away.')
  expect(challenge).not.toContain('TAKE A SEAT')
  expect(challenge).not.toContain('RESERVE')
  expect(challenge).not.toContain('NOT RACING')
})

test('with no claim handler the seat control is inert and states why, never a fake purchase', () => {
  const seat = buildLadder([{ spot: 1, askUsdMicros: 1_900_000_000 }], 1, 'open')[0]!
  const html = renderToStaticMarkup(
    <CatwalkSeatRow seat={seat} claimReason="Claiming a seat needs the wallet flow, which is not wired up yet." />,
  )
  expect(html).toContain('disabled')
  expect(html).toContain('wallet flow')
})

/* ── open, closed and unreadable are three states ────────────────────────── */

/**
 * This test used to assert that every vacancy prints SALE CLOSED when the ladder
 * is shut. It does not any more: the state of the sale is a fact about the
 * LADDER, and printing it on thirty-six board positions announced that each of
 * them was a listing that had been withdrawn. The ladder simply has no seats.
 */
test('a closed ladder publishes no seats, and the board states nothing about the sale', () => {
  const shape = buildBoard({ board: board([]), spots: ladder(3), standings: new Map(), ladder: 'closed' })
  expect(shape.seats).toHaveLength(0)
  expect(shape.floorUsdMicros).toBeNull()

  const html = renderToStaticMarkup(<CatwalkSlotRow row={shape.rows[0]!} metric="record" state="open" ladder="closed" />)
  expect(html).toContain('OPEN SLOT')
  expect(html).not.toContain('SALE CLOSED')
  expect(html).not.toContain('PRICING SOON')
  expect(html).not.toContain('NOTIFY ME')
  expect(html).not.toContain('$0')
})

test('an unreadable ladder never claims the sale is closed', () => {
  // The proxy answers 502 upstream-bad and 503 on timeout, so a blip must not
  // announce a shut sale while every seat is in fact on sale.
  expect(ladderStateOf({ status: 'rejected', reason: new Error('unavailable (502)') })).toBe('unknown')
  expect(ladderStateOf({ status: 'fulfilled', value: { available: false } })).toBe('closed')
  expect(ladderStateOf({ status: 'fulfilled', value: { available: true } })).toBe('open')

  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'unknown' })
  // A vacancy says nothing either way: it was never on the ladder, so an
  // unreadable ladder is not news about it.
  const html = renderToStaticMarkup(<CatwalkSlotRow row={shape.rows[0]!} metric="record" state="open" ladder="unknown" />)
  expect(html).not.toContain('PRICE UNAVAILABLE')
  expect(html).not.toContain('SALE CLOSED')
  expect(html).not.toContain('NOT FOR SALE')
  expect(html).not.toContain('cw-act--claim')

  // The OUTBID tab is where the ladder read IS the subject, and there the two
  // states stay apart. This assertion used to point at the counter strip, which
  // is gone; the distinction it guards never lived only there.
  const held = buildBoard({
    board: board([entry(1, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: [], standings: new Map(), ladder: 'unknown',
  })
  const unreadable = renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={held} ladder="unknown" />)
  expect(unreadable).toContain('PRICE UNAVAILABLE')
  expect(unreadable).not.toContain('SALE CLOSED')
})

/* ── the crown gate ──────────────────────────────────────────────────────── */

/**
 * THE BADGE FOLLOWS THE LANE, NEVER THE CARD.
 *
 * `catwalkFront` puts champions in card one, so card one and the champion lane
 * coincide on nearly every board - and the moment the gate is simplified to
 * "card one wears the crown", a board with no champion crowns whoever paid the
 * most. `launch()` is exactly that shape now: a champion on card one AND an
 * outbid holder on card two, so one render proves the badges are two different
 * questions rather than two names for the same position.
 */
test('the crown renders for a champion and a receipt for a coin that paid for the front', () => {
  const championed = renderToStaticMarkup(
    <CatwalkHero shape={launch()} season={{ seasonId: 'solz-01', seasonIndex: 1, startsAt: 0, endsAt: Date.now() + 86_400_000 }} />,
  )
  expect(championed).toContain('cw-crown')
  expect(championed).toContain('cw-bought')

  // No champion on the board: the front row's first card is a coin that PAID,
  // and it must still wear a receipt rather than inherit a crown from its rank.
  const bought = buildBoard({
    board: board([entry(1, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: ladder(3, { 1: MINT_B }), standings: new Map(), ladder: 'open',
  })
  const html = renderToStaticMarkup(<CatwalkHero shape={bought} season={null} />)
  expect(html).toContain('cw-bought')
  expect(html).not.toContain('cw-crown')

  // And a ranked holder in card one wears neither.
  const climbed = buildBoard({
    board: board([entry(1, 'ranked', MINT_A, '$FOOFIX')]),
    spots: [], standings: new Map(), ladder: 'closed',
  })
  const ranked = renderToStaticMarkup(<CatwalkHero shape={climbed} season={null} />)
  expect(ranked).not.toContain('cw-crown')
  expect(ranked).not.toContain('cw-bought')
})

test('a front plinth never quotes the ladder seat that shares its number', () => {
  // P02 and P03 are vacant; ladder seats 2 and 3 are on sale at $1,900. Pricing
  // the plinth from them sold a seat off the hero under the wrong number.
  const html = renderToStaticMarkup(<CatwalkHero shape={launch()} season={null} />)
  expect(html).toContain('FILLS FROM THE LANES')
  expect(html).not.toContain('$1,900')
  expect(html).not.toContain('>CLAIM<')
})

/* ── a number that is not known yet is not zero ──────────────────────────── */

test('a board nobody has read yet states no count, no headline and no invitation', () => {
  // This used to assert the opposite - that the first frame may print
  // "NOBODY HAS WALKED IN YET" and "0 OF 12 WALK-IN SLOTS CLAIMED" from
  // the default shape. Those are readings of a board that has not been read, and
  // they are wrong whenever the real grid is full.
  const unread = buildBoard({ board: null, spots: [], standings: new Map(), ladder: 'unknown' })
  const hero = renderToStaticMarkup(<CatwalkHero shape={unread} season={null} pending />)
  // The structure is preserved: three plinths at their full size, as always.
  expect(hero.match(/data-pos="/g)).toHaveLength(3)
  expect(hero).toContain('cw-pending')
  expect(hero).not.toContain('NOBODY HAS WALKED IN YET')
  expect(hero).not.toContain('ON THE RUNWAY')
  expect(hero).not.toContain('OPEN')
  expect(hero).not.toContain('SALE CLOSED')
  // Not a slot number either: WHICH three positions stand at the front is a
  // reading of the board, and the plinths used to print 01, 02, 03 regardless.
  expect(hero).not.toContain('>01<')

  // THE CLOCK IS NOT IN THE HERO AT ALL ANY MORE - it is the head of the rail,
  // on every tab, because the hero is the first thing off screen once the tab
  // bar sticks. What the hero must still never do is state a schedule.
  expect(hero).not.toContain('cw-clock')
  expect(hero).not.toContain('BOARD LOCKS IN')
  expect(hero).not.toContain('NO ROTATION IS SCHEDULED YET')
  expect(hero).not.toContain('THE SCHEDULE COULD NOT BE READ')

  // And once a read lands on a genuinely empty board, the zero is a fact again.
  const read = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const resolved = renderToStaticMarkup(<CatwalkHero shape={read} season={null} />)
  expect(resolved).toContain('NOBODY HAS WALKED IN YET')
  expect(resolved).toContain('0 OF 12 ON THE RUNWAY')
})

/* ── the front of the walk is chosen across the lanes ────────────────────── */

/**
 * THE FRONT ROW IS A CHOICE, NOT A SLICE.
 *
 * It used to be board positions 01, 02 and 03 by number, so a board whose
 * champions had not been settled yet put three VACANCIES on the loudest surface
 * of the page while real coins stood at 04 and 05.
 *
 * Champions lead because champion is the only lane that is won and the only one
 * no price can take. Between the other lanes the function invents no ranking of
 * its own: it defers to the board position the server already assigned.
 */
test('the front of the walk takes champions first, then holders, then vacancies', () => {
  // A champion at 02, an outbid holder at 05 and a ranked holder at 09: by board
  // number the front three would be 01 (empty), 02 and 03 (empty).
  const mixed = buildBoard({
    board: board([
      entry(2, 'champion', MINT_A, '$FOOFIX'),
      entry(5, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000),
      entry(9, 'ranked', MINT_C, '$BAZFIX'),
    ]),
    spots: ladder(3, { 1: MINT_B }),
    standings: new Map(),
    ladder: 'open',
  })
  expect(catwalkFront(mixed).map((row) => `${row.spot} ${row.lane}`))
    .toEqual(['2 champion', '5 outbid', '9 ranked'])

  // Short of three holders it fills from the LOWEST-NUMBERED vacancies, and the
  // fill rows are genuinely open positions rather than fabricated ones.
  const one = buildBoard({
    board: board([entry(4, 'ranked', MINT_A, '$FOOFIX')]),
    spots: [], standings: new Map(), ladder: 'closed',
  })
  expect(catwalkFront(one).map((row) => `${row.spot} ${row.lane}`))
    .toEqual(['4 ranked', '1 open', '2 open'])

  // Always exactly three, on a board nobody has touched.
  const none = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  expect(catwalkFront(none)).toHaveLength(3)
  expect(catwalkFront(none).every((row) => row.lane === 'open')).toBe(true)
})

/**
 * THE BIG DIGIT ON A CARD IS THE COIN'S BOARD SLOT, NOT ITS PLACE IN THE ROW.
 *
 * `data-pos` is the card's place in this row of three and is what catwalk.css
 * sizes, tilts and metals from. The two were the same integer only while the
 * hero took slots 01-03 by number, and printing one as the other would tell a
 * viewer that the coin on card two stands at board position 02.
 */
test('a front card prints its coin s board slot, never its place in the row', () => {
  const shape = buildBoard({
    board: board([entry(7, 'champion', MINT_A, '$FOOFIX')]),
    spots: [], standings: new Map(), ladder: 'closed',
  })
  const html = renderToStaticMarkup(<CatwalkHero shape={shape} season={null} />)
  // Card one is rank 1 for layout...
  expect(html).toContain('data-pos="1"')
  // ...and says slot 07, in ink and out loud.
  expect(html).toContain('>07<')
  expect(html).toContain('aria-label="Slot 7"')
  expect(html).not.toContain('aria-label="Position 1"')
  // Still exactly three cards, whatever the fill.
  expect(html.match(/data-pos="/g)).toHaveLength(3)
})

/* ── when the board next locks ───────────────────────────────────────────── */

/**
 * THE LOCK IS DERIVED FROM THE SCHEDULE, AND IT IS FIVE-VALUED.
 *
 * The wire carries `scheduledStartAt` and nothing else about timing, so the
 * lock is kickoff minus PAIRING_LOCK_MS - the same twelve hours /miaw-prix
 * derives it from, imported rather than copied. A read that has not landed, a
 * read that failed and a programme with nothing on it are three different
 * facts, and only the last of them is about the schedule.
 */
test('the next lock is the earliest kickoff whose window has not opened', () => {
  const NOW = 1_800_000_000_000
  const match = (scheduledStartAt: number, extra: Record<string, unknown> = {}) => ({
    matchId: `m-${scheduledStartAt}`, displayMatchId: 'm', scheduledStartAt,
    status: 'scheduled', definitionId: 'colosseum_team_deathmatch_3v3', title: '',
    sides: [], result: null, rewardPoolL: null, ...extra,
  })
  const programme = (matches: unknown[]) => ({ season: null, seasons: [], standings: [], matches } as never)

  // Nobody has read it, and nobody has answered: two different silences.
  expect(nextCatwalkLock(null, NOW)).toEqual({ state: 'unread' })
  // Read, and genuinely nothing on the calendar.
  expect(nextCatwalkLock(programme([]), NOW)).toEqual({ state: 'none' })
  // A match with no kickoff is not a kickoff of zero.
  expect(nextCatwalkLock(programme([match(0)]), NOW)).toEqual({ state: 'none' })
  // A settled or cancelled fixture will never pair, so it is not a lock.
  expect(nextCatwalkLock(programme([
    match(NOW + 5 * PAIRING_LOCK_MS, { result: { winnerTeamId: 't', winnerMint: MINT_A } }),
    match(NOW + 9 * PAIRING_LOCK_MS, { status: 'cancelled' }),
  ]), NOW)).toEqual({ state: 'none' })

  // The earliest kickoff whose window is still ahead - NOT simply the earliest
  // kickoff, which would count down to an instant in the past.
  const soon = NOW + PAIRING_LOCK_MS - 60_000
  const later = NOW + PAIRING_LOCK_MS + 3_600_000
  expect(nextCatwalkLock(programme([match(later), match(soon)]), NOW))
    .toEqual({ state: 'counting', locksAt: later - PAIRING_LOCK_MS, startsAt: later })

  // Every scheduled rotation already inside its window: the lock is open, which
  // is not the same claim as an empty schedule.
  expect(nextCatwalkLock(programme([match(soon)]), NOW)).toEqual({ state: 'open', startsAt: soon })

  // A KICKOFF ALREADY IN THE PAST IS NOT A WALK THAT IS ABOUT TO PAIR.
  // matchState() reads a row with no result and a 'scheduled' status as upcoming
  // however old it is, so a fixture the programme never settled sits there for
  // ever. Without a `now` bound it fell into the 'open' branch and the hero said
  // THE NEXT WALK IS ALREADY PAIRING about a kickoff three days gone.
  expect(nextCatwalkLock(programme([match(NOW - 3 * 86_400_000)]), NOW)).toEqual({ state: 'none' })
  // And a stale fixture never outranks a real one still ahead.
  expect(nextCatwalkLock(programme([match(NOW - 3 * 86_400_000), match(later)]), NOW))
    .toEqual({ state: 'counting', locksAt: later - PAIRING_LOCK_MS, startsAt: later })
})

test('the rail clock states the lock it has and never invents one', () => {
  // The lead is passed because a real page always has one: it is published on
  // the board payload now, rather than being a twelve-hour literal in the copy.
  const face = (lock: Parameters<typeof CatwalkClock>[0]['lock']) =>
    renderToStaticMarkup(<CatwalkClock lock={lock} leadMs={PAIRING_LOCK_MS} />)

  // A read that FAILED says so, and never that nothing is scheduled.
  const unreadable = face({ state: 'unreadable' })
  expect(unreadable).toContain('THE SCHEDULE COULD NOT BE READ')
  expect(unreadable).not.toContain('NO ROTATION IS SCHEDULED YET')
  // And a programme with nothing on it says THAT, and never that a read failed.
  const none = face({ state: 'none' })
  expect(none).toContain('NO ROTATION IS SCHEDULED YET')
  expect(none).not.toContain('THE SCHEDULE COULD NOT BE READ')
  // Neither one publishes a figure.
  for (const html of [unreadable, none]) expect(html).not.toMatch(/<b[^>]*>\d\d:/)

  // A live lock is a clock, announced as one.
  const counting = face({ state: 'counting', locksAt: Date.now() + 7 * 3_600_000, startsAt: Date.now() + 19 * 3_600_000 })
  expect(counting).toContain('BOARD LOCKS IN')
  expect(counting).toContain('role="timer"')
  expect(counting).toContain('PAIRINGS BIND 12H BEFORE THE WALK')
  // Under a day the clock drops the day column rather than printing 00:.
  expect(counting).toMatch(/<b role="timer" aria-live="off">0[67]:\d\d:\d\d<\/b>/)
})

/**
 * A SCHEDULE NOBODY HAS READ IS NOT A SCHEDULE THAT FAILED.
 *
 * `lockFace` handles counting, open and none and then falls through, and the
 * fallthrough sentence is the NETWORK's - so 'unread' landing in it told every
 * caller that omitted a lock prop that the read had failed. That is the whole
 * distinction the schedule read was built to keep, inverted, on the default.
 */
test('a schedule nobody has read yet states nothing, not that a read failed', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  // No lock prop at all: the default is 'unread', and it must draw the box and
  // make no claim - not while pending, and not after the BOARD read has landed,
  // because the two reads fail independently.
  const html = renderToStaticMarkup(<CatwalkClock lock={{ state: 'unread' }} />)
  expect(html).toContain('cw-clock--pending')
  expect(html).not.toContain('BOARD LOCKS IN')
  expect(html).not.toContain('THE SCHEDULE COULD NOT BE READ')
  expect(html).not.toContain('NO ROTATION IS SCHEDULED YET')
  expect(html).not.toContain('PAIRED — THE WALK STARTS IN')
  // And not a dash either: an em dash is an ANSWER, and nobody has asked the
  // programme yet. The box holds its height and says nothing at all.
  expect(html).not.toContain('—')
  // The page's own pending face, which is the same box.
  expect(renderToStaticMarkup(<ClockPending />)).toContain('cw-clock--pending')
})

/**
 * THE DAY FIELD IS LABELLED, BECAUSE BOTH REGIMES WANT THREE FIGURES.
 *
 * DD:HH:MM and HH:MM:SS are the same six unlabelled digits, so a lock 24 hours
 * out and a lock 1 hour out both rendered `01:00:00` - two answers a day apart,
 * on the one clock this page expects a holder to act on.
 */
test('the lock clock never renders a day and an hour as the same digits', () => {
  const DAY_MS = 86_400_000
  expect(clockParts(DAY_MS, true)).toBe('01D 00:00')
  expect(clockParts(3_600_000, true)).toBe('01:00:00')
  expect(clockParts(DAY_MS, true)).not.toBe(clockParts(3_600_000, true))
  // Just under a day keeps the seconds; just over it takes the day label.
  expect(clockParts(DAY_MS - 1_000, true)).toBe('23:59:59')
  expect(clockParts(2 * DAY_MS + 5 * 3_600_000 + 30 * 60_000, true)).toBe('02D 05:30')
  // Reduced motion drops the second hand and nothing else.
  expect(clockParts(7 * 3_600_000 + 13 * 60_000 + 44_000, false)).toBe('07:13')
  // A lock that has passed counts to zero rather than backwards.
  expect(clockParts(-5_000, true)).toBe('00:00:00')
})

/**
 * THE THREE CARDS NEVER SHARE A KEY.
 *
 * The empty-card fallback mixed a 1-based board spot with a 0-based card index,
 * so on a two-slot board card three keyed itself 'slot-2' - the key the vacancy
 * at spot 02 already held. React would then reuse one card's DOM for the other.
 */
test('the front row keys every card distinctly, even on a board shorter than three', () => {
  // A duplicate React key is INVISIBLE in rendered markup - React collapses the
  // two elements and says nothing a static render can be asked about - so the
  // key function is tested directly rather than through the DOM.
  const tiny = buildBoard({ board: board([], 2, 2), spots: [], standings: new Map(), ladder: 'closed' })
  expect(tiny.rows).toHaveLength(2)
  const front = catwalkFront(tiny)
  expect(front).toHaveLength(2)
  const keys = [0, 1, 2].map((index) => frontCardKey(front[index] ?? null, index))
  expect(keys).toEqual(['slot-1', 'slot-2', 'card-2'])
  expect(new Set(keys).size).toBe(3)

  // And on a full board the key is the COIN, so a card that changes hands
  // between polls gets a new element rather than the previous lane's chrome.
  const held = launch()
  const heldKeys = catwalkFront(held).map((row, index) => frontCardKey(row, index))
  expect(heldKeys[0]).toBe(MINT_A)
  expect(heldKeys[1]).toBe(MINT_B)
  expect(new Set(heldKeys).size).toBe(3)

  // Three cards render either way.
  expect(renderToStaticMarkup(<CatwalkHero shape={tiny} season={null} />).match(/data-pos="/g)).toHaveLength(3)
})

/**
 * A HERO GIVEN NO CLOCK MEASURES NOTHING.
 *
 * `now` defaulted to 0, and the kicker's days-left is `ceil((endsAt - now)/DAY)`
 * - so any caller that omitted it measured the season from the epoch and printed
 * 20716D LEFT beside the season number.
 */
test('the season kicker states days left only when it was given a clock', () => {
  const season = { seasonId: 'solz-01', seasonIndex: 1, startsAt: 0, endsAt: Date.now() + 3 * 86_400_000 }
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const blind = renderToStaticMarkup(<CatwalkHero shape={shape} season={season} />)
  expect(blind).not.toContain('D LEFT')
  expect(blind).toContain('SEASON 01')

  const clocked = renderToStaticMarkup(<CatwalkHero shape={shape} season={season} now={Date.now()} />)
  expect(clocked).toContain('3D LEFT')
})

/* ── the season is numbered, never keyed ─────────────────────────────────── */

test('the season prints its padded index, never the raw season id', () => {
  const html = renderToStaticMarkup(
    <CatwalkHero shape={launch()} season={{ seasonId: 'solz-00', seasonIndex: 0, startsAt: 0, endsAt: Date.now() + 86_400_000 }} />,
  )
  expect(html).toContain('SEASON 00')
  expect(html).not.toContain('solz-00')

  // The counter strip carried the second copy of this label and is gone; the
  // kicker is the one place the season is named now, and it still never leaks
  // the storage key.
  const seven = renderToStaticMarkup(
    <CatwalkHero shape={launch()} season={{ seasonId: 'solz-07', seasonIndex: 7, startsAt: 0, endsAt: 0 }} />,
  )
  expect(seven).toContain('SEASON 07')
  expect(seven).not.toContain('solz-07')
  // A season with no end publishes no days-left figure rather than a zero.
  expect(seven).not.toContain('D LEFT')
})

/* ── tabs and search ─────────────────────────────────────────────────────── */

test('a lane tab names its members, OUTBID is the ladder, and no tab renumbers', () => {
  const shape = launch()
  expect(tabRows('champions', shape.rows).map((row) => row.spot)).toEqual([1])
  expect(tabRows('ranked', shape.rows)).toHaveLength(0)
  // OUTBID used to be a filter of the board - vacancies plus outbid holders -
  // which is the shape of the idea that a vacancy is itself a thing for sale. It
  // now shows the whole grid beside the ladder, which is its own list.
  expect(tabRows('outbid', shape.rows)).toHaveLength(36)
  expect(shape.seats.map((seat) => seat.seat)).toEqual([1, 2, 3])
  // Slot numbers are absolute identity: a filter never renumbers.
  expect(tabRows('catwalk', shape.rows)[3]!.spot).toBe(4)
})

test('search ranks ticker over name over mint, and a bare number is a slot lookup', () => {
  const shape = buildBoard({
    board: board([entry(1, 'outbid', MINT_A, '$FOOFIX', 'Barfix Cat'), entry(2, 'outbid', MINT_B, '$BARFIX', 'Foofix Coin')]),
    spots: ladder(3, { 1: MINT_A, 2: MINT_B }), standings: new Map(), ladder: 'open',
  })
  // $BARFIX holds P02 by ticker; P01 only mentions "barfix" in its name.
  expect(matchedSpots(shape.rows, parseCatwalkQuery('$barfix'))).toEqual([2, 1])
  // Two characters must not hit every base58 string on the board, even when
  // they really are the start of one of them.
  expect(matchedSpots(shape.rows, parseCatwalkQuery('Zq'))).toEqual([])
  expect(matchedSpots(shape.rows, parseCatwalkQuery(MINT_A.slice(0, 8)))).toEqual([1])
  expect(parseCatwalkQuery('p12')).toEqual({ kind: 'slot', spot: 12, raw: 'p12' })
  expect(matchedSpots(shape.rows, parseCatwalkQuery('2'))).toEqual([2])
})

/* ── the launch state, end to end ────────────────────────────────────────── */

test('two coins on a 36-slot board still render the whole board', () => {
  const shape = launch()
  expect(shape.rows).toHaveLength(36)
  expect(shape.claimed).toBe(2)
  expect(shape.walkingClaimed).toBe(2)
  // The floor is the cheapest seat that is genuinely on sale, which is seat 2:
  // seat 1 is held, and the ladder stops at the outbid quota.
  expect(shape.floorUsdMicros).toBe(1_900_000_001)
  // Every unheld seat together, and nothing about board positions.
  expect(shape.openSeatUsdMicros).toBe(1_900_000_001 + 1_900_000_002)
})

test('the first frame draws the real board structure and counts nothing', () => {
  const html = renderToStaticMarkup(<CatwalkApp />)
  expect(html).toContain('cw-pending')
  // All 36 numbered positions, both band heads and the walk line exist before
  // any read resolves: the board's shape is known without the network.
  expect(html.match(/class="cw-slot/g)?.length).toBeGreaterThan(12)
  expect(html).toContain('THE RUNWAY')
  expect(html).toContain('THE LINE-UP')
  expect(html).toContain('TOP 12 WALK IN EVERY ROTATION')
  expect(html).not.toContain('Loading')
  // And not one racing word survives anywhere on the first frame. PODIUM is on
  // this list although the hero now picks its three cards across the lanes: the
  // selection is a choice, not a finishing order, and the page must not say so.
  for (const word of ['PODIUM', 'RESERVE', 'BACK ROW', 'THE GRID', 'RACING', 'RACES']) {
    expect(html).not.toContain(word)
  }
  // The rounds went with the challenge bands: the wire carries no rotation
  // order, so nothing may number one.
  expect(html).not.toContain('CHALLENGE')
  expect(html).not.toContain('ROUND ')
  // But nothing on it counts, headlines or invites while the board is unread.
  expect(html).not.toContain('NOBODY HAS WALKED IN YET')
  expect(html).not.toContain('ON THE RUNWAY')
  expect(html).not.toContain('0 CLAIMED')
  expect(html).not.toContain('CLAIMED 0')
  expect(html).not.toContain('36 OPEN')
  expect(html).not.toContain('SLOTS OPEN')
  expect(html).not.toContain('Take a seat at the floor')
})

/**
 * BLOCKER 1, at its root, in the BODY of the board.
 *
 * The hero, the counter, the count line, the tab counts and the footer already
 * waited for the read. The row list, the collapsed-run strip and the per-row
 * ladder note did not, so the first frame said - verbatim, thirty-six times over
 * - that every position was vacant, that the ladder read had FAILED before it
 * was attempted, and how many positions were open. All three are readings of a
 * board nobody has read.
 */
test('the loading board renders rows at full size and makes no claim about any of them', () => {
  const html = renderToStaticMarkup(<CatwalkApp />)

  // STRUCTURE IS PRESERVED: every numbered position holds its row box.
  expect(html).toContain('cw-slot--skeleton')
  expect(html.match(/cw-slot cw-slot--skeleton/g)).toHaveLength(36)
  expect(html).toContain('>36<')
  // And a reader is told the read is running rather than left with a shimmer.
  expect(html).toContain('Reading the board.')

  // NO VACANCY IS ASSERTED.
  //
  // Scoped to the LIST, because that is where a claim about a position would be
  // made. The lane-key legend that used to sit above it - and that printed the
  // word OPEN as one of four things a colour could mean - is gone, so the whole
  // document may now be held to the same line the list was.
  const list = boardList(html)
  expect(list).not.toContain('OPEN SLOT')
  expect(list).not.toContain('>OPEN<')
  expect(list).not.toContain('cw-slot--open')
  expect(list).not.toContain('cw-open-well')
  expect(list).not.toContain('FILLS FROM THE LANES')
  expect(html).not.toContain('cw-key')
  expect(html).not.toMatch(/<em>\d+ SLOTS?<\/em>/)

  // NO COUNT OF HOW MANY ARE OPEN, AND NO COLLAPSED-RUN SUMMARY.
  expect(html).not.toContain('cw-run')
  expect(html).not.toMatch(/AND \d+ MORE/)
  expect(html).not.toContain('SHOW ALL')

  // NO VERDICT ON A LADDER READ THAT HAS NOT BEEN ATTEMPTED.
  expect(html).not.toContain('The spot ladder could not be read')
  expect(html).not.toContain('PRICE UNAVAILABLE')
  expect(html).not.toContain('SALE CLOSED')
  expect(html).not.toContain('NOT FOR SALE')
  expect(html).not.toContain('NO ASK PUBLISHED')

  // AND NO INVITATION TO BUY A NUMBER.
  expect(html).not.toMatch(/CLAIM P\d/)
  expect(html).not.toContain('TAKE A SEAT')
  expect(html).not.toContain('TAKE CHEAPEST')
})

/* ── the three ladder states never collapse into two ─────────────────────── */

/**
 * The footer printed "Nothing on the ladder is buyable right now" whenever
 * `ladder === 'open' && floorUsdMicros` was falsy, which folds 'unknown' into
 * 'closed'. On a rejected spots read - the proxy's 502/503, which `ladderStateOf`
 * turns into 'unknown' - the page printed, one directly above the other, "THE
 * SPOT LADDER COULD NOT BE READ ... nothing about the sale has changed" and then
 * a flat verdict that nothing was for sale.
 */
test('an unreadable ladder leaves the footer making no claim about the sale', () => {
  const unread = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'unknown' })
  const html = renderToStaticMarkup(<CatwalkFooter pending={false} openCount={36} shape={unread} ladder="unknown" />)
  expect(html).toContain('36 SLOTS OPEN')
  expect(html).toContain('could not be read just now')
  expect(html).not.toContain('Nothing on the ladder is buyable right now')
  expect(html).not.toContain('Take a seat at the floor')
  // Nor does it quote a total for seats nobody has read.
  expect(html).not.toContain('OF LADDER SEATS UNSOLD')

  // A ladder that ANSWERED that it is shut is a claim, and may still be stated.
  const shut = buildBoard({ board: board([]), spots: ladder(3), standings: new Map(), ladder: 'closed' })
  const closed = renderToStaticMarkup(<CatwalkFooter pending={false} openCount={36} shape={shut} ladder="closed" />)
  expect(closed).toContain('Nothing on the ladder is buyable right now')
  expect(closed).not.toContain('could not be read')

  // An open ladder with a floor still invites.
  const open = renderToStaticMarkup(<CatwalkFooter pending={false} openCount={34} shape={launch()} ladder="open" />)
  expect(open).toContain('Take a seat at the floor')

  // And nothing at all is stated before the read lands.
  const pending = renderToStaticMarkup(<CatwalkFooter pending openCount={36} shape={unread} ladder="unknown" />)
  expect(pending).toContain('cw-pending')
  expect(pending).not.toContain('SLOTS OPEN')
  expect(pending).not.toContain('could not be read')
})

/* ── a lane is not the board ─────────────────────────────────────────────── */

/**
 * The miss was scored against the ACTIVE TAB's filtered rows while `SearchMiss`
 * makes a whole-board claim, so with $BARFIX standing at P04 and the viewer on
 * CHAMPIONS, searching "$BARFIX" printed "THAT COIN IS NOT ON THE BOARD YET" and
 * offered to sell its holder a ladder seat - contradicted by the page's own
 * loaded rows one tab over.
 */
test('a coin on the board but not in this lane is pointed at, never told it is absent', () => {
  const shape = launch()
  const panel = (outcome: ReturnType<typeof searchOutcome>) => renderToStaticMarkup(
    <CatwalkSearchPanel
      outcome={outcome}
      shape={shape}
      ladder="open"
      onLane={() => undefined}
      onClaim={() => undefined}
      rankedHref="/agent-arena"
    />,
  )
  const champions = tabRows('champions', shape.rows)

  const elsewhere = searchOutcome(parseCatwalkQuery('$BARFIX'), shape.rows, champions)
  expect(elsewhere.kind).toBe('elsewhere')
  const html = panel(elsewhere)
  expect(html).toContain('$BARFIX IS ON THE BOARD, JUST NOT IN THIS LANE.')
  expect(html).toContain('It holds slot 04 in the OUTBID lane.')
  expect(html).toContain('SHOW IT ON MIAW PRIX')
  // The false premise, and the up-sell it justified, are both gone.
  expect(html).not.toContain('THAT COIN IS NOT ON THE BOARD YET')
  expect(html).not.toContain('TAKE SEAT')
  expect(html).not.toContain('HOW TO QUALIFY FREE')

  // A slot lookup is the same story: P07 is a position on the board, and the
  // CHAMPIONS lane simply does not hold it.
  const slot = searchOutcome(parseCatwalkQuery('7'), shape.rows, champions)
  expect(slot.kind).toBe('elsewhere')
  const slotHtml = panel(slot)
  expect(slotHtml).toContain('SLOT 07 IS ON THE BOARD, JUST NOT IN THIS LANE.')
  expect(slotHtml).toContain('Slot 07 is an open position, so it stands in no lane yet.')
  expect(slotHtml).not.toContain('THAT COIN IS NOT ON THE BOARD YET')

  // A coin nowhere on the board is still a funnel, on every tab.
  const missed = searchOutcome(parseCatwalkQuery('$NOPE'), shape.rows, champions)
  expect(missed.kind).toBe('miss')
  const miss = panel(missed)
  expect(miss).toContain('THAT COIN IS NOT ON THE BOARD YET')
  expect(miss).toContain('TAKE SEAT 02')

  // And a lane that does hold the hit renders its rows, not a panel at all.
  expect(searchOutcome(parseCatwalkQuery('$FOOFIX'), shape.rows, champions).kind).toBe('hits')
  expect(panel(searchOutcome(parseCatwalkQuery('$FOOFIX'), shape.rows, champions))).toBe('')
})

/* ── the front of the walk before anything has been read ─────────────────── */

test('the pending front paints no vacancy, not just no OPEN', () => {
  const unread = buildBoard({ board: null, spots: [], standings: new Map(), ladder: 'unknown' })
  const hero = renderToStaticMarkup(<CatwalkHero shape={unread} season={null} pending />)
  // `cw-hero-card--open` is this page's PAINT for a vacancy - dashed edge, flat
  // unlit fill, ghosted number. Withholding the word OPEN while keeping the
  // class still told the first frame's viewer the front of the walk was empty.
  expect(hero).not.toContain('cw-hero-card--open')
  expect(hero).toContain('cw-hero-card--pending')
  expect(hero.match(/data-pos="/g)).toHaveLength(3)

  // Once a read lands on a genuinely empty front, the vacancy is painted again.
  const read = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  expect(renderToStaticMarkup(<CatwalkHero shape={read} season={null} />)).toContain('cw-hero-card--open')
})

/* ── the board may only point at a seat the ladder publishes ─────────────── */

/**
 * `seatByMint` was built from every entry in `spots` with no outbidSpots bound,
 * while `buildLadder` drops seats above it. A held row could therefore advertise
 * "SEAT 05 - $5,040" and invite the viewer to take it on the OUTBID tab, where
 * the ladder publishes seats 1..3 and seat 5 does not exist.
 */
test('a held row advertises only a seat the ladder actually publishes', () => {
  const spots: CatwalkSpot[] = [
    { spot: 1, askUsdMicros: 1_900_000_000 },
    { spot: 2, askUsdMicros: 1_900_000_001 },
    { spot: 3, askUsdMicros: 1_900_000_002 },
    { spot: 5, askUsdMicros: 5_040_000_000, mint: MINT_B, heldUsdMicros: 4_200_000_000 },
  ]
  const shape = buildBoard({
    board: board([entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots, outbidSpots: 3, standings: new Map(), ladder: 'open',
  })
  // The ladder stops at the quota, so seat 5 is published nowhere.
  expect(shape.seats.map((seat) => seat.seat)).toEqual([1, 2, 3])
  const row = shape.rows.find((slot) => slot.spot === 4)!
  expect(row.offer).toBeNull()

  const html = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />)
  expect(html).not.toContain('SEAT 05')
  expect(html).not.toContain('$5,040')
  expect(html).toContain('NOT FOR SALE')
  expect(html).toContain('The spot ladder publishes no seat for this coin')

  // A seat INSIDE the quota is still advertised, at the ladder's own number.
  const inside = buildBoard({
    board: board([entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: [...spots.slice(0, 2), { spot: 3, askUsdMicros: 5_040_000_000, mint: MINT_B, heldUsdMicros: 4_200_000_000 }],
    outbidSpots: 3, standings: new Map(), ladder: 'open',
  })
  const held = inside.rows.find((slot) => slot.spot === 4)!
  expect(held.offer?.seat).toBe(3)
  expect(renderToStaticMarkup(<CatwalkSlotRow row={held} metric="take" state="filled" ladder="open" />)).toContain('SEAT 03')
})

// A standings read that nobody answered is not a season in which nobody raced.
// This is the same defect the ladder was fixed for one read over: the rejection
// was kept as the previous feed's Map, which on the first poll is empty.
test('a standings read that failed is never stated as "no record this season"', () => {
  const lineup = [entry(1, 'champion', MINT_A, '$ALPHA'), entry(2, 'ranked', MINT_B, '$BETA')]
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 2, lineupSize: 4,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    lineup,
  })

  const unread = buildBoard({ board, spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'unknown', ladder: 'open' })
  const read = buildBoard({ board, spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'read', ladder: 'open' })

  expect(unread.recordsKnown).toBe(false)
  expect(read.recordsKnown).toBe(true)
  expect(unread.rows[0]!.recordKnown).toBe(false)
  expect(read.rows[0]!.recordKnown).toBe(true)

  const held = (shape: typeof read) => shape.rows.find((r) => r.entry)!
  const unreadRow = renderToStaticMarkup(
    <CatwalkSlotRow row={held(unread)} metric="wins" state="filled" />,
  )
  const readRow = renderToStaticMarkup(
    <CatwalkSlotRow row={held(read)} metric="wins" state="filled" />,
  )

  // The sentence is a claim about the coin, so it may appear only when the read
  // actually landed and came back without a record for it.
  expect(readRow).toContain('No MIAW PRIX matches recorded this season.')
  expect(unreadRow).not.toContain('No MIAW PRIX matches recorded this season.')
  expect(unreadRow).toContain('could not be read')
  // Neither invents a 0-0: an unknown record and an empty one both render a dash.
  expect(unreadRow).not.toContain('0 W')
  expect(readRow).not.toContain('0 W')
})

test('the front of the walk says the record is unavailable rather than that nobody has walked', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 3, lineupSize: 3,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    lineup: [entry(1, 'champion', MINT_A, '$ALPHA')],
  })
  const unread = buildBoard({ board, spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'unknown', ladder: 'closed' })
  const read = buildBoard({ board, spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'read', ladder: 'closed' })

  const hero = (shape: typeof read) =>
    renderToStaticMarkup(<CatwalkHero shape={shape} season={board.season} pending={false} />)

  expect(hero(read)).toContain('NO WALKS YET')
  expect(hero(unread)).not.toContain('NO WALKS YET')
  expect(hero(unread)).toContain('RECORD UNAVAILABLE')
})

test('a failed standings read is disclosed once for the page, not implied per row', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 2, lineupSize: 2,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    lineup: [entry(1, 'champion', MINT_A, '$ALPHA')],
  })
  const unread = buildBoard({ board, spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'unknown', ladder: 'closed' })
  expect(unread.recordsKnown).toBe(false)
  // The board still renders its coins — an unreadable side-read degrades one
  // column, it does not take the board down.
  expect(unread.rows.filter((row) => row.entry)).toHaveLength(1)
})

// A failed REFRESH is not a fresh read either. Records kept from an earlier
// poll still answer for the coins they cover, but they cannot answer for a coin
// that joined the board after they were taken.
test('a stale record answers only for the coins it actually covers', () => {
  const board = parseCatwalkBoard({
    ok: true, gameKey: 'solz', activeSlots: 2, lineupSize: 2,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    lineup: [entry(1, 'champion', MINT_A, '$ALPHA'), entry(2, 'ranked', MINT_B, '$BETA')],
  })
  // The last good read covered $ALPHA. $BETA joined the board afterwards.
  const stale = standingsByMint(parseGrandPrixStandings({
    ok: true, season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    rows: [{ mint: MINT_A, symbol: '$ALPHA', name: 'Alpha', wins: 4, losses: 1, matches: 5 }],
  }).rows)

  const shape = buildBoard({ board, spots: [], outbidSpots: 0, standings: stale, standingsState: 'unknown', ladder: 'closed' })
  const alpha = shape.rows.find((row) => row.entry?.mint === MINT_A)!
  const beta = shape.rows.find((row) => row.entry?.mint === MINT_B)!

  // $ALPHA's record is old but real, so it still renders.
  expect(alpha.recordKnown).toBe(true)
  expect(alpha.standing?.wins).toBe(4)
  expect(renderToStaticMarkup(<CatwalkSlotRow row={alpha} metric="record" state="filled" />)).toContain('4–1')

  // $BETA's absence from a stale map is our ignorance, not its history.
  expect(beta.recordKnown).toBe(false)
  const betaHtml = renderToStaticMarkup(<CatwalkSlotRow row={beta} metric="record" state="filled" />)
  expect(betaHtml).not.toContain('No MIAW PRIX matches recorded this season.')
  expect(betaHtml).toContain('could not be read')
})

/* ── AN EMPTY BOARD STILL HAS A BOARD ────────────────────────────────────── */

/**
 * THE SCREEN THE OWNER REJECTED.
 *
 * SOLZ RANKED with nothing in it rendered one centred card - "NOBODY HAS
 * CLIMBED IN YET." over a large dashed box - and not one numbered position.
 * That was `tabRows` answering two different questions at once: which rows
 * BELONG to a lane, and which rows the tab DRAWS. An empty lane therefore drew
 * an empty list, and the structure of the board went with it.
 *
 * Every tab now draws the same LEFT BOARD - all thirty-six numbers, in their two
 * bands, with the walk line under the runway - and a lane's own state is said in
 * the RIGHT RAIL beside it, never instead of it and never above it. The banner
 * used to sit above the table, which put the explanation of a lane before the
 * thing it explained and pushed the board below the fold on the one tab a reader
 * lands on.
 */
test('every tab renders all 36 numbered slots on a board with no coins on it', () => {
  const empty = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  for (const tab of CATWALK_TABS) {
    const html = renderToStaticMarkup(<CatwalkPanel tab={tab} shape={empty} ladder="closed" />)
    // All 36 positions, each carrying its own number.
    for (let spot = 1; spot <= 36; spot += 1) {
      expect(html).toContain(`>${String(spot).padStart(2, '0')}<`)
    }
    // Marked open, because a read landed and they genuinely are.
    expect(html).toContain('cw-slot--open')
    expect(html).toContain('OPEN SLOT')
    // The bands of the rotation, and the line between walking in and not.
    expect(html).toContain('THE RUNWAY')
    expect(html).toContain('THE LINE-UP')
    expect(html).toContain('TOP 12 WALK IN EVERY ROTATION')
  }

  // And the lane's own sentence is still said - in the RAIL beside the table,
  // never as the whole panel.
  const ranked = renderToStaticMarkup(<CatwalkPanel tab="ranked" shape={empty} ladder="closed" />)
  expect(ranked).toContain('NOBODY HAS CLIMBED IN YET.')
  expect(ranked).toContain('cw-lane-note')
  expect(ranked).not.toContain('cw-lane-empty')
  // THIS COMPARISON IS DELIBERATELY THE OTHER WAY ROUND FROM THE ONE IT
  // REPLACES. It used to read `cw-lane-note` BEFORE `cw-slot`, pinning the
  // banner above the table. The banner is in the rail now and the rail is second
  // in the DOM, so the board comes first - which is the whole point, not an
  // accident to be re-pinned by flipping the assertion back.
  expect(ranked.indexOf('cw-split-board')).toBeLessThan(ranked.indexOf('cw-lane-note'))
  // The lane note is genuinely in the RAIL and not merely late in the board.
  expect(ranked.indexOf('cw-split-rail')).toBeLessThan(ranked.indexOf('cw-lane-note'))
})

/**
 * THE ONE PROMISE THIS SCREEN MAKES: THE LEFT BOARD IS BYTE-IDENTICAL ON EVERY
 * TAB. Switching to OUTBID or SOLZ RANKED changes the right rail and nothing
 * else - it does not re-filter the board, does not re-group it, and does not
 * repaint a single row.
 *
 * THIS REPLACES 'a lane tab marks a position held through another lane as
 * taken, never as open'. That test pinned a real decision - a lane tab must
 * never draw a held position as a vacancy - and the decision still holds; it is
 * simply satisfied A PRIORI now. With the lens gone from this panel no row is
 * drawn through a lane's eyes at all, so there is no state in which a held
 * position could be redrawn as an open one. The `cw-slot--other` row it
 * exercised is still authored and still correct (CatwalkSlotRow.tsx); it is no
 * longer reachable from CatwalkPanel, which is why it is no longer asserted
 * here rather than being asserted about a state the panel cannot produce.
 *
 * It is also STRONGER than the six per-tab assertions it stands beside: a set of
 * one is every difference at once, not the handful anybody thought to list.
 */
test('the left board is byte-identical on every tab', () => {
  const shape = launch()
  const slices = CATWALK_TABS.map((id) => splitBoard(renderToStaticMarkup(
    <CatwalkPanel tab={id} shape={shape} ladder="open" onClaim={() => undefined} />,
  )))
  // Every tab produced the same left column, character for character.
  expect(new Set(slices).size).toBe(1)
  // AND THE SLICE IS REALLY THE BOARD. `splitBoard` returns the WHOLE panel when
  // `cw-split-board` is missing, and four identical whole panels would also be a
  // set of one - so the count is what makes the assertion above fail loudly
  // rather than silently if the class names or the DOM order ever move. A
  // whole-panel slice breaks it, because the rail adds rows of its own.
  expect(slices[0]!.match(/class="cw-slot/g)).toHaveLength(36)
  // No row is drawn through a lane's eyes any more, on any tab.
  for (const slice of slices) expect(slice).not.toContain('cw-slot--other')
  for (const slice of slices) expect(slice).not.toContain('>TAKEN<')
})

/**
 * AND IT IS STILL BYTE-IDENTICAL WHILE A SEARCH IS RUNNING.
 *
 * The test above renders with the DEFAULT dim/match predicates, which are
 * `() => false`, so it could never see the last thing that made the left column
 * tab-dependent. CatwalkApp derived that layer from `tabRows(tab, ...)`: a query
 * matching a coin outside the open tab's lane emptied the hit set, and an empty
 * hit set dims EVERY row and outlines none. Typing `foofix` (P01, CHAMPION lane)
 * and clicking SOLZ RANKED therefore faded all thirty-six positions to .22
 * (catwalk.css `.cw-slot[data-dim='true']`) and dropped the match outline - the
 * board re-rendering on a tab click, on the tab whose whole promise is that it
 * does not.
 *
 * The layer is a fact about the BOARD now, so this renders it the way CatwalkApp
 * does and demands the same one column back.
 */
test('the left board is byte-identical on every tab WHILE A SEARCH IS RUNNING', () => {
  const shape = launch()
  const query = parseCatwalkQuery('foofix')
  // Exactly what CatwalkApp hands CatwalkPanel - rows and a query, no tab.
  const { dimmed, matched } = boardSearchLayer(shape.rows, query)
  const slices = CATWALK_TABS.map((id) => splitBoard(renderToStaticMarkup(
    <CatwalkPanel
      tab={id} shape={shape} ladder="open" dimmed={dimmed} matched={matched}
      onClaim={() => undefined}
    />,
  )))
  expect(new Set(slices).size).toBe(1)
  // AND THE LAYER IS GENUINELY ON, so the set of one above is not four boards
  // that simply never dimmed anything. $FOOFIX stands at P01; the other 35 fade.
  expect(slices[0]!.match(/data-dim="true"/g)).toHaveLength(35)
  expect(slices[0]!.match(/data-matched="true"/g)).toHaveLength(1)

  // THE REGRESSION ITSELF, stated as the thing that used to reach the board: a
  // layer built from ONE LANE'S rows blacks the whole board out and lights
  // nothing, because the coin it is looking for is standing in another lane.
  const laneLayer = boardSearchLayer(tabRows('ranked', shape.rows), query)
  expect(shape.rows.filter(laneLayer.dimmed)).toHaveLength(36)
  expect(shape.rows.filter(laneLayer.matched)).toHaveLength(0)

  // A BARE SLOT QUERY did the same through `matched` alone - it dims nothing
  // (a jump to a number is not a reason to grey the board) but it must still
  // light P01 on every tab, not only on the tab that owns P01's lane.
  const slot = boardSearchLayer(shape.rows, parseCatwalkQuery('1'))
  expect(shape.rows.filter(slot.matched).map((row) => row.spot)).toEqual([1])
  expect(shape.rows.filter(slot.dimmed)).toHaveLength(0)
})

test('a tab changes the rail and only the rail', () => {
  const shape = launch()
  const panel = (id: (typeof CATWALK_TABS)[number]) => renderToStaticMarkup(
    <CatwalkPanel tab={id} shape={shape} ladder="open" onClaim={() => undefined} />,
  )
  const rail = (html: string) => html.slice(html.indexOf('cw-split-rail'))
  // The rails genuinely differ - otherwise the test above would pass over a
  // screen where clicking a tab did nothing at all.
  expect(new Set(CATWALK_TABS.map((id) => rail(panel(id)))).size).toBe(CATWALK_TABS.length)
  // MIAW PRIX gets the composition legend; OUTBID keeps the price list.
  expect(rail(panel('catwalk'))).toContain('cw-legend')
  expect(rail(panel('outbid'))).toContain('ON THE BOARD')
  expect(rail(panel('outbid'))).toContain('OUTBID $1,900')
  // And the rail is the landmark that names itself per tab, never 'Take a slot'
  // over a lane that sells nothing.
  expect(panel('ranked')).toContain('aria-label="What the SOLZ ranked lane is"')
  expect(panel('outbid')).toContain('aria-label="Take a slot"')
})

test('the OUTBID tab shows the ladder AND the table, in every ladder state', () => {
  const shape = launch()
  const open = renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={shape} ladder="open" onClaim={() => undefined} />)
  expect(open).toContain('SPOT LADDER')
  expect(open.match(/class="cw-slot/g)!.length).toBeGreaterThan(36)

  // A ladder that could not be read says so, and the table is untouched by it.
  const unread = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'unknown' })
  const html = renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={unread} ladder="unknown" />)
  expect(html).toContain('THE SPOT LADDER COULD NOT BE READ.')
  expect(html).not.toContain('CLOSED BETWEEN SEASONS')
  // The whole numbered table, plus the outbid list's own twelve walk-in
  // positions. The list is never empty because the walk-in band is never empty:
  // a board with no coins on it is twelve openings, not nothing.
  expect(html.match(/class="cw-slot/g)).toHaveLength(48)
})

/* ── colour follows the lane, never the position ─────────────────────────── */

test('a row is tinted by its lane and never by where it stands', () => {
  const shape = launch()
  const html = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" />)
  // No position tier survives anywhere in the markup or the class names.
  expect(html).not.toContain('data-tier')
  for (const tier of ['podium', 'backrow', 'reserve']) expect(html).not.toContain(tier)
  // Each held row carries its LANE, which is what the palette keys off.
  expect(html).toContain('data-lane="champion"')
  expect(html).toContain('data-lane="outbid"')
  // And the bands carry no lane at all, because a band is a position.
  expect(html).toContain('<div class="cw-band">')
})

/* ── coin identity: crest, symbol link, contract address ─────────────────── */

test('a held row carries its symbol as a link, and its contract address to copy and open', () => {
  const shape = launch()
  const row = shape.rows.find((slot) => slot.spot === 4)!
  const html = renderToStaticMarkup(
    <CatwalkSlotRow
      row={row}
      metric="take"
      state="filled"
      ladder="open"
      coinHref={(mint) => `/catwalk?q=${mint}`}
      explorer={{ family: 'SOLANA', explorerUrl: 'https://explorer.solana.com' }}
    />,
  )
  // The symbol links to the coin's own section.
  expect(html).toContain(`href="/catwalk?q=${MINT_B}"`)
  expect(html).toContain('cw-symbol')
  // The address is copyable, and the copy carries the FULL mint rather than the
  // head-and-tail form on screen - what is pasted must be what the board was
  // given, because a truncated contract address costs somebody real money.
  expect(html).toContain(`Copy contract address ${MINT_B}`)
  expect(html).toContain('cw-mint')
  // And it links out to the explorer, built through the repo's own cluster
  // helper rather than a hand-rolled URL.
  expect(html).toContain(`https://explorer.solana.com/address/${MINT_B}`)
})

test('no explorer link is drawn when the board names no chain to build one against', () => {
  const shape = launch()
  const row = shape.rows.find((slot) => slot.spot === 4)!
  const html = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" explorer={null} />)
  // Copy still works - a verbatim mint on the clipboard cannot send anybody to
  // the wrong chain. A link to the wrong cluster resolves to "account not
  // found", which a reader takes as a statement about the coin.
  expect(html).toContain('cw-mint')
  expect(html).not.toContain('cw-ca-link')
  expect(html).not.toContain('/address/')

  // A devnet board carries its cluster into the link rather than dropping it.
  const devnet = renderToStaticMarkup(
    <CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" explorer={{ family: 'SOLANA', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', explorerUrl: 'https://explorer.solana.com' }} />,
  )
  expect(devnet).toContain('?cluster=devnet')
})

/* ── market cap is a column, and unknown is never zero ───────────────────── */

test('market cap renders as a column, compacted, and unknown renders as a dash', () => {
  const shape = buildBoard({
    board: parseCatwalkBoard({
      ok: true, gameKey: 'solz', activeSlots: 12, lineupSize: 36, season: null,
      lineup: [
        { spot: 1, mint: MINT_A, lane: 'ranked', active: true, team: { mint: MINT_A, symbol: '$FOOFIX', name: 'Foofix', marketCapUsd: 4_200_000 } },
        { spot: 2, mint: MINT_B, lane: 'ranked', active: true, team: { mint: MINT_B, symbol: '$BARFIX', name: 'Barfix' } },
      ],
    }),
    spots: [], standings: new Map(), ladder: 'closed',
  })
  const priced = shape.rows[0]!
  const unpriced = shape.rows[1]!
  expect(priced.entry!.marketCapUsd).toBe(4_200_000)
  // Absent is null, so it can never be confused with a coin worth nothing.
  expect(unpriced.entry!.marketCapUsd).toBeNull()

  expect(renderToStaticMarkup(<CatwalkSlotRow row={priced} metric="record" state="filled" />)).toContain('$4.2M')
  const dash = renderToStaticMarkup(<CatwalkSlotRow row={unpriced} metric="record" state="filled" />)
  expect(dash).toContain('MKT CAP')
  expect(dash).toContain('No market cap published for this coin.')
  expect(dash).not.toContain('$0')
})

/* ── the middle dot is not a layout tool ─────────────────────────────────── */

/**
 * The page was leaning on U+00B7 in nine separate places - the kicker, the
 * front-of-walk record, two band notes, the row's seat action, the footer's
 * second figure and the count line's two. Every one of
 * them was a column gap, a rule or a second line doing its job badly.
 */
test('no rendered surface strings its figures together on middle dots', () => {
  const shape = launch()
  const season = { seasonId: 'solz-07', seasonIndex: 7, startsAt: 0, endsAt: Date.now() + 86_400_000 }
  const surfaces = [
    renderToStaticMarkup(<CatwalkHero shape={shape} season={season} now={Date.now()} />),
    renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" onClaim={() => undefined} />),
    renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={shape} ladder="open" onClaim={() => undefined} />),
    renderToStaticMarkup(<CatwalkFooter pending={false} openCount={34} shape={shape} ladder="open" />),
    renderToStaticMarkup(<CatwalkApp />),
  ]
  for (const html of surfaces) expect(html).not.toContain('·')
})

/**
 * A HOLDER IS A PRICE AND WHOEVER STANDS THERE. NOTHING ELSE.
 *
 * This test replaces "a seeded holder renders as a paid holder, and the seeded
 * flag still survives the read". The second half of that title is gone on
 * purpose, and so is the assertion behind it: `/api/v1/catwalk` has dropped
 * `seeded`, `wallet` and `paidAt`, and nothing public consumed them. The
 * comments in this repo claimed the flag was carried "for the operator
 * surface" at :3101 - that claim was false. The admin panel reads
 * store.ladder() through catwalkPanelSnapshot and never touches this endpoint.
 * A test pinning a field alive on a reason that does not exist would have kept
 * it alive through the next reader, so it is deleted rather than relaxed.
 *
 * What is pinned instead is the only property that matters while the two repos
 * land at different times: the board is BYTE-IDENTICAL whether the payload
 * still carries the dropped fields or not, and a buyer's wallet never reaches
 * the page even when a stale server keeps sending it.
 */
test('the board is identical whether or not the payload still carries the dropped fields', () => {
  const build = (lineup: unknown[]) => buildBoard({
    board: board(lineup),
    spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'read', ladder: 'closed',
  })
  // Same two coins, same two amounts. The only difference between the payloads
  // is the three fields, so "renders the same" is a comparison and not a pair
  // of assertions that could drift apart.
  const dropped = build([
    entry(1, 'outbid', MINT_A, '$FOOFIX', '$FOOFIX', 2_000_000),
    entry(2, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 2_000_000),
  ])
  const legacy = build([
    legacyEntry(1, 'outbid', MINT_A, '$FOOFIX', 2_000_000),
    legacyEntry(2, 'outbid', MINT_B, '$BARFIX', 2_000_000),
  ])

  // The parsed rows are the same object, field for field - which is also how
  // this test would catch `seeded` being threaded back in on either path.
  expect(dropped.rows.map((row) => row.entry)).toEqual(legacy.rows.map((row) => row.entry))

  const surfaces = (shape: typeof dropped) => [
    ...shape.rows.filter((row) => row.entry).map((row) =>
      renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />)),
    renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" onClaim={() => undefined} />),
    renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={shape} ladder="open" onClaim={() => undefined} />),
  ]
  const droppedHtml = surfaces(dropped)
  const legacyHtml = surfaces(legacy)
  expect(droppedHtml).toEqual(legacyHtml)

  // Both rows still say what the holder paid, and say it the same way.
  expect(droppedHtml[0]!.match(/PAID [^<]*/)?.[0]).toBe('PAID $2')
  expect(legacyHtml[0]!.match(/PAID [^<]*/)?.[0]).toBe('PAID $2')

  for (const html of [...droppedHtml, ...legacyHtml]) {
    // A buyer's address never reaches the page, even from a server still sending it.
    expect(html).not.toContain('BuyerWa11etAddress')
    // And the placeholder-versus-payment vocabulary is gone from the board entirely.
    expect(html).not.toContain('SEEDED')
    expect(html).not.toContain('not paid for')
    expect(html).not.toContain('No payment was made')
  }
})

/**
 * A COIN WITH NO CACHED IDENTITY IS DRAWN AS ITS SHORT ADDRESS.
 *
 * `team` is null whenever nothing has cached a symbol for this mint yet. The
 * name plate used to print an em dash there, which drew a seat somebody is
 * standing on as a blank cell; inventing a ticker from the mint would be worse
 * still. The contract address is the one thing always known about the coin, so
 * the row prints it short, and speaks the same string it prints.
 */
test('a holder with no cached team renders as its short address, not a blank and not an invented symbol', () => {
  const shape = buildBoard({
    board: board([{ spot: 1, mint: MINT_A, lane: 'outbid' as CatwalkLane, active: true, team: null, bid: { usdMicros: 2_000_000 } }]),
    spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'read', ladder: 'closed',
  })
  const row = shape.rows.find((candidate) => candidate.entry?.mint === MINT_A)!
  expect(row.entry!.team).toBeNull()

  const short = `${MINT_A.slice(0, 4)}\u2026${MINT_A.slice(-4)}`
  const html = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />)
  const plate = html.match(/class="cw-symbol"[^>]*>([^<]*)</)?.[1]
  expect(plate).toBe(short)
  // Not a blank cell, and not the em dash that used to stand in for the name.
  expect(plate).not.toBe('')
  expect(plate).not.toBe('\u2014')

  // The accessible name says the same thing the row prints - never the full
  // 44-character address, and never an empty gap where the coin should be.
  const spoken = html.match(/aria-label="Slot 1, [^"]*"/)?.[0] ?? ''
  expect(spoken).toContain(short)
  expect(spoken).not.toContain(MINT_A)

  // The same row rendered in the "held in another lane" state keeps identity too.
  const other = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="other" ladder="open" />)
  expect(other).toContain(short)
})

/* ── the OUTBID tab is a list of COINS ───────────────────────────────────── */

/**
 * The tab a holder opens to ask "who is standing up there, and what would it
 * cost to take it from them" used to answer with the spot ladder and nothing
 * else - so with the sale shut it published a handful of unnamed "Configured
 * seat / BIDDING CLOSED" strips and named not one coin. The field is on the
 * board in every ladder state; only the prices come and go.
 */
test('the OUTBID list names every coin IN ITS OWN LANE, in every ladder state', () => {
  const lineup = [
    entry(1, 'champion', MINT_A, '$FOOFIX'),
    entry(4, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000),
  ]

  const open = buildOutbidList(
    buildBoard({ board: board(lineup), spots: ladder(3, { 1: MINT_B }), standings: new Map(), ladder: 'open' }),
    'open',
  )
  // THIS TAB IS ONE LANE. Every runway position the outbid lane holds or could
  // still fill, then the seats nobody is standing on. A coin that CLIMBED in is
  // not here: no price takes it, and listing it on the page whose whole subject
  // is what is for sale only ever produced a row marked NOT FOR SALE. The merged
  // field is the MIAW PRIX tab.
  expect(open.filter((row) => row.mint).map((row) => row.symbol)).toEqual(['$BARFIX'])
  expect(open.some((row) => row.symbol === '$FOOFIX')).toBe(false)
  // The champion's position is not offered as an opening either - somebody is
  // standing in it.
  expect(open.filter((row) => row.spot !== null).map((row) => row.spot)).toEqual(
    [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  )
  expect(open.filter((row) => row.spot === null)).toHaveLength(2)
  // A VACANCY CARRIES NO PRICE at any number: it is a position, and positions
  // are not sold.
  const vacancies = open.filter((row) => row.status === 'open')
  expect(vacancies).toHaveLength(10)
  expect(vacancies.every((row) => row.seat === null)).toBe(true)
  // The outbid holder is priced from the seat its own MINT holds.
  const bought = open.find((row) => row.symbol === '$BARFIX')!
  expect(bought.status).toBe('takeable')
  expect(bought.seat!.askUsdMicros).toBe(1_900_000_000)
  expect(takeableCount(open)).toBe(3)

  // SHUT. The coins are still there; the prices are not, and no coin is
  // reported as something a reader could buy.
  const shut = buildOutbidList(
    buildBoard({ board: board(lineup), spots: ladder(3), standings: new Map(), ladder: 'closed' }),
    'closed',
  )
  expect(shut.filter((row) => row.mint).map((row) => row.symbol)).toEqual(['$BARFIX'])
  expect(shut.find((row) => row.symbol === '$BARFIX')!.status).toBe('closed')
  // A shut ladder publishes no seats at all, so nothing here is priced and
  // nothing is offered - but the lane's positions are still listed.
  expect(shut.filter((row) => row.spot !== null)).toHaveLength(11)
  expect(shut.every((row) => row.seat === null)).toBe(true)
  expect(takeableCount(shut)).toBe(0)

  // UNREADABLE is not shut. It says so in its own word, so a 502 from the proxy
  // never announces a closed sale.
  const unread = buildOutbidList(
    buildBoard({ board: board(lineup), spots: [], standings: new Map(), ladder: 'unknown' }),
    'unknown',
  )
  expect(unread.some((row) => row.symbol === '$FOOFIX')).toBe(false)
  expect(unread.find((row) => row.symbol === '$BARFIX')!.status).toBe('unknown')
})

test('a closed OUTBID tab renders the coins rather than anonymous configured seats', () => {
  const shape = buildBoard({
    board: board([entry(1, 'champion', MINT_A, '$FOOFIX'), entry(4, 'outbid', MINT_B, '$BARFIX')]),
    spots: [],
    standings: new Map(),
    ladder: 'closed',
  })
  const html = renderToStaticMarkup(
    <CatwalkPanel tab="outbid" shape={shape} ladder="closed" configuredSeats={3} closedReason="program_disabled" />,
  )
  // The sale's state is stated once, above a list that names the field.
  expect(html).toContain('OUTBID IS NOT ENABLED YET.')
  expect(html).toContain('$BARFIX')
  expect(html).toContain('BIDDING CLOSED')
  // The strips that named nobody are gone, and the list quotes no figure: a
  // closed ladder publishes no seats, so there is no ask to print.
  expect(html).not.toContain('cw-closed-seat')
  expect(html).not.toContain('Configured seat')
  // THE SLICE RUNS THE OTHER WAY NOW, AND THAT IS NOT COSMETIC. The list used to
  // lead this tab and the board followed, so the slice ran list -> board. The
  // list is the RAIL now and the rail is second, so a slice left as it was would
  // return an empty string and turn this assertion into a silent pass.
  const list = html.slice(html.indexOf('cw-split-rail'))
  expect(list.length).toBeGreaterThan(0)
  expect(list).not.toMatch(/\$[\d,]+/)
  // The whole numbered table still renders beside the list.
  expect(splitBoard(html).match(/class="cw-slot/g)).toHaveLength(36)
  expect(html.match(/class="cw-slot/g)!.length).toBeGreaterThan(36)
})

test('the OUTBID list prices a coin only from the seat its own mint holds', () => {
  const shape = buildBoard({
    // $BARFIX stands at board position 4 and holds LADDER SEAT 1. $FOOFIX is a
    // ranked coin at position 2 - the number of a seat that is genuinely on
    // sale, and emphatically not its price.
    board: board([entry(2, 'ranked', MINT_A, '$FOOFIX'), entry(4, 'outbid', MINT_B, '$BARFIX')]),
    spots: ladder(3, { 1: MINT_B }),
    standings: new Map(),
    ladder: 'open',
  })
  const rows = buildOutbidList(shape, 'open')
  const bought = rows.find((row) => row.symbol === '$BARFIX')!
  // A coin that CLIMBED in is not on this tab at all - no price takes it, and a
  // row nobody can act on is not a listing.
  expect(rows.some((row) => row.symbol === '$FOOFIX')).toBe(false)
  // The outbid holder is priced from the seat its own MINT holds, never from the
  // ladder seat that happens to share its board number.
  expect(bought.seat!.seat).toBe(1)

  const html = renderToStaticMarkup(
    <CatwalkOutbidList rows={rows} note="TEST" onClaim={() => undefined} />,
  )
  expect(html).toContain('OUTBID $1,900')
  // The two seats nobody stands on keep their own list, under the sale's own name.
  expect(html).toContain('SPOT LADDER')
  expect(html).toContain('2 OPEN SEATS')
})

/* ── the lane legend is the rows themselves ──────────────────────────────── */

/**
 * A COLOUR = HOW IT GOT HERE strip used to stand above the list, naming the
 * four lanes and counting each one. It is gone: every row already wears its
 * lane's colour AND spells its lane out in a chip, so the legend restated the
 * next thing on screen. What must survive is the thing the legend existed to
 * teach - that the colour is the LANE and never the position.
 */
test('every lane names itself on the rows, with no separate legend to drift', () => {
  const shape = launch()
  const panel = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" />)
  const html = splitBoard(panel)
  for (const lane of ['champion', 'outbid', 'open']) expect(html).toContain(`data-lane="${lane}"`)
  // The chip spells the lane out beside the colour, so the colour is never the
  // only carrier of the distinction.
  expect(html).toContain('>CHAMP</span>')
  expect(html).toContain('>OUTBID</span>')
  // And the legend itself is not rebuilt anywhere.
  expect(panel).not.toContain('cw-key')
  expect(panel).not.toContain('COLOUR')
})

/* ── the runway is coloured even when it is empty ────────────────────────── */

/**
 * The twelve that walk every rotation are what this page is about, and on the
 * state it launches in - nobody on the board - they were drawn in exactly the
 * grey the twenty-four line-up vacancies were drawn in. The band carries its
 * own mark now, on the head and on every vacancy inside it, and the line-up
 * deliberately does not.
 */
test('the runway marks itself, empty or not, and the line-up does not', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const panel = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="closed" />)
  const html = splitBoard(panel)

  // The head of the runway says so; the line-up's head carries nothing.
  expect(html).toContain('<h3 class="cw-band-head" data-walks="true"')
  expect(html.match(/class="cw-band-head" data-walks="true"/g)).toHaveLength(1)
  // Two band heads now, not three: the line-up is one band of twenty-four.
  expect(html.match(/class="cw-band-head"/g)).toHaveLength(2)
  // Twelve vacancies carry the runway mark, twenty-four do not. It is
  // `data-walks`, which the rows have always carried - NOT a lane, because a
  // vacancy stands in no lane and a band is not one either.
  expect(html.match(/data-walks="true"/g)).toHaveLength(13)
  expect(html.match(/data-walks="false"/g)).toHaveLength(24)
  expect(panel).not.toContain('data-lane="walkin"')
})

/* ── a coin is its contract address, in full where there is room ─────────── */

test('a held row carries the whole mint, with the short form kept for narrow columns', () => {
  const shape = launch()
  const row = shape.rows.find((slot) => slot.spot === 4)!
  const html = renderToStaticMarkup(<CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />)
  // The full address is in the markup, verbatim, not head-and-tail.
  expect(html).toContain(`<code class="cw-mint-full" aria-hidden="true">${MINT_B}</code>`)
  // And the abbreviated form is there for the columns that cannot hold it.
  expect(html).toContain('cw-mint-short')
  // Both are hidden from assistive technology: the button's own label already
  // carries the whole mint, and reading it three times is not more accessible.
  expect(html).toContain(`aria-label="Copy contract address ${MINT_B}"`)
  expect(html.match(/<code class="cw-mint-(full|short)" aria-hidden="true">/g)).toHaveLength(2)
})

/* ── a crest that will not load is a missing picture, not a missing coin ─── */

test('a logo url that fails falls back to the built-in mark rather than a broken image', () => {
  // The upstream board publishes root-relative logo paths (`/solz_logo.svg`)
  // that resolve against THIS origin and 404, so the row rendered the browser's
  // broken-image glyph where a coin's crest belongs.
  const html = renderToStaticMarkup(<TeamMark id="team-solz" logoUrl="/nope.svg" />)
  // The img is still what renders first - a logo that DOES load must not be
  // replaced by a guess - and it carries the handler that swaps it out.
  expect(html).toContain('sh-team-mark--logo')
  // With no logo at all, the mark renders directly and there is no img.
  const fallback = renderToStaticMarkup(<TeamMark id="team-solz" />)
  expect(fallback).toContain('<svg')
  expect(fallback).not.toContain('<img')
})

/* ── identity the board did not carry, read from the token registry ──────── */

/**
 * The game API names its coins by mint and publishes whatever its own registry
 * recorded beside them - for a freshly listed coin that is the ticker twice
 * over (`symbol: "SOLZ", name: "SOLZ"`) and `/solz_logo.svg`, a ROOT-RELATIVE
 * path that resolves against this origin and 404s. The mints are mainnet, so
 * both are knowable; the overlay fills them in and nothing else.
 */
test('the token overlay fills in a missing name and an unresolvable logo, and never a ticker', () => {
  const meta = new Map([
    [MINT_A, { mint: MINT_A, name: 'Solana Zero Fun', symbol: 'SOLZ-REGISTRY', icon: 'https://cdn.test/solz.png' }],
    [MINT_B, { mint: MINT_B, name: 'Barfix Coin', symbol: 'BAR', icon: 'https://cdn.test/bar.png' }],
  ])
  const source = board([
    // Names itself with its own ticker and points at a path this origin 404s.
    { spot: 1, mint: MINT_A, lane: 'ranked', active: true, team: { mint: MINT_A, symbol: '$FOOFIX', name: '$FOOFIX', logoUrl: '/solz_logo.svg' } },
    // Already fully described, by an absolute URL the browser can fetch.
    { spot: 2, mint: MINT_B, lane: 'ranked', active: true, team: { mint: MINT_B, symbol: '$BARFIX', name: 'Barfix, As The Board Has It', logoUrl: 'https://cdn.test/board.png' } },
  ])
  const merged = overlayTokenMeta(source, meta)!

  const first = merged.lineup[0]!.team!
  // The name it did not have, and the logo that would not have loaded.
  expect(first.name).toBe('Solana Zero Fun')
  expect(first.logoUrl).toBe('https://cdn.test/solz.png')
  // THE TICKER IS NEVER TOUCHED. On this site a coin's ticker is what the game
  // says it is, and the registry disagreeing is not a reason to rename a row.
  expect(first.symbol).toBe('$FOOFIX')

  const second = merged.lineup[1]!.team!
  // The board described this one itself, so the overlay leaves it alone.
  expect(second.name).toBe('Barfix, As The Board Has It')
  expect(second.logoUrl).toBe('https://cdn.test/board.png')

  // A registry that answered nothing returns the SAME board, so a poll that
  // learns nothing does not re-render every row.
  expect(overlayTokenMeta(source, new Map())).toBe(source)
  expect(overlayTokenMeta(null, meta)).toBeNull()
})

test('only a logo this origin can actually fetch counts as one the board published', () => {
  expect(logoResolvesHere('https://cdn.test/a.png')).toBe(true)
  expect(logoResolvesHere('data:image/svg+xml,<svg/>')).toBe(true)
  // The failing case, and the reason the overlay exists.
  expect(logoResolvesHere('/solz_logo.svg')).toBe(false)
  expect(logoResolvesHere('')).toBe(false)
  expect(logoResolvesHere(undefined)).toBe(false)
})

test('the registry wire shape is parsed in one place, and a bad row is dropped', () => {
  const parsed = parseTokenMeta({
    ok: true,
    tokens: [
      { mint: MINT_A, name: 'Solana Zero Fun', symbol: 'SOLZ', icon: 'https://cdn.test/a.png' },
      { name: 'No mint, no row' },
      null,
      'nonsense',
    ],
  })
  expect(parsed.size).toBe(1)
  expect(parsed.get(MINT_A)!.name).toBe('Solana Zero Fun')
  // A reply that is not the shape this site asked for is an empty map, never a throw.
  expect(parseTokenMeta({ ok: false }).size).toBe(0)
  expect(parseTokenMeta(null).size).toBe(0)
})

/* ── the outbid list is on the tab a reader actually lands on ────────────── */

test('the MIAW PRIX tab shows the board AND how the list is composed, board first', () => {
  const shape = launch()
  const html = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" onClaim={() => undefined} />)
  // Both halves are there...
  expect(html).toContain('cw-split-board')
  expect(html).toContain('cw-split-rail')
  // ...the board is first in the DOM, so keyboard order reaches the numbered
  // table before whatever is explaining it...
  expect(html.indexOf('cw-split-board')).toBeLessThan(html.indexOf('cw-split-rail'))
  // ...the table is whole...
  expect(splitBoard(html).match(/class="cw-slot/g)).toHaveLength(36)
  // ...and the rail EXPLAINS the list rather than pricing it. The price rail
  // used to stand here; it is the OUTBID tab's now, because "what is this list
  // made of" is the question the tab named after the programme is opened with.
  const rail = html.slice(html.indexOf('cw-split-rail'))
  expect(rail).not.toContain('ON THE BOARD</span>')
  expect(rail).not.toContain('OUTBID $1,900')
  // The three lanes name themselves, each beside a swatch that takes its colour
  // from `data-lane` - the same attribute the rows, the band heads and the tabs
  // resolve `--cw-hue` through, so the legend can never drift from the palette
  // and no hex value is restated in a second place.
  for (const lane of ['outbid', 'champion', 'ranked']) {
    expect(rail).toContain(`<span class="cw-legend-swatch" data-lane="${lane}"`)
  }
  expect(rail).toContain('SOLZ RANKED')
  expect(rail).toContain('CHAMPIONS')
  // THE LANE IS NAMED ONCE IN THE SECTION THAT NAMES IT. A `LaneChip` spells its
  // own lane out, so a chip beside the heading printed OUTBID twice in a row -
  // one fact stated twice, which at a glance reads as two. The chip is still the
  // right element further down, in the seat rows, where it IS the label.
  const lanes = rail.slice(rail.indexOf('cw-legend-lanes'), rail.indexOf('cw-legend-bands'))
  expect(lanes.length).toBeGreaterThan(0)
  expect(lanes.match(/>OUTBID</g)).toHaveLength(1)
  expect(lanes).not.toContain('class="cw-lane"')
  // The bands are printed from the board's own shape, labels and ranges and all.
  expect(rail).toContain('THE RUNWAY')
  expect(rail).toContain('THE LINE-UP')
  expect(rail).toContain('01–12')
  expect(rail).toContain('13–36')
})

/**
 * THE GUARANTEE IS QUOTED ONLY IF IT ARRIVED.
 *
 * Four runway seats and twelve line-up seats are BACKEND settings. The panel
 * holds neither, exactly as it holds no price, so a server that has not shipped
 * the `seats` field yet degrades to a legend that explains the bands without
 * quoting a figure - a smaller panel, not a wrong one. The failure this pins is
 * the tempting one: hardcoding 4 and 12 to make a screenshot look finished.
 */
test('the composition rail states a seat guarantee only when the wire carried one', () => {
  const shape = launch()
  const without = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" />)
  expect(without).not.toContain('GUARANTEED')
  // And emphatically not as a zero, which is a stated guarantee of nothing.
  expect(without).not.toContain('GUARANTEED 0')

  const withPlan = renderToStaticMarkup(
    <CatwalkPanel
      tab="catwalk"
      shape={shape}
      ladder="open"
      seats={{ runway: { outbid: 4, champion: 3, ranked: 5 }, lineup: { outbid: 12, champion: 0, ranked: 12 } }}
    />,
  )
  const rail = withPlan.slice(withPlan.indexOf('cw-split-rail'))
  expect(rail).toContain('GUARANTEED 4')
  expect(rail).toContain('GUARANTEED 12')
  expect(rail).toContain('GUARANTEED 3')
  // A guarantee of nothing is a real setting and is printed as one, because the
  // server said it. That is not the same as printing 0 because nobody answered.
  expect(rail).toContain('GUARANTEED 0')
})

/**
 * A RAIL THAT PRINTS "0 RANKED" DURING A 502 IS THE BUG THIS PAGE IS BUILT TO
 * PREVENT. While the board is pending the rail draws its structure - the lanes,
 * the bands, their ranges - and states not one count, not one guarantee and not
 * one verdict.
 */
test('the composition rail states no figure while the board is pending', () => {
  const shape = buildBoard({ board: null, spots: [], standings: new Map(), ladder: 'unknown' })
  const html = renderToStaticMarkup(<CatwalkComposition shape={shape} pending />)
  // The structure known without the network is drawn.
  expect(html).toContain('THE RUNWAY')
  expect(html).toContain('THE LINE-UP')
  expect(html).toContain('01–12')
  // Nothing that depends on a read is.
  expect(html).not.toContain('GUARANTEED')
  expect(html).not.toContain('STANDING')
  expect(html).not.toContain('ON THE BOARD')
  expect(html).not.toContain('BOARD LOCKS IN')
  expect(html).not.toMatch(/>\s*0\s*</)

  // THE LOCK IS NOT THIS RAIL'S ANY MORE, in any state. It used to carry a
  // second face of the same instant, last in the column, and the assertions
  // below are what is left of that: the composition rail states no schedule, no
  // timer region and no live region, whatever it is handed.
  const read = renderToStaticMarkup(<CatwalkComposition shape={shape} />)
  expect(read).not.toContain('BOARD LOCKS IN')
  expect(read).not.toContain('NO ROTATION IS SCHEDULED YET')
  expect(read).not.toContain('THE SCHEDULE COULD NOT BE READ')
  expect(read).not.toContain('role="timer"')
  expect(read).not.toContain('aria-live')

  // A read that FAILED still says exactly that - in the ONE clock the page has,
  // which is the head of the rail on every tab.
  const unreadable = renderToStaticMarkup(<CatwalkClock lock={{ state: 'unreadable' }} />)
  expect(unreadable).toContain('THE SCHEDULE COULD NOT BE READ')
  expect(unreadable).not.toContain('NO ROTATION IS SCHEDULED YET')
})

/**
 * THE LOCK IS A PAGE FACT, NOT A TAB FACT.
 *
 * It lived at the BOTTOM of the MIAW PRIX rail and nowhere else, so on three of
 * the four tabs the page could not answer "when does it lock" at all, and on the
 * fourth the answer was below the fold. It is the FIRST thing in the rail now,
 * on every tab and in the two frames the page is in most often - the first paint
 * and a search that missed.
 */
test('the lock countdown heads the rail on every tab, and in every frame', () => {
  const shape = launch()
  const lock = { state: 'counting' as const, locksAt: Date.now() + 7 * 3_600_000, startsAt: Date.now() + 19 * 3_600_000 }
  for (const id of CATWALK_TABS) {
    const html = renderToStaticMarkup(
      <CatwalkPanel tab={id} shape={shape} ladder="open" onClaim={() => undefined} lock={lock} now={Date.now()} />,
    )
    const rail = html.slice(html.indexOf('cw-split-rail'))
    expect(rail).toContain('BOARD LOCKS IN')
    // AND IT IS THE FIRST THING IN THE COLUMN, not the last thing on one tab.
    expect(rail.indexOf('cw-clock')).toBeLessThan(rail.indexOf('cw-legend') === -1 ? rail.length : rail.indexOf('cw-legend'))
    // Exactly one clock on the page: promoting one face without deleting the
    // other is what would put two countdowns of one instant on the screen.
    expect(html.match(/BOARD LOCKS IN/g)).toHaveLength(1)
    expect(html.match(/role="timer"/g)).toHaveLength(1)
  }

  // The whole app, on its first paint and while a search misses: the clock is
  // still there, and under 'unread' it states nothing rather than a dash.
  const app = renderToStaticMarkup(<CatwalkApp />)
  expect(app).toContain('cw-clock--pending')
  expect(app).not.toContain('BOARD LOCKS IN')
  expect(app).not.toContain('THE SCHEDULE COULD NOT BE READ')
})

/**
 * MUST-3: THE MIAW PRIX RAIL MAY NOT PROMISE A LANE THE SALE HAS CLOSED.
 *
 * It asserted OUTBID "is the one lane anybody can enter today" with no knowledge
 * of the ladder, so with bidding shut this rail said the lane was enterable
 * while the OUTBID tab one click away said OUTBID IS NOT ENABLED YET.
 */
test('the composition rail qualifies the outbid lane by what the ladder answered', () => {
  const shape = launch()
  const rail = (ladder: 'open' | 'closed' | 'unknown') =>
    renderToStaticMarkup(<CatwalkComposition shape={shape} ladder={ladder} />)

  expect(rail('open')).toContain('the one lane anybody can enter today')
  // A sale that ANSWERED that it is shut.
  expect(rail('closed')).toContain('bidding is closed right now')
  expect(rail('closed')).not.toContain('anybody can enter today')
  // Nobody answered, so no verdict about the sale is stated either way.
  expect(rail('unknown')).toContain('could not be read')
  expect(rail('unknown')).not.toContain('anybody can enter today')
  expect(rail('unknown')).not.toContain('bidding is closed')

  // SHOULD-5: LADDER FLOOR printed the same em dash for "the sale said closed"
  // and "nobody answered", in a file whose own dash means "nobody has read it".
  // A board with no floor to quote is where the two were indistinguishable.
  const bare = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const floor = (ladder: 'open' | 'closed' | 'unknown') => {
    const html = renderToStaticMarkup(<CatwalkComposition shape={bare} ladder={ladder} />)
    return html.slice(html.indexOf('LADDER FLOOR'), html.indexOf('LAST SEAT PAID'))
  }
  // The sale ANSWERED that it is shut, so that is what the cell says.
  expect(floor('closed')).toContain('CLOSED')
  expect(floor('closed')).not.toContain('—')
  // Nobody answered, and nobody-has-read-it is what the dash means.
  expect(floor('unknown')).toContain('—')
  expect(floor('unknown')).not.toContain('CLOSED')
  // An open ladder with no seats on it is still not a closed one.
  expect(floor('open')).toContain('—')
  expect(floor('open')).not.toContain('CLOSED')
})

/**
 * LAST SEAT PAID IS THE ONE CHANGE THIS PAGE CAN HONESTLY DATE.
 *
 * A MOVEMENT still carries no timestamp anywhere on the wire, which is why this
 * row is not labelled "latest change". A PAID SEAT does, as one board-wide
 * aggregate - and an absent one is an em dash, never the epoch.
 */
test('the composition rail dates the last paid seat, and never dates a silence', () => {
  const shape = launch()
  const now = Date.UTC(2026, 8, 16, 12, 0, 0)
  const paid = renderToStaticMarkup(
    <CatwalkComposition shape={shape} ladder="open" lastSeatPaidAt={now - 3 * 3_600_000} now={now} />,
  )
  expect(paid).toContain('LAST SEAT PAID')
  expect(paid).toContain('3H AGO')
  // Not a date, and above all not 1970: a board the server said nothing about
  // is an em dash.
  const silent = renderToStaticMarkup(<CatwalkComposition shape={shape} ladder="open" now={now} />)
  const cell = silent.slice(silent.indexOf('LAST SEAT PAID'))
  expect(cell).toContain('—')
  expect(cell).not.toContain('1970')
  expect(cell).not.toContain('AGO')
})

/**
 * THE RANKED RAIL KEEPS THREE FACTS APART. "Nobody has climbed in" is about the
 * board; "the registry lists no candidates" is about the registry; "the registry
 * could not be read" is about the network. A count is printed over the third
 * only when the read actually said `ready`, because a cold read and a failed one
 * both carry zero candidates and printing that is the collapse itself.
 */
test('the SOLZ RANKED rail never turns an unread registry into an empty one', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const rail = (rankedLane: CatwalkRankedLaneRead | null) =>
    renderToStaticMarkup(<CatwalkPanel tab="ranked" shape={shape} ladder="closed" rankedLane={rankedLane} />)

  // Nothing on the wire: the rail says nothing about the registry at all.
  const silent = rail(null)
  expect(silent).toContain('NOBODY HAS CLIMBED IN YET.')
  expect(silent).not.toContain('ON THE LADDER')
  expect(silent).not.toContain('THE RANKED LADDER LISTS NOBODY YET.')

  // Never read: said as an absence of knowledge, and no count is quoted.
  const cold = rail(lane('cold'))
  expect(cold).toContain('HAS NOT BEEN READ YET.')
  expect(cold).not.toContain('ON THE LADDER')
  expect(cold).not.toContain('LISTS NOBODY YET')

  // Read and failed: a fact about the read, not about the ladder.
  const failed = rail(lane('unavailable'))
  expect(failed).toContain('COULD NOT BE READ.')
  expect(failed).not.toContain('LISTS NOBODY YET')

  // Answered with nobody on it: the one state that may say so - and it says it
  // about the LADDER, which is what the chain answered for, rather than about
  // the identity file, which names tokens and knows nothing about who played.
  const answered = rail(lane('ready'))
  expect(answered).toContain('THE RANKED LADDER LISTS NOBODY YET.')
  expect(answered).toContain('ON THE LADDER')

  // A word from a newer server is not guessed at.
  const unknown = rail({ ...lane('somethingNew'), candidates: 9 })
  expect(unknown).not.toContain('LISTS NOBODY YET')
  expect(unknown).not.toContain('COULD NOT BE READ.')
})

/**
 * THE LADDER ITSELF, WHICH IS WHAT THE OWNER ASKED FOR: "where's the list of
 * solz ranked board?" There was none - the tab named SOLZ RANKED carried a
 * paragraph, two counts and a button.
 *
 * THE LIST IS GATED ON THE READ'S STATE, NEVER ON ITS LENGTH, which is the same
 * discipline every other surface on this page keeps: a ladder nobody has read is
 * not a ladder with nobody on it.
 */
test('the ranked ladder lists the coins, and only over a read that answered', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const rail = (read: CatwalkRankedLaneRead | null) =>
    renderToStaticMarkup(<CatwalkRankedRail shape={shape} rankedLane={read} />)

  const ready = rail(lane('ready', {
    candidates: 2,
    registryTokens: 3,
    registryUpdatedAt: '2026-08-12',
    projects: [project('SOLZ'), project('PUMP', { matches: '12', playerEntries: '48', poolBaseUnits: '1500000' })],
  }))
  // Both coins, in the order the wire delivered them - this page never re-sorts.
  expect(ready.indexOf('SOLZ')).toBeLessThan(ready.indexOf('PUMP'))
  expect(ready).toContain('cw-ranked-list')
  expect(ready).toContain('FINALIZED MATCHES')
  expect(ready).toContain('PLAYER ENTRIES')
  expect(ready).toContain('POOL COMPETED')
  // The figures, thousands-separated and scaled by each row's OWN decimals.
  expect(ready).toContain('1,427')
  expect(ready).toContain('8,194')
  expect(ready).toContain('1,208,317,450')
  expect(ready).toContain('1.5')
  // PLAYER ENTRIES IS NOT 'UNIQUE PLAYERS' AND IS NOT OFFERED AS ONE. The chain
  // accumulates a roster size per finalized match, so ten wallets playing a
  // hundred matches reports a thousand.
  expect(ready).toContain('NOT DISTINCT WALLETS')
  expect(ready).not.toContain('UNIQUE PLAYERS')
  // AND THE POOL IS NEVER DOLLARS. No '$', no money treatment, no column total.
  const list = ready.slice(ready.indexOf('cw-ranked-list'))
  expect(list).not.toContain('$')
  expect(list).not.toContain('cw-money')
  expect(ready).toContain('IT IS NOT A DOLLAR FIGURE AND IT DOES NOT ADD UP DOWN THE COLUMN.')
  // The depth line, which is what makes a two-row leaderboard legible rather
  // than broken-looking.
  expect(ready).toContain('THE LADDER IS AS DEEP AS THE CHAIN IS.')
  expect(ready).toContain('2 COINS HAVE FINALIZED A RANKED MATCH ON THIS BOARD')
  expect(ready).toContain('THE REGISTRY NAMES 3, LAST UPDATED 12 AUG 2026')

  // NO LIST UNDER A READ THAT DID NOT ANSWER, even with rows attached - the
  // gate is the state, and a list rendered during a 502 is the bug this page
  // exists to prevent.
  for (const state of ['cold', 'unavailable'] as const) {
    const html = rail(lane(state, { candidates: 2, projects: [project('SOLZ')] }))
    expect(html).not.toContain('cw-ranked-list')
    expect(html).not.toContain('THE LADDER IS AS DEEP AS THE CHAIN IS.')
    expect(html).not.toContain('FINALIZED MATCHES')
  }

  // A FIGURE THAT DID NOT PARSE IS AN EM DASH, NEVER A ZERO: a coin with no
  // matches and a coin whose count did not arrive are different claims.
  const partial = rail(lane('ready', {
    candidates: 1,
    projects: [project('SOLZ', { matches: null, poolBaseUnits: null })],
  }))
  expect(partial).toContain('—')
  expect(partial).not.toMatch(/<b>0<\/b>/)
  // The half that DID parse is still printed.
  expect(partial).toContain('8,194')
  // And a depth line missing its registry half omits that half rather than
  // guessing at it.
  expect(partial).toContain('1 COIN HAS FINALIZED A RANKED MATCH ON THIS BOARD.')
  expect(partial).not.toContain('THE REGISTRY NAMES')

  // Nothing on this list strings figures together on a middle dot.
  expect(ready).not.toContain('·')
})

/**
 * THE FOURTH TAB IS A NARROW-WIDTH DESTINATION AND NOTHING ELSE.
 *
 * Below 1280px the split collapses and the composition legend lands about two
 * thousand pixels under the board with nothing pointing at it, so it becomes a
 * tab. At or above 1280px the legend is a column already on screen, and a tab
 * pointing at it would be a lie about a place the reader is looking at - so the
 * id is absent from the tablist there rather than hidden, because `Tabs` moves
 * focus by INDEX and a hidden fourth button still holds its index.
 *
 * `useNarrow` answers false until a browser says otherwise, which is what the
 * server renders: four tabs, and no INFO.
 */
test('the INFO tab is never announced at desktop width, and is never deep-linkable', () => {
  const app = renderToStaticMarkup(<CatwalkApp />)
  // The server-rendered tablist is the desktop one, exactly.
  expect(app.match(/role="tab"/g)).toHaveLength(CATWALK_TABS.length)
  expect(app).not.toContain('>INFO<')
  expect(app).not.toContain('cw-info-panel')
  // Every tab's `aria-controls` resolves to a panel that is in the document.
  for (const id of CATWALK_TABS) {
    expect(app).toContain(`aria-controls="cw-${id}-panel"`)
    expect(app).toContain(`id="cw-${id}-panel"`)
  }
  expect(app).not.toContain('cw-info-panel')

  // AND 'info' IS NOT A LANE ID. Keeping it out of CATWALK_TABS is what stops a
  // `?lane=info` link a phone wrote being honoured on a desktop with no such
  // tab - and what keeps every per-tab promise below untouched by its existence.
  expect(CATWALK_TABS).not.toContain('info' as never)
  expect(isCatwalkTab('info')).toBe(false)

  // WHAT THE TAB SHOWS, when it exists: the composition rail, and the SAME left
  // board as every other tab. The board is never hidden - thirty-six numbered
  // positions are this page's promise on every tab - and `data-rail='info'` is
  // what lifts the legend above it in the stylesheet.
  const shape = launch()
  const panel = (id: 'catwalk' | 'info') => renderToStaticMarkup(
    <CatwalkPanel tab={id} shape={shape} ladder="open" onClaim={() => undefined} />,
  )
  expect(panel('info')).toContain('data-rail="info"')
  expect(panel('info')).toContain('cw-legend')
  expect(panel('info').match(/class="cw-slot/g)).toHaveLength(36)
  expect(splitBoard(panel('info'))).toBe(splitBoard(panel('catwalk')))
})

/**
 * A u128 POOL PAST Number.MAX_SAFE_INTEGER SURVIVES EXACTLY.
 *
 * A Number coercion there does not throw, it rounds - and a rounded pool figure
 * is indistinguishable from a right one on the page.
 */
test('the pool column scales with BigInt and never rounds a u128', () => {
  // 2^80 base units at 6 decimals.
  // 2^80 is 1208925819614629174706176, which at six decimals is a figure a
  // Number could not hold: it rounds to ...174.70617600000001 and the grouping
  // is wrong from the seventeenth digit. Exact here, digit for digit.
  expect(formatBaseUnits((2n ** 80n).toString(), 6)).toBe('1,208,925,819,614,629,174.7')
  // Each row is scaled by ITS OWN decimals, not a shared constant.
  expect(formatBaseUnits('1500000', 6)).toBe('1.5')
  expect(formatBaseUnits('1500000', 0)).toBe('1,500,000')
  // A pool with no whole token still states what it has: truncating to two
  // digits here would print `0`, which claims nothing has been staked.
  expect(formatBaseUnits('1500000', 9)).toBe('0.0015')
  // Unreadable base units, or an unreadable scale over readable units, is null -
  // unscaled base units are not a figure, they are a figure of unknown size.
  expect(formatBaseUnits(null, 6)).toBeNull()
  expect(formatBaseUnits('1500000', null)).toBeNull()
  expect(formatBaseUnits('12.5', 6)).toBeNull()
  expect(formatBaseUnits('-5', 6)).toBeNull()
})

/* ── the icon proxy is a fixed list of hosts, not an open one ────────────── */

/**
 * A crest fetched straight from the registry's host mostly works and sometimes
 * does not: a host that omits `Cross-Origin-Resource-Policy` is refused outright
 * by an embedder that sets COEP. USDC's crest came from raw.githubusercontent
 * .com (which sends `CORP: cross-origin`) and rendered; SOLZ's came from ipfs.io
 * (which sends nothing) and was blocked, so the coin drew as the fallback mark -
 * indistinguishable from having no logo at all. Same-origin bytes are never
 * subject to CORP, so they come through this route.
 *
 * A route that fetches any URL a query string names is a server-side request
 * forgery with a picture frame around it, so the host list is closed.
 */
test('the icon proxy serves token-metadata hosts and refuses everything else', () => {
  // The hosts these coins' metadata actually names.
  expect(allowedIconHost('https://ipfs.io/ipfs/bafkreigfl')).not.toBeNull()
  expect(allowedIconHost('https://raw.githubusercontent.com/solana-labs/token-list/a.png')).not.toBeNull()
  expect(allowedIconHost('https://pump.mypinata.cloud/ipfs/abc')).not.toBeNull()
  expect(allowedIconHost('https://arweave.net/abc')).not.toBeNull()

  // Anything else is refused rather than fetched.
  expect(allowedIconHost('https://evil.test/a.png')).toBeNull()
  // Matched on the registrable domain, never by substring: this host is not
  // ipfs.io and must not be read as it.
  expect(allowedIconHost('https://ipfs.io.evil.test/a.png')).toBeNull()
  // No plaintext, so the server never makes a downgraded request the page
  // cannot see - and the loopback address is not reachable through this route
  // whatever port it names.
  expect(allowedIconHost('http://ipfs.io/ipfs/abc')).toBeNull()
  expect(allowedIconHost('http://127.0.0.1:3100/health')).toBeNull()
  expect(allowedIconHost('https://127.0.0.1:3100/health')).toBeNull()
  expect(allowedIconHost('file:///etc/passwd')).toBeNull()
  expect(allowedIconHost('')).toBeNull()
  expect(allowedIconHost('not a url')).toBeNull()

  // And the URL the page actually asks for is same-origin, carrying the
  // registry's own URL verbatim in the query string.
  expect(tokenIconUrl('https://ipfs.io/ipfs/abc')).toBe('/api/token-icon?url=https%3A%2F%2Fipfs.io%2Fipfs%2Fabc')
  // A host this site will not fetch becomes no URL at all, so the row keeps the
  // built-in mark rather than requesting something that will 400.
  expect(tokenIconUrl('https://evil.test/a.png')).toBe('')
})

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE THREE GUARDS BELOW EXIST BECAUSE THIS REPO HAS NO DOM.
 *
 * Every render here is `renderToStaticMarkup`, so effects never run - and
 * CatwalkApp reads its query out of `window.location` in an effect and starts
 * with `feed.loading` true. A server render of <CatwalkApp /> is therefore ALWAYS
 * the pending frame with an empty query: the searching frames simply cannot be
 * reached from a test. That is not a small gap, because the two things the plan
 * calls blockers - the board's dim/match layer, and the countdown - both live in
 * frames only a browser ever renders.
 *
 * So both were made reachable instead of being asserted at a distance. The layer
 * moved into `catwalkBoardLayer`, a pure function this file calls directly, and
 * the split frame moved into `CatwalkSplit`, a component this file renders
 * directly. What is left over - that CatwalkApp really does route through them
 * rather than keeping a second copy - is the one thing no render can show, and
 * it is asserted against the source text, narrowly and by name.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** The file with its comments taken out, so a guard counts CODE and not the
 *  prose explaining it - this codebase's comments quote the very identifiers
 *  these assertions count. */
const codeOf = async (path: string) => {
  const text = await Bun.file(new URL(path, import.meta.url)).text()
  return text
    // Block comments, including the `{/* ... */}` form JSX uses.
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
    // Whole-line `//` comments. Never a trailing one, which could sit inside a
    // string; no guard below depends on those being gone.
    .replace(/^\s*\/\/.*$/gm, '')
}

/**
 * THE DIM/MATCH LAYER IS A FACT ABOUT THE BOARD, ON EVERY TAB.
 *
 * The existing byte-identical tests compute the layer themselves and hand the
 * result to CatwalkPanel as props, so they pin the helper and they pin the
 * panel - but not the derivation, which is where the regression actually was.
 * CatwalkApp had built the layer from `tabRows(tab, ...)`: a coin matched in a
 * lane other than the open tab's emptied the hit set, and an empty hit set dims
 * all thirty-six rows at .22 and outlines none. The board blanking out because
 * the reader clicked a tab, on the screen whose whole promise is that the left
 * side does not move.
 *
 * The derivation is `catwalkBoardLayer` now, and it takes the tab - so the test
 * can hand it every tab and demand the SAME layer back. Reaching the tab's rows
 * from inside it, in any form, fails here.
 */
test("the board layer is built from the whole board, never the tab's rows", () => {
  const shape = launch()
  // $FOOFIX stands at P01 in the CHAMPION lane - so on SOLZ RANKED, on OUTBID
  // and on INFO it is a coin outside the tab's own lane, which is the exact
  // case that used to black the board out.
  const query = parseCatwalkQuery('foofix')
  const every: CatwalkPanelId[] = [...CATWALK_TABS, 'info']

  for (const id of every) {
    const layer = catwalkBoardLayer(shape.rows, query, id)
    // One coin lit, in its own position, whatever tab is open.
    expect(layer.hits).toEqual([1])
    expect(shape.rows.filter(layer.matched).map((row) => row.spot)).toEqual([1])
    // And thirty-five dimmed - never thirty-six, which is the blanked board.
    expect(shape.rows.filter(layer.dimmed)).toHaveLength(35)
  }

  // THE REGRESSION ITSELF, so the loop above cannot pass over a board that
  // simply never dims anything: a layer built from ONE LANE'S rows lights
  // nothing and dims everything.
  const laneLayer = boardSearchLayer(tabRows('ranked', shape.rows), query)
  expect(shape.rows.filter(laneLayer.dimmed)).toHaveLength(36)
  expect(shape.rows.filter(laneLayer.matched)).toHaveLength(0)

  // A BARE SLOT QUERY went wrong through `matched` alone - it dims nothing, but
  // it must still light P01 on every tab and not only on the tab owning P01's
  // lane.
  for (const id of every) {
    const slot = catwalkBoardLayer(shape.rows, parseCatwalkQuery('1'), id)
    expect(shape.rows.filter(slot.matched).map((row) => row.spot)).toEqual([1])
    expect(shape.rows.filter(slot.dimmed)).toHaveLength(0)
  }

  // AND THE TAB IS STILL ALLOWED TO REACH THE RAIL'S HALF. `visible` is what
  // the rail's verdict is judged against, and it is genuinely per-lane - so the
  // assertions above are the layer being tab-blind, not the tab being ignored
  // everywhere.
  expect(catwalkBoardLayer(shape.rows, query, 'catwalk').visible).toHaveLength(36)
  expect(catwalkBoardLayer(shape.rows, query, 'ranked').visible.length).toBeLessThan(36)
  // INFO is not a lane. It shares the MIAW PRIX rail, so it asks the MIAW PRIX
  // question - a verdict narrower than the rail it is printed beside would be a
  // different claim.
  expect(catwalkBoardLayer(shape.rows, query, 'info').visible).toHaveLength(36)
})

/**
 * THE COUNTDOWN LEADS THE SPLIT WHEREVER THE RAIL IS NOT A COLUMN.
 *
 * At >= 1280px the rail is sticky beside the board and the clock is its head,
 * on screen for the whole scroll. Below that the split is ONE column and the
 * rail follows the board, so the clock sat under thirty-six rows and the hero -
 * roughly 2,100px down - on MIAW PRIX, SOLZ RANKED and CHAMPIONS. The
 * stylesheet's `order: -1` rescue only ever covered OUTBID and INFO, so on the
 * tab a reader LANDS on the answer to "when does it lock" was still below the
 * fold at phone and tablet width.
 *
 * It is ONE element in both arrangements. Rendering a second copy per
 * breakpoint and hiding one is what would put two countdowns of a single
 * instant on the page, one of them announced on a width where it is invisible.
 */
test('the countdown leads the split below the breakpoint, and heads the rail above it', () => {
  const lock = { state: 'counting' as const, locksAt: Date.now() + 7 * 3_600_000, startsAt: Date.now() + 19 * 3_600_000 }
  const every: CatwalkPanelId[] = [...CATWALK_TABS, 'info']

  for (const id of every) {
    const split = (narrow: boolean) => renderToStaticMarkup(
      <CatwalkSplit tab={id} lock={lock} narrow={narrow} board={<u>BOARD</u>} rail={<s>RAIL</s>} />,
    )
    const wide = split(false)
    const narrow = split(true)

    // EXACTLY ONE CLOCK, at either width and on every tab.
    for (const html of [wide, narrow]) {
      expect(html.match(/BOARD LOCKS IN/g)).toHaveLength(1)
      expect(html.match(/role="timer"/g)).toHaveLength(1)
      expect(html.match(/class="cw-clock/g)).toHaveLength(1)
      // The board is first in the DOM either way, so keyboard order still gives
      // the numbered table before whatever is explaining it.
      expect(html.indexOf('>BOARD<')).toBeLessThan(html.indexOf('>RAIL<'))
    }

    // DESKTOP: the clock is inside the rail and there is no hoisted box at all.
    expect(wide).not.toContain('cw-split-clock')
    expect(wide.indexOf('class="cw-clock')).toBeGreaterThan(wide.indexOf('cw-split-rail'))

    // NARROW: the clock is its own child of the split, ahead of the board - so
    // `order: -2` in catwalk.css has something to order, and the reader does
    // not scroll a board's worth of rows to reach it.
    expect(narrow).toContain('cw-split-clock')
    expect(narrow.indexOf('cw-split-clock')).toBeLessThan(narrow.indexOf('cw-split-board'))
    expect(narrow.indexOf('class="cw-clock')).toBeLessThan(narrow.indexOf('cw-split-rail'))
  }

  // A schedule nobody has read yet is a silence, not a dash - and it is the
  // same one element, in the same place, at both widths.
  const unread = renderToStaticMarkup(
    <CatwalkSplit tab="catwalk" lock={{ state: 'unread' }} narrow board={<u />} rail={<s />} />,
  )
  expect(unread).toContain('cw-clock--pending')
  expect(unread).not.toContain('BOARD LOCKS IN')
  expect(unread.indexOf('cw-split-clock')).toBeLessThan(unread.indexOf('cw-split-board'))
})

/**
 * ONE FRAME AND ONE CLOCK IN THE SOURCE, BECAUSE NO RENDER CAN SHOW IT.
 *
 * CatwalkApp is in one of three frames - first paint, a search that missed, and
 * the read board - and the split markup used to be written out in all three,
 * each with its own `<aside>` and its own mount of the countdown. Deleting the
 * countdown from the search-miss copy left this suite green, because a server
 * render of CatwalkApp is always the pending copy; the same deletion in the
 * pending copy failed, which is exactly how a gap like this hides.
 *
 * There is one copy now. These two counts are what says so, and they are the
 * only assertions in this file that read source rather than output - deliberately
 * narrow ones, naming the two identifiers a re-duplication would have to use.
 */
test('CatwalkApp builds the split once, mounts one clock, and derives no layer of its own', async () => {
  const code = await codeOf('../src/components/catwalk/CatwalkApp.tsx')

  // ONE `<CatwalkClock>`, inside CatwalkSplit. A second mount is a second
  // countdown of a single instant; a frame that routes around CatwalkSplit to
  // add its own is the duplication that hid the missing one.
  expect(code.match(/<CatwalkClock\b/g)).toHaveLength(1)
  // ONE `.cw-split` frame, for the same reason: three hand-written copies is
  // three places to forget the clock, and two of them are unrenderable here.
  expect(code.match(/className="cw-split"/g)).toHaveLength(1)
  expect(code.match(/className="cw-split-rail"/g)).toHaveLength(1)

  // AND NO SECOND DERIVATION OF THE BOARD LAYER. `catwalkBoardLayer` is the one
  // way this page builds dim/match, and it cannot be handed a filtered list of
  // rows. Naming `boardSearchLayer` here is how the tab got back into the left
  // column the first time.
  expect(code).not.toContain('boardSearchLayer')
  expect(code.match(/catwalkBoardLayer\(/g)).toHaveLength(1)
})

/**
 * WHAT THE STYLESHEET HAS TO SAY FOR THE TWO RULES ABOVE TO MEAN ANYTHING.
 *
 * `CatwalkSplit` puts the clock ahead of the board in the DOM below the
 * breakpoint; `order: -2` is what puts it ahead of the OUTBID and INFO rails,
 * which carry `order: -1` of their own. And the lane strip has to WRAP: with
 * INFO appended there are five tabs below 1280px, and the strip used to be
 * `flex-wrap: nowrap` with `overflow-x: auto` and the scrollbar suppressed in
 * both `scrollbar-width` and `::-webkit-scrollbar` - so on an iPad in portrait
 * the fifth tab sat outside the scrollport with no scrollbar, no fade and
 * nothing to say the strip scrolled. A reader told by `useNarrow` that they get
 * the INFO destination, who can never see it.
 */
test('the stylesheet orders the hoisted clock and lets the lane strip wrap', async () => {
  const css = await codeOf('../src/styles/catwalk.css')

  // The hoisted clock is ordered ahead of both columns, under the breakpoint
  // where the split is one column.
  const narrowRules = css.match(/@media \(max-width: 1279px\) \{[^}]*\}[^}]*\}/g) ?? []
  expect(narrowRules.join('\n')).toContain('.cw-split-clock')
  expect(css).toMatch(/\.cw-split-clock\s*\{[^}]*order:\s*-2/)
  // Ahead of the rail's own rescue, or OUTBID and INFO would put their rail
  // above the clock.
  expect(css).toMatch(/\.cw-split\[data-rail='outbid'\] \.cw-split-rail \{ order: -1; \}/)

  // The lane strip wraps and never clips. A tab the reader cannot reach is the
  // condition the INFO tab exists to fix.
  const strip = css.match(/\.cw-toolbar \.mx-tabs \{[^}]*\}/)?.[0] ?? ''
  expect(strip).toContain('flex-wrap: wrap')
  expect(strip).not.toContain('nowrap')
  expect(strip).not.toContain('overflow-x: auto')
  expect(strip).not.toContain('scrollbar-width: none')
  expect(css).not.toContain('.cw-toolbar .mx-tabs::-webkit-scrollbar')
})

/* ── THE LADDER IS A TABLE, AND EVERY COIN ON IT HAS AN ADDRESS ──────────── */

/**
 * "why the tabble is fckin??? it supposed to be hoizontal but pool competed,
 * finalzed match there, why is it like that ?"
 *
 * Three figures were pinned to ONE grid track (`grid-column: 3`), so grid
 * auto-placement put them on rows one, two and three of the row - a stack down
 * the right-hand edge rather than three columns. The fix is six tracks and a
 * header, and these assertions pin the structure that makes it a table rather
 * than the appearance, because a stylesheet cannot be rendered here.
 */
test('the ranked ladder is a horizontal table: a header row, and one column per figure', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const read = lane('ready', { candidates: 2, projects: [project('SOLZ'), project('PUMP')] })
  const html = renderToStaticMarkup(<CatwalkRankedRail shape={shape} rankedLane={read} />)

  // THE HEADER, and it sits BEFORE the list rather than inside it: the `<ol>`
  // keeps its list semantics and the rail keeps `cw-ranked-list`.
  expect(html).toContain('cw-ranked-head')
  expect(html.indexOf('cw-ranked-head')).toBeLessThan(html.indexOf('cw-ranked-list'))
  expect(html).toContain('<ol class="cw-ranked-list" data-lane="ranked">')
  // The header is hidden from assistive technology, because each row still
  // carries its own label in the DOM - clipped, not deleted.
  expect(html).toContain('<div class="cw-ranked-head" aria-hidden="true">')

  // THE WRAPPER THAT `display: contents` FLATTENS. Without it the phone fold
  // cannot move all three figures at once; with `grid-column` back on the
  // figures the stack returns.
  expect(html).toContain('cw-ranked-figures')

  // AND THE POOL IS STILL NOT DOLLARS. The header renders before the list, so
  // it is outside this slice - and it carries no `$` either way.
  const list = html.slice(html.indexOf('cw-ranked-list'))
  // The `<ol>` alone, without the two footnotes under it - both of them name
  // these columns in prose, which is a different claim from a row's own label.
  const rowsOnly = list.slice(0, list.indexOf('</ol>'))
  // ONE LABEL PER ROW, STILL IN THE DOM. The header is the sighted reader's
  // answer; the clipped `<i>` in each row is the screen reader's, so a user on
  // row nineteen never has to hold a header in memory. Two rows, two of each.
  expect(rowsOnly.match(/FINALIZED MATCHES/g)).toHaveLength(2)
  expect(rowsOnly.match(/PLAYER ENTRIES/g)).toHaveLength(2)
  expect(rowsOnly.match(/POOL COMPETED/g)).toHaveLength(2)
  // And once each in the header, which is what makes it read as a table.
  const head = html.slice(html.indexOf('cw-ranked-head'), html.indexOf('cw-ranked-list'))
  expect(head).toContain('FINALIZED MATCHES')
  expect(head).toContain('PLAYER ENTRIES')
  expect(head).toContain('POOL COMPETED')
  expect(list).not.toContain('$')
  expect(list).not.toContain('cw-money')
  expect(html).not.toContain('$')
})

/**
 * "and where's the image, and address ??" / "there can be too many similar
 * image and name."
 *
 * The ladder carried `mint`, `symbol`, `name` and `logoUrl` all along and drew
 * none of the first or the last. It reuses the BOARD's identity pattern -
 * `MintButton`, `.cw-id`, `TeamMark` - rather than a second one.
 */
test('a ranked row carries its crest, its contract address and its explorer link', () => {
  const row = project('SOLZ')
  // THE COIN IS STANDING ON THE BOARD HERE, which is what makes its symbol a
  // link at all - see the test below for the ladder entry that is not, and why
  // linking that one erased the page the reader clicked on.
  const shape = buildBoard({
    board: board([entry(6, 'ranked', row.mint, 'SOLZ')]),
    spots: [],
    standings: new Map(),
    ladder: 'closed',
  })
  const html = renderToStaticMarkup(
    <CatwalkRankedRail
      shape={shape}
      rankedLane={lane('ready', { candidates: 1, projects: [row] })}
      explorer={{ family: 'SOLANA', explorerUrl: 'https://explorer.solana.com' }}
      coinHref={(mint) => `/catwalk?q=${mint}`}
    />,
  )
  // The crest, which falls back to a per-id mark rather than a broken image.
  expect(html).toContain('sh-team-mark')
  // The address, copyable in full - the copy carries the whole mint, never the
  // head-and-tail form on screen.
  expect(html).toContain('cw-mint')
  expect(html).toContain(`Copy contract address ${row.mint}`)
  expect(html).toContain(`<code class="cw-mint-full" aria-hidden="true">${row.mint}</code>`)
  // And it links out, through the same helper the board rows use.
  expect(html).toContain('cw-ca-link')
  expect(html).toContain(`View contract ${row.mint} in the block explorer`)
  // The identity cell borrows the board's own class, so nothing about an
  // address is authored twice.
  expect(html).toContain('cw-id cw-ranked-id')
  expect(html).toContain(`href="/catwalk?q=${row.mint}"`)
  expect(html).toContain('cw-symbol')
})

/** A coin the registry never named is SHOWN, by its address - the ladder is as
 *  deep as the chain is, and curating an unnamed coin out of it would make the
 *  lane look shallower than it is. */
test('a ranked coin with no ticker renders as its short address, never as a blank', () => {
  const shape = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const row = { ...project('SOLZ'), symbol: '', name: '' }
  const html = renderToStaticMarkup(
    <CatwalkRankedRail shape={shape} rankedLane={lane('ready', { candidates: 1, projects: [row] })} />,
  )
  expect(html).toContain(`${row.mint.slice(0, 4)}…${row.mint.slice(-4)}`)
  // The full address is still in the markup, and still copyable whole.
  expect(html).toContain(`Copy contract address ${row.mint}`)
})

/**
 * "outbid also need address and link inserted within the list".
 *
 * The markup was there all along - `CatwalkOutbidRow` renders `MintButton`
 * inside its `.cw-id` - and one CSS rule hid it. This is the only place that
 * deletion can be pinned, because a stylesheet does not reach the renderer.
 */
test('the outbid rail no longer hides the contract address, and still hides the two the board repeats', async () => {
  const css = await codeOf('../src/styles/catwalk.css')
  const rule = css.slice(css.indexOf('.cw-split-rail .cw-outbid-row .cw-mcap'))
  const hidden = rule.slice(0, rule.indexOf('}'))
  // The market cap and the lane chip are genuinely duplicated by the board
  // beside this rail, so they stay hidden.
  expect(hidden).toContain('.cw-mcap')
  expect(hidden).toContain('.cw-lane')
  // THE ADDRESS IS NOT. Icons collide and names collide; the mint is the only
  // identity a coin on this list actually has.
  expect(css).not.toContain('.cw-split-rail .cw-outbid-row .cw-ca,')
  expect(css).not.toContain('.cw-split-rail .cw-outbid-row .cw-ca ')
})

/** And the markup it un-hides is real: the rail's rows carry the address. */
test('an outbid row renders the address it was hiding', () => {
  const shape = buildBoard({
    board: board([entry(4, 'outbid', MINT_B, '$BARFIX')]),
    spots: ladder(3, { 1: MINT_B }),
    standings: new Map(),
    ladder: 'open',
  })
  const html = renderToStaticMarkup(
    <CatwalkOutbidList
      rows={buildOutbidList(shape, 'open')}
      note="TEST"
      explorer={{ family: 'SOLANA', explorerUrl: 'https://explorer.solana.com' }}
    />,
  )
  expect(html).toContain('cw-outbid-row')
  expect(html).toContain(`Copy contract address ${MINT_B}`)
  expect(html).toContain('cw-ca-link')
})

/* ── A ROW CLICK IS A SEARCH, NOT A PAGE LOAD ────────────────────────────── */

/**
 * "and why why click each of it trigger page reload ?"
 *
 * Four surfaces answered a row click with `window.location.assign(href)`, and
 * `href` was `/catwalk?q=<mint>` - THE PAGE THE READER IS ALREADY ON. So every
 * press tore the document down and rebuilt it in order to run a filter.
 *
 * NOTHING IN THIS REPO SIMULATES A CLICK - every other assertion on this
 * surface is a `renderToStaticMarkup` string, and this tree carries no DOM for
 * a test to click in. So the behaviour is pinned where it actually lives: in
 * `pickCoin`, which is the one decision every coin anchor on the page now makes.
 */
const clickEvent = (over: Record<string, unknown> = {}) => {
  const calls = { preventDefault: 0, stopPropagation: 0 }
  const event = {
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { calls.preventDefault += 1 },
    stopPropagation() { calls.stopPropagation += 1 },
    ...over,
  }
  return { event, calls }
}

test('a plain left click on a coin link filters in place instead of navigating', () => {
  const seen: string[] = []
  const { event, calls } = clickEvent()
  pickCoin((mint) => seen.push(mint), MINT_B)(event as never)
  // The filter ran, once.
  expect(seen).toEqual([MINT_B])
  // And the navigation did NOT: preventDefault is the whole difference between
  // filtering this page and reloading it.
  expect(calls.preventDefault).toBe(1)
  // The row underneath must not also fire - the anchor answered this click.
  expect(calls.stopPropagation).toBe(1)
})

/** ANYTHING THAT IS NOT A PLAIN LEFT CLICK IS THE READER ASKING THE BROWSER FOR
 *  SOMETHING, and the browser must be left to give it to them. The anchor stays
 *  a real `<a href>` for exactly this reason. */
test('a modified click is left to the browser, so the anchor still opens a tab', () => {
  for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
    const seen: string[] = []
    const { event, calls } = clickEvent({ [modifier]: true })
    pickCoin((mint) => seen.push(mint), MINT_B)(event as never)
    expect(seen).toEqual([])
    expect(calls.preventDefault).toBe(0)
  }
  // A non-primary button is the same answer.
  const seen: string[] = []
  const { event, calls } = clickEvent({ button: 1 })
  pickCoin((mint) => seen.push(mint), MINT_B)(event as never)
  expect(seen).toEqual([])
  expect(calls.preventDefault).toBe(0)
})

/** With no handler the helper does nothing at all and the anchor navigates
 *  exactly as it did before - which is how every render assertion in this file
 *  calls these components, and why none of them had to move. */
test('with no onCoin the coin link is left alone entirely', () => {
  const { event, calls } = clickEvent()
  pickCoin(undefined, MINT_B)(event as never)
  expect(calls.preventDefault).toBe(0)
  // The row click is still suppressed: a link inside a row was never meant to
  // trigger the row as well.
  expect(calls.stopPropagation).toBe(1)
})

/** A click already answered by something else is not answered twice. */
test('a click another handler already prevented is not filtered again', () => {
  const seen: string[] = []
  const { event } = clickEvent({ defaultPrevented: true })
  pickCoin((mint) => seen.push(mint), MINT_B)(event as never)
  expect(seen).toEqual([])
})

/**
 * THE FOUR `window.location.assign` CALLS ARE GONE, and this is the only thing
 * that can say so: a static render carries no `onClick`, so nothing else in
 * this file would notice them coming back.
 */
test('no catwalk row answers a click by reloading the page', async () => {
  for (const file of ['CatwalkSlotRow.tsx', 'CatwalkLadder.tsx', 'CatwalkRankedRail.tsx', 'CatwalkApp.tsx']) {
    const code = await codeOf(`../src/components/catwalk/${file}`)
    expect(code).not.toContain('window.location.assign')
  }
})

/**
 * THE PROMISE THAT MUST NOT REGRESS: the left board is identical in every tab,
 * including under an active search.
 *
 * The in-place filter writes `typed` and `applied` - the SAME state typing
 * writes - so the dim/match layer still comes from `catwalkBoardLayer` over the
 * WHOLE board. A second filter path, or a row list derived per tab, is the
 * regression this guards.
 */
test('the in-place filter goes through the search state, not a second path', async () => {
  const code = await codeOf('../src/components/catwalk/CatwalkApp.tsx')
  // The handler sets both halves of the one search state and nothing else.
  expect(code).toContain('const onCoin = useCallback')
  expect(code).toMatch(/const onCoin = useCallback\([\s\S]{0,320}?setTyped\(/)
  expect(code).toMatch(/const onCoin = useCallback\([\s\S]{0,320}?setApplied\(/)
  // And the board layer is still derived from every row, never from a filtered
  // or tab-scoped list.
  expect(code).toContain('catwalkBoardLayer(shape.rows, query, tab)')
})

/* ── THE RANKED TABLE'S LAYOUT, PINNED IN THE STYLESHEET ─────────────────── */

/**
 * A CSS BLOCK, BY BRACE MATCHING. `[^}]*\}` cannot read a rule set that contains
 * rule sets, and every at-rule in this stylesheet does.
 */
const blockOf = (css: string, opener: string, holding = '') => {
  // The same at-rule opens more than once in this file - `@container
  // (max-width: 860px)` governs the abbreviated mint hundreds of lines above the
  // row folds - so the block is chosen by something it CONTAINS, never by being
  // the first one with that width.
  for (let start = css.indexOf(opener); start >= 0; start = css.indexOf(opener, start + 1)) {
    let depth = 0
    for (let at = css.indexOf('{', start); at < css.length; at += 1) {
      if (css[at] === '{') depth += 1
      if (css[at] === '}') {
        depth -= 1
        if (depth === 0) {
          const block = css.slice(start, at + 1)
          if (!holding || block.includes(holding)) return block
          break
        }
      }
    }
  }
  return ''
}

/** The declarations of the FIRST rule whose selector is exactly `selector`. */
const ruleOf = (css: string, selector: string) => {
  const at = css.search(new RegExp(`(^|[};])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`, 'm'))
  if (at < 0) return ''
  const open = css.indexOf('{', at)
  return css.slice(open + 1, css.indexOf('}', open))
}

/**
 * THE OWNER'S FIRST COMPLAINT WAS FIXED IN CSS, AND CSS IS WHERE IT HAS TO BE
 * HELD.
 *
 * "why the tabble is fckin??? it supposed to be hoizontal but pool competed,
 * finalzed match there, why is it like that ?"
 *
 * The render test above asserts the MARKUP that makes a table possible - a
 * header row, a figures wrapper, one label per row. None of that stops the stack
 * coming back: putting `grid-column: 3` back on `.cw-ranked-figure`, or
 * collapsing `--cw-ranked-cols` to three tracks, or deleting `display: contents`
 * reproduces the rejected layout exactly, and every assertion in this file would
 * still pass. These are the declarations that decide it.
 */
test('the ranked ladder is six tracks wide, and no rule pins its figures to one', async () => {
  const css = await codeOf('../src/styles/catwalk.css')

  // SIX TRACKS, DECLARED ONCE, so the header and every row cannot drift apart:
  // rank, crest, identity, and one per figure.
  const tracks = ruleOf(css, '.cw-ranked-head, .cw-ranked-list')
  expect(tracks).toContain('--cw-ranked-cols:')
  const columns = tracks.slice(tracks.indexOf('--cw-ranked-cols:') + 17, tracks.indexOf(';', tracks.indexOf('--cw-ranked-cols:')))
  // `minmax(0, 1fr)` carries a comma of its own, so tracks are counted at the
  // top level rather than by splitting on whitespace inside the functions.
  const trackCount = columns.replace(/\([^)]*\)/g, 'x').trim().split(/\s+/).length
  expect(trackCount).toBe(6)
  // The header and the rows resolve the SAME variable, which is what keeps the
  // column heads over the columns they name.
  expect(ruleOf(css, '.cw-ranked-head')).toContain('grid-template-columns: var(--cw-ranked-cols)')
  expect(ruleOf(css, '.cw-ranked-row')).toContain('grid-template-columns: var(--cw-ranked-cols)')

  // THE FIGURES ARE FLAT GRID ITEMS. `display: contents` is what lets three
  // wrapped spans occupy three tracks of the row instead of one cell.
  expect(ruleOf(css, '.cw-ranked-figures')).toContain('display: contents')
  // AND NOT ONE OF THEM IS PINNED TO A COLUMN. This single declaration is the
  // whole of the owner's complaint: three figures in one track auto-place onto
  // three ROWS, which is the stack down the right-hand edge.
  expect(ruleOf(css, '.cw-ranked-figure')).not.toContain('grid-column')

  // THE FIRST THREE CELLS ARE PLACED BY NAME, at a specificity no single-class
  // rule can beat, so a bare `.cw-id` or `.cw-crest` rule elsewhere in the file
  // can never take one of them again.
  expect(ruleOf(css, '.cw-ranked-row > .cw-ranked-rank')).toContain('grid-column: 1')
  expect(ruleOf(css, '.cw-ranked-row > .cw-crest')).toContain('grid-column: 2')
  expect(ruleOf(css, '.cw-ranked-row > .cw-ranked-id')).toContain('grid-column: 3')
})

/**
 * THE BOARD'S OWN FOLD MUST NOT REACH THE RANKED TABLE.
 *
 * `@media (max-width: 820px)` carried bare `.cw-id` and `.cw-crest` rules. The
 * ranked row deliberately borrows `.cw-id` so an address is not authored twice,
 * and its crest is the same `TeamMark`, so from ~557px to 820px - an iPad in
 * portrait, a half-width window on a 1536px monitor - the identity was pinned
 * across columns 3-5, the crest was pulled to column 1, and two of the three
 * figures dropped to a second line under a header still drawing six tracks.
 * That is the rejected stack, reproduced by a rule about a different row: the
 * rail is far wider than 520px there, so the ranked table's own phone fold is
 * NOT what is in force.
 */
test('the board’s 820px fold is scoped to board rows and cannot reach the ranked table', async () => {
  const css = await codeOf('../src/styles/catwalk.css')
  const fold = blockOf(css, '@media (max-width: 820px)', '.cw-slot')
  expect(fold).toContain('.cw-slot .cw-id')
  expect(fold).toContain('.cw-slot .cw-crest')
  // The bare forms, which is what leaked. Matched with the boundary in front so
  // `.cw-slot .cw-id` does not satisfy the assertion about `.cw-id`.
  expect(fold).not.toMatch(/(^|[{};\n])\s*\.cw-id\s*[,{]/)
  expect(fold).not.toMatch(/(^|[{};\n,])\s*\.cw-crest\s*[,{]/)
})

/**
 * FIVE CELLS ARE LAID OUT ON A RAIL ROW, SO FIVE TRACKS ARE DECLARED.
 *
 * The `@container (max-width: 860px)` rule declared six because it was written
 * for a row that shows its market cap. The rail hides BOTH `.cw-mcap` and
 * `.cw-lane`, and `display: none` removes a cell from layout entirely - so the
 * sixth track and its gap sat empty at the right edge of every row while the
 * identity cell, the one the address was just un-hidden into, was squeezed. At
 * 1440px the rail is ~612px wide, so this is the rule every desktop reader of
 * the OUTBID tab actually gets.
 */
test('the outbid rail declares as many columns as it renders cells', async () => {
  const css = await codeOf('../src/styles/catwalk.css')
  const fold = blockOf(css, '@container (max-width: 860px)', '.cw-outbid-row')
  // The six-track rule for this row is gone from the rail's container query.
  expect(fold).not.toMatch(/\.cw-outbid-tokens \.cw-outbid-row \{[^}]*grid-template-columns/)
  const rail = ruleOf(fold, '.cw-split-rail .cw-outbid-row')
  expect(rail).toContain('grid-template-columns')
  const columns = rail.slice(rail.indexOf('grid-template-columns:') + 22, rail.indexOf(';', rail.indexOf('grid-template-columns:')))
  expect(columns.replace(/\([^)]*\)/g, 'x').trim().split(/\s+/)).toHaveLength(5)
  // And the two cells that are hidden - the pair the board beside the rail
  // repeats - are still hidden, which is what makes five the right number.
  const hidden = ruleOf(css, '.cw-split-rail .cw-outbid-row .cw-mcap,\n.cw-split-rail .cw-outbid-row .cw-lane')
  expect(hidden || css).toContain('display: none')
})

/* ── A CLICK ON THE LADDER MUST NOT ERASE THE PAGE IT WAS MADE ON ────────── */

/**
 * The SOLZ RANKED ladder is the CHAIN'S whole candidate list, not the board.
 * Most coins on it hold no position, and every coin link on this page runs the
 * board's own search - so clicking one of them produced a text query with an
 * empty hit set: all thirty-six rows dimmed to .22 with no match outline, and
 * `searchOutcome` reporting a miss, which swaps this very rail for the search
 * card. The click deleted the table it was made on.
 */
test('a ranked coin that holds no board position is not a link that empties the board', () => {
  const standing = project('ONBOARD')
  const absent = project('OFFBOARD')
  const shape = buildBoard({
    board: board([entry(9, 'ranked', standing.mint, 'ONBOARD')]),
    spots: [],
    standings: new Map(),
    ladder: 'closed',
  })
  const html = renderToStaticMarkup(
    <CatwalkRankedRail
      shape={shape}
      rankedLane={lane('ready', { candidates: 2, projects: [standing, absent] })}
      explorer={{ family: 'SOLANA', explorerUrl: 'https://explorer.solana.com' }}
      coinHref={(mint) => `/catwalk?q=${mint}`}
    />,
  )
  // The coin the board holds is a link: its click lights a row.
  expect(html).toContain(`href="/catwalk?q=${standing.mint}"`)
  // The one it does not hold is not, and says why as a fact about the BOARD -
  // climbing the ladder is how a coin ARRIVES at a position, so holding none is
  // the normal state of almost every row on this list.
  expect(html).not.toContain(`href="/catwalk?q=${absent.mint}"`)
  expect(html).toContain('not standing on the board')

  // AND THE IDENTITY THE OWNER ASKED FOR IS UNTOUCHED on both: "there can be too
  // many similar image and name", so the mint is the only real identity either
  // of them has, and it stays copyable and linked to the explorer.
  expect(html).toContain(`Copy contract address ${absent.mint}`)
  expect(html).toContain(`href="https://explorer.solana.com/address/${absent.mint}"`)
})

/** The rule is the board's own search predicate, over the WHOLE board rather
 *  than the open tab's rows - so "is this a link" and "will this click find
 *  something" are the same question, asked once. */
test('the ranked link is decided by the board’s own search, over every row', () => {
  const held = project('HELD')
  const shape = buildBoard({
    // The coin holds a position in the OUTBID lane while the reader is on SOLZ
    // RANKED: the row is not in this tab's list, and the link still stands,
    // because the board is what the click filters.
    board: board([entry(4, 'outbid', held.mint, 'HELD')]),
    spots: [],
    standings: new Map(),
    ladder: 'closed',
  })
  expect(boardHolds(shape.rows, held.mint)).toBe(true)
  expect(boardHolds(shape.rows, project('NOPE').mint)).toBe(false)
  // An empty mint is never a link, and never a search for everything.
  expect(boardHolds(shape.rows, '')).toBe(false)
})

/**
 * THE BOARD REPORTS A ROTATION, NEVER A SEASON RECORD.
 *
 * A W-L column stood on every row of CATWALK, and it was the wrong page's fact:
 * the record belongs to MIAW PRIX and is reported in full on its standings
 * table. A second copy here could only be the same number in a narrower column,
 * or - whenever the standings read failed - an em dash beside thirty-five
 * others. CATWALK is about the CHANGE-UP, so the column carries where the
 * position stands in the rotation instead.
 *
 * The record is still SPOKEN in the row's aria-label, where it costs no width.
 */
test('the board column states the rotation, and states no win-loss record', () => {
  const shape = buildBoard({
    board: board([entry(1, 'ranked', MINT_A, '$FOOFIX')]),
    spots: [], ladder: 'closed',
    standings: standings([{ mint: MINT_A, symbol: '$FOOFIX', name: 'Foofix', wins: 4, losses: 1, matches: 5 }]),
  })
  const walking = shape.rows[0]!
  const html = renderToStaticMarkup(<CatwalkSlotRow row={walking} metric="rotation" state="filled" />)
  expect(html).toContain('ROTATION')
  expect(html).toContain('WALKS IN')
  // The figure the standings DID carry is the proof: a row that could have
  // printed 4-1 and did not is a column that changed, not a read that failed.
  expect(html).not.toContain('>RECORD<')
  expect(html).not.toContain('4–1')

  // A position below the runway waits its turn rather than walking, and says so
  // in the same column - so the two bands read as one rotation, not two states.
  const waiting = shape.rows.find((row) => !row.walks)!
  expect(renderToStaticMarkup(<CatwalkSlotRow row={waiting} metric="rotation" state="open" />)).toContain('IN TURN')
})
