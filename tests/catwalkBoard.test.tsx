import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CatwalkApp, CatwalkFooter, CatwalkPanel, CatwalkSearchPanel, searchOutcome,
} from '../src/components/catwalk/CatwalkApp'
import { CatwalkCounter, CatwalkExplain, CatwalkHero } from '../src/components/catwalk/CatwalkHero'
import { CatwalkLadderList, CatwalkSeatRow } from '../src/components/catwalk/CatwalkLadder'
import { CatwalkSlotRow } from '../src/components/catwalk/CatwalkSlotRow'
import { buildBoard, buildLadder, catwalkBands } from '../src/components/catwalk/catwalkBands'
import { CATWALK_TABS, matchedSpots, parseCatwalkQuery, tabRows } from '../src/components/catwalk/catwalkQuery'
import { ladderStateOf } from '../src/components/catwalk/useCatwalkBoard'
import { parseCatwalkBoard, parseGrandPrixStandings, standingsByMint } from '../src/components/solz/catwalkSource'
import type { CatwalkLane, CatwalkSpot } from '../src/components/solz/model'

// Structurally valid base58 that decodes to 32 bytes but belongs to nobody. A
// real mainnet mint as a stand-in (MINT_B used to be Raydium's) invites someone
// to copy a fixture address out of a test and treat it as this product's.
// Prefixes chosen so they appear in no symbol or name used below: the mint-only
// search assertions have to be testing the mint, not colliding with a ticker.
const MINT_A = 'ZqTestM1nt' + 'A'.repeat(34)
const MINT_B = 'YwTestM1nt' + 'B'.repeat(34)

// The fixture tickers are $FOOFIX / $BARFIX: foo-and-bar placeholders nobody can
// mistake for a listing. They used to be $MIAW and $GIGA, and $MIAW is the
// owner's OWN product name (MIAW PRIX) - reading the file, a fixture row looked
// like a coin that had quietly been added to the board. The pair still carries
// the relationships several tests turn on: $BARFIX is P02's ticker AND a word
// inside P01's name, so ticker-over-name ranking has something to rank, and
// neither string shares a prefix with MINT_A / MINT_B so the mint-only search
// assertions are testing the mint.
const entry = (spot: number, lane: CatwalkLane, mint: string, symbol: string, name = symbol, paidUsdMicros?: number) => ({
  spot, mint, lane, active: true,
  team: { mint, symbol, name, logoUrl: 'https://cdn.test/a.png', color: '#ff6ab2' },
  bid: paidUsdMicros ? { usdMicros: paidUsdMicros, wallet: 'Wallet', paidAt: 1, seeded: false } : null,
})

/** An operator's placeholder: an amount, but no signature, wallet or transfer. */
const seededEntry = (spot: number, mint: string, symbol: string, usdMicros = 2_000_000) => ({
  spot, mint, lane: 'outbid' as CatwalkLane, active: true,
  team: { mint, symbol, name: symbol, logoUrl: 'https://cdn.test/a.png', color: '#ff6ab2' },
  bid: { usdMicros, wallet: null, paidAt: null, seeded: true },
})

const board = (lineup: unknown[], activeSlots = 12, lineupSize = 36) => parseCatwalkBoard({
  ok: true, gameKey: 'solz', activeSlots, lineupSize,
  season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 0, endsAt: 1 },
  lineup,
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

/* ── bands ───────────────────────────────────────────────────────────────── */

/**
 * THE BANDS ARE THE ROTATION, AND THEY ARE BANDS OF `activeSlots`.
 *
 * They used to be podium 1-3, grid 4-8, back row 9-12, reserve 13-36 - four
 * tiers of a race that does not exist, and a "reserve" of twenty-four coins
 * described as not taking part. The rotation is the twelve against 13-24, the
 * twelve against 25-36, then the twelve against each other, so the bands are
 * 1-12, 13-24 and 25-36, derived from activeSlots and lineupSize.
 */
test('bands are bands of activeSlots, derived rather than hardcoded', () => {
  expect(catwalkBands(12, 36).map((band) => `${band.key} ${band.start}-${band.end}`)).toEqual([
    'walk 1-12', 'challenge-1 13-24', 'challenge-2 25-36',
  ])
  // Moving the cut moves every band with it, and no slot is left unbanded.
  expect(catwalkBands(8, 36).map((band) => `${band.key} ${band.start}-${band.end}`)).toEqual([
    'walk 1-8', 'challenge-1 9-16', 'challenge-2 17-24', 'challenge-3 25-32', 'challenge-4 33-36',
  ])
  // A final short band is kept at its real length, never padded past the board.
  expect(catwalkBands(8, 36).at(-1)).toMatchObject({ start: 33, end: 36 })
  // Nothing below the cut means no challenge band is drawn.
  expect(catwalkBands(12, 12).map((band) => band.key)).toEqual(['walk'])
  // And the bands say what they DO in the rotation, in no racing words.
  const [walk, first] = catwalkBands(12, 36)
  expect(walk!.label).toBe('THE WALK-IN')
  expect(walk!.note).toBe('TOP 12 — WALKS EVERY ROTATION')
  expect(first!.label).toBe('FIRST CHALLENGE')
  expect(first!.note).toBe('WALKS THE TOP 12 IN ROUND 1')
  expect(first!.walks).toBe(false)
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
  expect(html.match(/class="cw-slot/g)).toHaveLength(36)
  expect(html).not.toContain('cw-run')
  expect(html).not.toContain('SHOW ALL')
  expect(html).not.toMatch(/AND \d+ MORE/)
})

test('the explainer drops the challenge sentence rather than printing an inverted range', () => {
  // activeSlots === lineupSize is permitted by the settings schema, and used to
  // render "13–12 are qualified and waiting", a range describing nobody.
  const full = buildBoard({ board: board([], 12, 12), spots: [], standings: new Map(), ladder: 'closed' })
  const html = renderToStaticMarkup(<CatwalkExplain shape={full} miawPrixHref="/miaw-prix" />)
  expect(html).toContain('Slots 01–12 walk every MIAW PRIX rotation.')
  expect(html).toContain('Every coin on the board walks in.')
  expect(html).not.toContain('13–12')
  expect(html).not.toContain('walk them in turn')

  const banded = buildBoard({ board: board([], 12, 36), spots: [], standings: new Map(), ladder: 'closed' })
  const explain = renderToStaticMarkup(<CatwalkExplain shape={banded} miawPrixHref="/miaw-prix" />)
  expect(explain).toContain('13–36 walk them in turn')
  // Below the cut is one rotation away, said plainly - never a bench.
  expect(explain).toContain('one rotation away, not a bench')
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

  // The counter strip is where the ladder read IS the subject, and there the
  // two states stay apart.
  const counter = renderToStaticMarkup(<CatwalkCounter shape={shape} season={null} ladder="unknown" now={0} />)
  expect(counter).toContain('PRICE UNAVAILABLE')
  expect(counter).not.toContain('SALE CLOSED')
})

/* ── the crown gate ──────────────────────────────────────────────────────── */

test('the crown renders for a champion and a receipt for a coin that paid for the front', () => {
  const championed = renderToStaticMarkup(
    <CatwalkHero shape={launch()} season={{ seasonId: 'solz-01', seasonIndex: 1, startsAt: 0, endsAt: Date.now() + 86_400_000 }} />,
  )
  expect(championed).toContain('cw-crown')
  expect(championed).not.toContain('cw-bought')

  const bought = buildBoard({
    board: board([entry(1, 'outbid', MINT_B, '$BARFIX', '$BARFIX', 4_200_000_000)]),
    spots: ladder(3, { 1: MINT_B }), standings: new Map(), ladder: 'open',
  })
  const html = renderToStaticMarkup(<CatwalkHero shape={bought} season={null} />)
  expect(html).toContain('cw-bought')
  expect(html).not.toContain('cw-crown')
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
  expect(hero).not.toContain('WALK-IN SLOTS CLAIMED')
  expect(hero).not.toContain('OPEN')
  expect(hero).not.toContain('SALE CLOSED')

  const counter = renderToStaticMarkup(<CatwalkCounter shape={unread} season={null} ladder="unknown" pending now={0} />)
  expect(counter).toContain('cw-pending')
  expect(counter).not.toContain('0 / 36')
  expect(counter).not.toContain('0 / 12')
  expect(counter).not.toContain('>0<')

  // And once a read lands on a genuinely empty board, the zero is a fact again.
  const read = buildBoard({ board: board([]), spots: [], standings: new Map(), ladder: 'closed' })
  const resolved = renderToStaticMarkup(<CatwalkHero shape={read} season={null} />)
  expect(resolved).toContain('NOBODY HAS WALKED IN YET')
  expect(resolved).toContain('0 OF 12 WALK-IN SLOTS CLAIMED')
})

/* ── the season is numbered, never keyed ─────────────────────────────────── */

test('the season prints its padded index, never the raw season id', () => {
  const html = renderToStaticMarkup(
    <CatwalkHero shape={launch()} season={{ seasonId: 'solz-00', seasonIndex: 0, startsAt: 0, endsAt: Date.now() + 86_400_000 }} />,
  )
  expect(html).toContain('SEASON 00')
  expect(html).not.toContain('solz-00')

  const counter = renderToStaticMarkup(
    <CatwalkCounter shape={launch()} season={{ seasonId: 'solz-07', seasonIndex: 7, startsAt: 0, endsAt: 0 }} ladder="open" now={0} />,
  )
  expect(counter).toContain('SEASON 07')
  expect(counter).not.toContain('solz-07')
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
  // All 36 numbered positions, three band heads and the walk line exist before
  // any read resolves: the board's shape is known without the network.
  expect(html.match(/class="cw-slot/g)?.length).toBeGreaterThan(12)
  expect(html).toContain('THE WALK-IN')
  expect(html).toContain('FIRST CHALLENGE')
  expect(html).toContain('SECOND CHALLENGE')
  expect(html).toContain('TOP 12 WALK IN EVERY ROTATION')
  expect(html).not.toContain('Loading')
  // And not one racing word survives anywhere on the first frame.
  for (const word of ['PODIUM', 'RESERVE', 'BACK ROW', 'THE GRID', 'RACING', 'RACES']) {
    expect(html).not.toContain(word)
  }
  // But nothing on it counts, headlines or invites while the board is unread.
  expect(html).not.toContain('NOBODY HAS WALKED IN YET')
  expect(html).not.toContain('WALK-IN SLOTS CLAIMED')
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
  expect(html).not.toContain('OPEN SLOT')
  expect(html).not.toContain('>OPEN<')
  expect(html).not.toContain('cw-slot--open')
  expect(html).not.toContain('cw-open-well')
  expect(html).not.toContain('FILLS FROM THE LANES')

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
  expect(html).toContain('SHOW IT ON CATWALK')
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
 * Every tab now draws the same structure: all thirty-six numbers, in their
 * bands, with the walk line under the walk-in band. A lane's own state is a
 * banner above that table, never instead of it.
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
    expect(html).toContain('THE WALK-IN')
    expect(html).toContain('FIRST CHALLENGE')
    expect(html).toContain('SECOND CHALLENGE')
    expect(html).toContain('TOP 12 WALK IN EVERY ROTATION')
  }

  // And the lane's own sentence is still said - as a banner ABOVE the table,
  // never as the whole panel.
  const ranked = renderToStaticMarkup(<CatwalkPanel tab="ranked" shape={empty} ladder="closed" rankedHref="/agent-arena" />)
  expect(ranked).toContain('NOBODY HAS CLIMBED IN YET.')
  expect(ranked).toContain('cw-lane-note')
  expect(ranked).not.toContain('cw-lane-empty')
  // The banner is followed by the table, not substituted for it.
  expect(ranked.indexOf('cw-lane-note')).toBeLessThan(ranked.indexOf('cw-slot'))
})

test('a lane tab marks a position held through another lane as taken, never as open', () => {
  const shape = launch()
  // $BARFIX holds slot 04 through OUTBID; $FOOFIX holds slot 01 as CHAMPION.
  const ranked = renderToStaticMarkup(<CatwalkPanel tab="ranked" shape={shape} ladder="open" />)
  expect(ranked).toContain('cw-slot--other')
  expect(ranked).toContain('TAKEN')
  // The whole table is still there, and the two held positions are NOT drawn as
  // vacancies - advertising a slot somebody is standing in is the one thing a
  // lane lens must never do.
  expect(ranked.match(/class="cw-slot/g)).toHaveLength(36)
  expect(ranked.match(/cw-slot--other/g)).toHaveLength(2)
  // On the whole-table tab there is no lens, so both render as ordinary rows.
  const all = renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" />)
  expect(all).not.toContain('cw-slot--other')
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
  expect(html.match(/class="cw-slot/g)).toHaveLength(36)
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
 * front-of-walk record, the counter's season cell, two band notes, the row's seat
 * action, the footer's second figure and the count line's two. Every one of
 * them was a column gap, a rule or a second line doing its job badly.
 */
test('no rendered surface strings its figures together on middle dots', () => {
  const shape = launch()
  const season = { seasonId: 'solz-07', seasonIndex: 7, startsAt: 0, endsAt: Date.now() + 86_400_000 }
  const surfaces = [
    renderToStaticMarkup(<CatwalkHero shape={shape} season={season} />),
    renderToStaticMarkup(<CatwalkCounter shape={shape} season={season} ladder="open" now={Date.now()} />),
    renderToStaticMarkup(<CatwalkExplain shape={shape} miawPrixHref="/miaw-prix" />),
    renderToStaticMarkup(<CatwalkPanel tab="catwalk" shape={shape} ladder="open" onClaim={() => undefined} />),
    renderToStaticMarkup(<CatwalkPanel tab="outbid" shape={shape} ladder="open" onClaim={() => undefined} />),
    renderToStaticMarkup(<CatwalkFooter pending={false} openCount={34} shape={shape} ladder="open" />),
    renderToStaticMarkup(<CatwalkApp />),
  ]
  for (const html of surfaces) expect(html).not.toContain('·')
})

/**
 * THE PUBLIC BOARD IS THE LAUNCH STATE: A SEEDED HOLDER DRAWS AS A HELD SEAT.
 *
 * The owner's call. The board opens with the initial teams already standing on
 * it, presented as ordinary holders, and a real outbid takes a seat over when
 * one arrives. So `seeded` no longer changes one pixel of the public row - not
 * the metric, not the accessible name.
 *
 * What it still changes is the OPERATOR's view. The `seeded` column, the
 * migration CHECKs that stop a seeded row carrying a signature or a paid_at,
 * the seed script's production refusals and the admin panel's "seeded — not a
 * payment" all stand, because an operator has to be able to see which seats are
 * still placeholders. This test pins both halves: identical public rendering,
 * and the flag arriving intact through `parseCatwalkBoard` and `buildBoard` so
 * that surface can keep reading it.
 */
test('a seeded holder renders as a paid holder, and the seeded flag still survives the read', () => {
  // Same amount on both rows, so "renders the same" is a comparison and not a
  // pair of separate assertions that could drift apart.
  const shape = buildBoard({
    board: board([seededEntry(1, MINT_A, '$SEEDFIX'), entry(2, 'outbid', MINT_B, '$PAIDFIX', '$PAIDFIX', 2_000_000)]),
    spots: [], outbidSpots: 0, standings: new Map(), standingsState: 'read', ladder: 'closed',
  })
  const seeded = shape.rows.find((r) => r.entry?.mint === MINT_A)!
  const paid = shape.rows.find((r) => r.entry?.mint === MINT_B)!

  // The flag survives the adapter and the board builder. This is the half the
  // operator surface depends on, and it is the reason the test still exists.
  expect(shape.rows.find((r) => r.entry?.mint === MINT_A)!.entry!.seeded).toBe(true)
  expect(shape.rows.find((r) => r.entry?.mint === MINT_B)!.entry!.seeded).toBe(false)
  expect(seeded.seeded).toBe(true)
  expect(paid.seeded).toBe(false)
  expect(seeded.paidUsdMicros).toBe(2_000_000)
  expect(paid.paidUsdMicros).toBe(2_000_000)

  const render = (row: typeof seeded) => renderToStaticMarkup(
    <CatwalkSlotRow row={row} metric="take" state="filled" ladder="open" />,
  ).replaceAll('<!-- -->', '')
  const seededHtml = render(seeded)
  const paidHtml = render(paid)

  // The visible metric: the same word and the same figure, byte for byte.
  const label = (html: string) => html.match(/PAID [^<]*/)?.[0]
  expect(label(seededHtml)).toBe('PAID $2')
  expect(label(paidHtml)).toBe('PAID $2')

  // And the accessible name, which is the copy screen readers get.
  const spoken = (html: string) => html.match(/, paid \$[^,"]*/)?.[0]
  expect(spoken(seededHtml)).toBe(', paid $2')
  expect(spoken(paidHtml)).toBe(', paid $2')

  // The old public-facing seeded vocabulary is gone from both rows entirely.
  for (const html of [seededHtml, paidHtml]) {
    expect(html).not.toContain('SEEDED')
    expect(html).not.toContain('not paid for')
    expect(html).not.toContain('No payment was made')
  }
})
