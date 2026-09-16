import '../../styles/home.css'
import '../../styles/catwalk.css'
import { ArrowUpRight, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AppShell } from '../solz/AppShell'
import { DEFAULT_CATWALK_EXPLORER, usdLabel, type CatwalkRankedLaneRead, type CatwalkSeatPlan } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { Tabs, TabPanel } from '../solz/ui'
import {
  bandRange, buildBoard, cheapestSeat, pad, seatHeld,
  type CatwalkBoardShape, type CatwalkLadderSeat, type CatwalkRow, type LadderState,
} from './catwalkBands'
import {
  // NO `boardSearchLayer`. The left board's dim/match layer is derived by
  // `catwalkBoardLayer` and nowhere else, so this file has no way to hand the
  // layer a tab-filtered list of rows - which is the regression that made the
  // whole board fade out on a tab click. `tabRows` stays because the tab COUNTS
  // are a genuinely per-lane figure.
  CATWALK_NARROW, CATWALK_TABS, catwalkBoardLayer, isCatwalkTab, matchedSpots, parseCatwalkQuery, tabRows,
  type CatwalkPanelId, type CatwalkQuery, type CatwalkTab,
} from './catwalkQuery'
import {
  CatwalkBandHead, CatwalkSlotRow, CatwalkSlotSkeleton, CatwalkWalkLine, LaneNote,
  type CatwalkMetric, type CatwalkRowState,
} from './CatwalkSlotRow'
import { CatwalkComposition } from './CatwalkComposition'
import { CatwalkRankedRail } from './CatwalkRankedRail'
import { CatwalkChampionRail } from './CatwalkChampionRail'
import { CatwalkOutbidList, type ClaimHandler } from './CatwalkLadder'
import { buildOutbidList } from './catwalkOutbid'
import { CatwalkHero } from './CatwalkHero'
import { CatwalkClock } from './CatwalkLockFace'
import { useNarrow } from '../miawprix/ProgrammeLayout'
import { nextCatwalkLock, type CatwalkLock } from './catwalkLock'
import { useCatwalkBoard } from './useCatwalkBoard'
import { useCatwalkCycles } from './useCatwalkCycles'
import { CatwalkCycleBanner, CatwalkCyclePicker } from './CatwalkCyclePicker'
import { resolvedTokenLogo } from '../solz/tokenIcon'
import { overlayTokenMeta, useTokenMeta } from '../solz/tokenMeta'
import { CatwalkClaimDialog } from './CatwalkClaimDialog'

/**
 * CATWALK - the table the top twelve walk every MIAW PRIX rotation.
 *
 * THE LEFT BOARD IS THE SAME BOARD ON EVERY TAB. Not "the same structure" and
 * not "the same rows in a different state" - byte for byte the same markup. A
 * tab changes the RIGHT RAIL and nothing else, which is the one promise this
 * screen makes and the one thing tests/catwalkBoard.test.tsx proves outright.
 *
 * It got there in three steps, each of which was the owner rejecting a screen.
 * First a lane tab drew ONLY its own lane's rows, so SOLZ RANKED with nothing in
 * it rendered a single centred card over a dashed box and no numbered positions
 * at all. Then every tab drew all thirty-six but looked at them through a LENS,
 * so choosing a lane repainted two thirds of the board as TAKEN - still a board
 * that changed under a reader who had only asked what a lane was. Now the lens
 * is gone from this panel: the board is one list of numbered positions, drawn
 * once, and the explaining happens beside it.
 *
 * A slot number is absolute identity in every tab, which is why an open slot is
 * a first-class row rather than a gap, and why search dims rather than removes.
 *
 * COLOUR FOLLOWS THE LANE. A row is tinted by how its coin arrived - OUTBID,
 * CHAMPION, RANKED - and the same lane carries the same colour in the rows, the
 * band heads and the tab row. Position is the number chip and the band; it is
 * never a hue.
 *
 * THE BOARD IS NOT THE SALE. Board positions are 1..lineupSize in lane-priority
 * order; the spot ladder is its own list of seats in the sale's own numbering.
 * OUTBID shows that ladder. No row on the board carries a price for a vacancy,
 * because a vacancy is a position and positions are not sold.
 *
 * AND NOTHING IS STATED BEFORE IT IS READ. Every count, every vacancy, every
 * verdict about the ladder waits for the read that produces it. Until then the
 * page draws the board's structure - bands, numbers, the walk line - as
 * skeletons of the size the rows will occupy, and says nothing.
 */

/** THE FIRST TAB IS THE PROGRAMME, NOT THE PAGE. The whole numbered board IS
 *  the MIAW PRIX field - its top `activeSlots` walk every rotation and the rest
 *  walk them in turn - so the tab that shows all of it is named for the thing it
 *  shows. Labelling it CATWALK named the page the viewer was already on. The tab
 *  ID stays 'catwalk' because it is this page's URL vocabulary (`?lane=`), and
 *  renaming it would break every deep link already in the wild. */
const TAB_LABEL: Record<CatwalkPanelId, string> = {
  catwalk: 'MIAW PRIX', outbid: 'OUTBID', ranked: 'SOLZ RANKED', champions: 'CHAMPIONS', agents: 'AGENTS',
  // Only ever rendered below the split breakpoint - see `panels` in CatwalkApp.
  info: 'INFO',
}

/** Which lane colour a tab wears. The table itself and the not-yet-scheduled
 *  agents lane wear none, because neither is a lane a coin can arrive through. */
const TAB_LANE: Partial<Record<CatwalkPanelId, string>> = {
  outbid: 'outbid', champions: 'champion', ranked: 'ranked',
}

/* THE LINE UNDER THE TAB ROW IS GONE. A TAB_SUB table stood here and printed
   one sentence per tab directly beneath the tabs - "COINS THAT CLIMBED IN.
   NOTHING PAID." and its four siblings. Every one of them is said again, at
   more length, either on the rail the tab opens or in the band heads a
   centimetre below; it cost a row above the board to restate what the next
   thing on screen already says. Nothing is lost with it, and the toolbar now
   sits directly on the board, which is what lets it stick cleanly. */

/** The one line under the outbid list's head. It states what the SALE is doing,
 *  which is the only thing about that list the ladder's state changes: the coins
 *  standing on the board are there whether or not anyone can buy one. */
const LADDER_NOTE: Record<LadderState, string> = {
  open: 'A PRICE MEANS THE SEAT IS PUBLISHED AND CAN BE TAKEN NOW',
  closed: 'BIDDING IS CLOSED — THESE COINS KEEP THEIR SLOTS',
  unknown: 'THE LADDER COULD NOT BE READ — NO PRICE HERE IS A CLAIM ABOUT THE SALE',
}

/**
 * What the RIGHT RAIL is, per tab, for the landmark that wraps it.
 *
 * The `<aside>` carried 'Take a slot' on every tab it appeared on. That is a
 * commerce label, and on three of the four tabs it named something that is not
 * for sale: a screen reader announced a sales rail over an explanation of what
 * winning a champion slot means.
 *
 * A TAB_METRIC table used to stand here, choosing which figure the board's
 * metric column printed per tab - a record on MIAW PRIX, an ask on OUTBID, a
 * lane name on SOLZ RANKED. It is gone with the lens: the board prints the same
 * column on every tab because it IS the same board, and a column that changed
 * under the reader was the last thing making the left side look tab-dependent.
 */
const RAIL_LABEL: Record<CatwalkPanelId, string> = {
  catwalk: 'How the list is composed',
  outbid: 'Take a slot',
  ranked: 'What the SOLZ ranked lane is',
  champions: 'What the champion lane is',
  agents: 'What the agent lane is',
  // The narrow-width tab that IS the composition rail, so it is named for the
  // same thing the MIAW PRIX rail is named for.
  info: 'How the list is composed',
}

type Props = {
  /** Same-origin proxy. Injected rather than built here, per the adapter rule. */
  endpoint?: string
  /** Where the MIAW PRIX programme lives. The hero's kicker links the season's
   *  name to it; it no longer feeds an explainer cell. */
  miawPrixHref?: string
  rankedHref?: string
  /**
   * Where a coin's symbol links.
   *
   * It defaults to this board's own deep link for that mint - the coin's own
   * row, found by contract address - because that page exists and is about that
   * coin. A host with a real per-coin page passes its own. What it must not do
   * is guess a route this repo does not serve.
   */
  coinHref?: (mint: string) => string
  /** The chain contract-address links are built against, when the host knows
   *  better than the board's own payload. */
  explorer?: ExplorerVenue | null
  /**
   * A HOST THAT WANTS TO OWN THE CLAIM ITSELF.
   *
   * Without it this app opens its OWN dialog - the one that issues a quote and
   * publishes the payment instructions, with no wallet connection anywhere in
   * it. src/pages/catwalk.astro cannot pass this: Astro serializes island props
   * and a function will not cross, which is why every claim control was dead
   * with "the wallet flow is not wired up yet" written on it.
   *
   * A claim takes a LADDER SEAT, because a seat is the only thing on sale.
   */
  onClaim?: ClaimHandler
}

/** A band of the rotation, ready to render.
 *
 *  It carries no colour. A band is a POSITION range, and position is the number
 *  chip and this head - never a hue. Only a head that names a LANE takes a
 *  colour, and the one head that does (the spot ladder's) sets it itself. */
type Group = {
  key: string
  head?: { label: string; range?: string; note: string; walks?: boolean }
  rows: CatwalkRow[]
  walkLineAfter?: boolean
}

type ListProps = {
  groups: Group[]
  metric: CatwalkMetric
  shape: CatwalkBoardShape
  ladder: LadderState
  dimmed: (row: CatwalkRow) => boolean
  matched: (row: CatwalkRow) => boolean
  crowned: boolean
  onLadder?: () => void
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  /** Filter the board in place instead of reloading the page it is on. */
  onCoin?: (mint: string) => void
  /** The lane this tab looks through, or null for the whole table. A held row
   *  outside the lens renders 'other' - taken, and plainly not through this
   *  lane - which is what lets a lane tab show every numbered position without
   *  drawing an occupied one as a vacancy. */
  lens?: string | null
}

/**
 * THE STRUCTURE, WHICH IS THE SAME ON EVERY TAB.
 *
 * Bands of the rotation, every numbered position inside them, the walk line
 * under the walk-in band. It does NOT take a tab: lane tabs used to build a
 * different, bandless group holding only their own rows, so a lane with nothing
 * in it produced a group with nothing in it and the whole numbered table
 * vanished behind a centred card. The lane a tab looks through is a LENS over
 * these rows (see `tabLens`), never a smaller list of them.
 */
export function catwalkGroups(shape: CatwalkBoardShape): Group[] {
  const walkIn = shape.bands.find((band) => band.walks)
  const hasChallenge = shape.bands.some((band) => !band.walks)
  return shape.bands.map((band) => ({
    key: band.key,
    head: { label: band.label, range: bandRange(band), note: band.note, walks: band.walks },
    rows: shape.rows.filter((row) => row.spot >= band.start && row.spot <= band.end),
    walkLineAfter: hasChallenge && band === walkIn,
  }))
}

/** The board, once it has been read. Every row in here states that a position
 *  is vacant or who is standing in it, so this component is never rendered
 *  while the board is pending - `SkeletonList` stands in its place. */
function SlotList(props: ListProps) {
  const { groups, metric, shape, ladder, dimmed, matched, crowned, lens } = props
  // Which state a numbered position renders in, under this tab's lens. Three
  // outcomes, and the third is the point: a position held through ANOTHER lane
  // is neither this lane's row nor an open slot, and drawing it as the latter
  // would advertise a position somebody is standing in.
  const stateOf = (row: CatwalkRow): CatwalkRowState =>
    row.lane === 'open' ? 'open' : !lens || row.lane === lens ? 'filled' : 'other'
  return (
    <>
      {groups.map((group) => (
        <div className="cw-band" key={group.key}>
          {group.head ? <CatwalkBandHead label={group.head.label} range={group.head.range} note={group.head.note} walks={group.head.walks} /> : null}
          {/* EVERY POSITION, AT FULL HEIGHT. Runs of vacancies used to collapse
              into a strip of number chips behind a SHOW ALL control, which on
              an empty board - the state this one launches in - hid most of the
              structure it exists to show. */}
          <ol>
            {group.rows.map((row) => (
              <CatwalkSlotRow
                key={row.spot}
                row={row}
                metric={metric}
                state={stateOf(row)}
                dim={dimmed(row)}
                matched={matched(row)}
                ladder={ladder}
                crown={crowned && row.lane === 'champion'}
                onLadder={props.onLadder}
                coinHref={props.coinHref}
                explorer={props.explorer}
                onCoin={props.onCoin}
              />
            ))}
          </ol>
          {group.walkLineAfter ? <CatwalkWalkLine activeSlots={shape.activeSlots} /> : null}
        </div>
      ))}
    </>
  )
}

/**
 * The board before anything has been read.
 *
 * Same bands, same numbers, same walk line, same row height - and not a claim.
 * No vacancy, no run summary, no count of how many are open, and no verdict on
 * a ladder read that has not been attempted. Runs are deliberately NOT collapsed
 * here: collapsing is itself a statement that those positions are vacant.
 */
function SkeletonList({ groups, shape }: { groups: Group[]; shape: CatwalkBoardShape }) {
  return (
    <>
      {groups.map((group) => (
        <div className="cw-band" key={group.key}>
          {group.head ? <CatwalkBandHead label={group.head.label} range={group.head.range} note={group.head.note} walks={group.head.walks} /> : null}
          <ol>{group.rows.map((row) => <CatwalkSlotSkeleton key={row.spot} spot={row.spot} />)}</ol>
          {group.walkLineAfter ? <CatwalkWalkLine activeSlots={shape.activeSlots} /> : null}
        </div>
      ))}
    </>
  )
}

/* `LaneNote` now lives beside the band head and the walk line in
   CatwalkSlotRow.tsx. Three rails render one and this file imports all three, so
   it could not stay here without an import cycle. */

/** A pasted contract address is long enough to break the layout, so it is shown
 *  head and tail. Shared by both search outcomes so they echo identically. */
const echoQuery = (raw: string) => (raw.length > 12 ? `${raw.slice(0, 4)}…${raw.slice(-4)}` : raw)

/** Where a board ROW is found. OUTBID is the ladder rather than a filter of the
 *  board, so an outbid holder's row - like a vacancy - is found on CATWALK. */
const LANE_TAB: Record<CatwalkRow['lane'], CatwalkTab> = {
  outbid: 'catwalk', champion: 'champions', ranked: 'ranked', open: 'catwalk',
}

const LANE_SPOKEN: Record<CatwalkRow['lane'], string> = {
  outbid: 'OUTBID', champion: 'CHAMPION', ranked: 'RANKED', open: 'open',
}

/**
 * A hit that is on the board, just not in the lane being looked at.
 *
 * NOT a miss, and never a funnel. The miss used to be computed from the ACTIVE
 * TAB's filtered rows while `SearchMiss` makes a whole-board claim, so searching
 * $GIGA on CHAMPIONS printed "THAT COIN IS NOT ON THE BOARD YET" and up-sold a
 * ladder seat - contradicted by the page's own CATWALK tab, where $GIGA stands
 * at slot 04. A holder who already has a slot is never sold another one.
 */
function SearchElsewhere({ raw, row, onLane }: {
  raw: string; row: CatwalkRow; onLane: (tab: CatwalkTab) => void
}) {
  const symbol = row.entry?.team?.symbol ?? null
  const where = LANE_TAB[row.lane]
  return (
    <div className="cw-miss cw-miss--elsewhere">
      <strong>{symbol ?? `SLOT ${pad(row.spot)}`} IS ON THE BOARD, JUST NOT IN THIS LANE.</strong>
      <code>{echoQuery(raw)}</code>
      <p>
        {row.lane === 'open'
          ? `Slot ${pad(row.spot)} is an open position, so it stands in no lane yet.`
          : `It holds slot ${pad(row.spot)} in the ${LANE_SPOKEN[row.lane]} lane.`}
      </p>
      <div>
        <button type="button" className="cw-act" onClick={() => onLane(where)}>SHOW IT ON {TAB_LABEL[where]}</button>
      </div>
    </div>
  )
}

/** A miss is a funnel, never a shrug. A holder pasting their own contract
 *  address is the highest-intent moment on this page.
 *
 *  What it offers is a LADDER SEAT, because that is the thing that is for sale.
 *  It used to offer "the cheapest open slot 07", which was a board position
 *  priced off a seat that shares its number and may belong to someone else.
 *
 *  Only ever rendered for a WHOLE-BOARD miss: the headline is a claim about the
 *  board, not about the lane the viewer happens to be standing in. */
function SearchMiss({ raw, shape, ladder, onClaim, claimReason, rankedHref }: {
  raw: string; shape: CatwalkBoardShape; ladder: LadderState; onClaim?: ClaimHandler; claimReason?: string; rankedHref: string
}) {
  const seat = ladder === 'open' ? cheapestSeat(shape.seats) : null
  return (
    <div className="cw-miss">
      <strong>THAT COIN IS NOT ON THE BOARD YET.</strong>
      <code>{echoQuery(raw)}</code>
      <p>
        {seat
          ? `The cheapest seat on the spot ladder is seat ${pad(seat.seat)} at ${usdLabel(seat.askUsdMicros)}.`
          : ladder === 'closed'
            ? `${shape.lineupSize} slots, ${shape.claimed} claimed. The spot ladder reopens next season.`
            : ladder === 'unknown'
              ? `${shape.lineupSize} slots, ${shape.claimed} claimed. The spot ladder could not be read just now.`
              : `${shape.lineupSize} slots, ${shape.claimed} claimed. Nothing on the ladder is open right now.`}
      </p>
      <div>
        {seat
          ? <button
              type="button"
              className="cw-act cw-act--claim"
              disabled={!onClaim}
              title={onClaim ? undefined : claimReason}
              onClick={() => onClaim?.(seat)}
            >TAKE SEAT {pad(seat.seat)} — {usdLabel(seat.askUsdMicros)}</button>
          : null}
        <a className="cw-act" href={rankedHref}>HOW TO QUALIFY FREE<ArrowUpRight size={12} aria-hidden="true" /></a>
      </div>
    </div>
  )
}

export type CatwalkSearchOutcome =
  /** The lane being looked at has matches; the list renders them. */
  | { kind: 'hits'; raw: string }
  /** Nothing on the WHOLE BOARD matches. Only this may say "not on the board". */
  | { kind: 'miss'; raw: string }
  /** On the board, filtered out of this lane. Points, never sells. */
  | { kind: 'elsewhere'; raw: string; row: CatwalkRow }

/**
 * THE ONE PLACE A SEARCH RESULT IS JUDGED.
 *
 * Two different questions were being confused: "does anything in THIS LANE
 * match" (a filter) and "does anything on THE BOARD match" (a whole-board
 * claim). The miss was computed from the tab's filtered rows while `SearchMiss`
 * makes the second claim, so searching $GIGA on CHAMPIONS printed "THAT COIN IS
 * NOT ON THE BOARD YET" and up-sold a ladder seat off that false premise - with
 * $GIGA standing at slot 04 on the page's own CATWALK tab. Both lists are answered
 * here, so the two can no longer be substituted for one another.
 */
export function searchOutcome(
  query: CatwalkQuery,
  rows: readonly CatwalkRow[],
  visible: readonly CatwalkRow[],
): CatwalkSearchOutcome {
  const raw = query.kind === 'none' ? '' : query.raw
  if (query.kind === 'none') return { kind: 'hits', raw }
  if (matchedSpots(visible, query).length) return { kind: 'hits', raw }
  const board = matchedSpots(rows, query)
  const row = board.length ? rows.find((candidate) => candidate.spot === board[0]) ?? null : null
  return row ? { kind: 'elsewhere', raw, row } : { kind: 'miss', raw }
}

/** Renders whichever sentence `searchOutcome` reached, and nothing at all when
 *  the lane has hits of its own. */
export function CatwalkSearchPanel({ outcome, shape, ladder, onLane, onClaim, claimReason, rankedHref }: {
  outcome: CatwalkSearchOutcome
  shape: CatwalkBoardShape
  ladder: LadderState
  onLane: (tab: CatwalkTab) => void
  onClaim?: ClaimHandler
  claimReason?: string
  rankedHref: string
}) {
  if (outcome.kind === 'hits') return null
  if (outcome.kind === 'elsewhere') return <SearchElsewhere raw={outcome.raw} row={outcome.row} onLane={onLane} />
  return <SearchMiss raw={outcome.raw} shape={shape} ladder={ladder} onClaim={onClaim} claimReason={claimReason} rankedHref={rankedHref} />
}

/**
 * The invitation, which is the loudest count on the page.
 *
 * Its sentence is THREE-valued because the ladder is. `ladder !== 'open'` folded
 * an unreadable ladder into a closed one, so a 502 from the proxy printed
 * "Nothing on the ladder is buyable right now" directly beneath "THE SPOT LADDER
 * COULD NOT BE READ" - the exact collapse of unknown into closed that
 * useCatwalkBoard.ts and catwalkBands.ts exist to prevent. Under 'unknown' this
 * makes no claim about whether anything is for sale, because nobody has read it.
 */
export function CatwalkFooter({ pending, openCount, shape, ladder }: {
  pending: boolean; openCount: number; shape: CatwalkBoardShape; ladder: LadderState
}) {
  if (pending) {
    return (
      <div className="cw-footer">
        <strong><i className="cw-pending cw-pending--line" aria-hidden="true" /></strong>
        <small><i className="cw-pending cw-pending--line" aria-hidden="true" /></small>
      </div>
    )
  }
  if (shape.claimed / Math.max(1, shape.lineupSize) >= 0.5) return null
  return (
    <div className="cw-footer">
      {/* Two figures, two lines. They used to be one sentence joined by a
          middle dot, which read as one claim and was two. */}
      <strong>
        <span>{openCount} SLOTS OPEN</span>
        {ladder === 'open' && shape.openSeatUsdMicros > 0
          ? <span><b>{usdLabel(shape.openSeatUsdMicros)}</b> OF LADDER SEATS UNSOLD</span>
          : null}
      </strong>
      <small>
        {ladder === 'unknown'
          ? 'Open positions fill from the lanes that qualify coins. Whether any ladder seat is for sale could not be read just now.'
          : ladder === 'open' && shape.floorUsdMicros
            ? 'Take a seat at the floor. No auction, no waiting — the floor is the price until someone pays it.'
            : 'Open positions fill from the lanes that qualify coins. Nothing on the ladder is buyable right now.'}
      </small>
    </div>
  )
}

/**
 * THE SPLIT ITSELF, AND THE PAGE'S ONE CLOCK - built in exactly one place.
 *
 * THIS MARKUP USED TO BE WRITTEN THREE TIMES: once in CatwalkPanel for the read
 * board, once for the pending frame and once for the search miss, each with its
 * own `<div className="cw-split">`, its own `<aside>`, and its own mount of the
 * countdown. Three copies of one frame is three places to forget the clock, and
 * exactly that happened - deleting the countdown from the search-miss copy left
 * the whole suite green, because no test could reach that copy. There is one
 * copy now and one `<CatwalkClock>` in this file, so the frame cannot disagree
 * with itself and a deletion cannot hide in the branch nobody renders.
 *
 * WHERE THE CLOCK SITS IS A WIDTH QUESTION, NOT A TAB QUESTION.
 *
 * At >= 1280px the rail is a sticky column beside the board and the clock is
 * its head, which is on screen for the whole scroll. Below that breakpoint the
 * split collapses to one column and the rail follows the board, so the clock -
 * the one thing on this page a holder acts on - landed roughly two thousand
 * pixels down: thirty-six rows at 56px, three band heads and the hero, on the
 * tab a reader LANDS on. The stylesheet's `order: -1` rescue only ever covered
 * OUTBID and INFO, so MIAW PRIX, SOLZ RANKED and CHAMPIONS still buried it.
 *
 * So below the breakpoint the clock leaves the rail and becomes a child of the
 * split in its own right, ordered ahead of both columns. It is NOT the whole
 * rail that moves: hoisting the rail would push the board itself below the fold
 * on the landing tab, which is the argument catwalk.css makes for leaving the
 * legend where it is. Only the clock moves, because only the clock is a fact
 * about the page rather than about the lane.
 *
 * IT IS STILL ONE INSTANCE. Not one per breakpoint hidden with `display:none` -
 * two countdowns of one instant, one of them announced to a screen reader on a
 * width where it is invisible. `narrow` answers false until the browser does, so
 * the server and the first paint render the desktop arrangement.
 *
 * THE BOARD IS FIRST IN THE DOM AT EVERY WIDTH. The clock is a single short box
 * ahead of it; the rail stays after it and is moved on screen by `order` alone,
 * so a reader tabbing through still reaches the numbered table before whatever
 * is explaining it.
 */
export function CatwalkSplit({ tab, lock, leadMs, narrow = false, board, rail }: {
  tab: CatwalkPanelId
  /** The page's single lock memo. 'unread' draws the pending face, so the first
   *  paint needs no separate branch and no second component. */
  lock: CatwalkLock
  /** The server's own lock lead, so the clock states the rule the board keeps
   *  rather than a hardcoded twelve hours. */
  leadMs?: number | null
  narrow?: boolean
  board: ReactNode
  rail: ReactNode
}) {
  const clock = <CatwalkClock lock={lock} leadMs={leadMs} />
  return (
    <div className="cw-split" data-rail={tab}>
      {narrow ? <div className="cw-split-clock">{clock}</div> : null}
      <div className="cw-split-board">{board}</div>
      <aside className="cw-split-rail" aria-label={RAIL_LABEL[tab]}>
        {narrow ? null : clock}
        {rail}
      </aside>
    </div>
  )
}

/**
 * ONE TAB'S PANEL, ONCE THE BOARD HAS BEEN READ.
 *
 * ONE SHAPE, EVERY TAB: the MIAW PRIX board on the left, a rail that explains
 * something on the right. It is exported so the promise it makes is testable on
 * its own, and the promise is now stronger than "every tab renders the whole
 * table" - it is that the LEFT COLUMN IS BYTE-IDENTICAL on every tab.
 *
 * That is why the board takes no `tab`. It used to take three things from one:
 * a metric per tab, a crown on CHAMPIONS, and a lane LENS that repainted every
 * row outside the lane as TAKEN. All three made the left column change when a
 * reader clicked a tab to ask what a lane WAS - "what change is not left side,
 * but right side", in the owner's words. The board draws its record column, no
 * crown and no lens, always.
 *
 * WHAT THAT COSTS, STATED RATHER THAN HIDDEN. `SlotList`'s `lens` prop and the
 * `cw-slot--other` row it draws are now unreachable from this panel. Both are
 * left standing: they are a working render state, CatwalkSearchPanel's callers
 * can still ask for them, and deleting a working state to make a diff tidy is
 * not what was asked for. The Crown at CatwalkSlotRow.tsx is unreachable from
 * here for the same reason and stays for the same one.
 *
 * THE THREE BRANCHES THAT USED TO BE HERE ARE GONE. CATWALK returned a split,
 * OUTBID returned a DIFFERENT split with the list leading and the board second,
 * and every other tab returned a bare banner-over-table with no rail at all. So
 * the board moved, changed width and changed DOM position as the reader moved
 * between tabs - which is the "annoyingly bad" screen. One shape now, and only
 * `rail()` reads the tab.
 */
export function CatwalkPanel({
  tab, shape, ladder, dimmed = () => false, matched = () => false,
  onLadder, onClaim, claimReason, coinHref, explorer, onCoin, logoFor,
  configuredSeats, closedReason, narrow = false,
  seats = null, rankedLane = null, lastSeatPaidAt = null, lock = { state: 'unread' }, now = 0, leadMs = null,
}: {
  tab: CatwalkPanelId
  shape: CatwalkBoardShape
  ladder: LadderState
  /** The server's own lock lead. Handed to the clock so its copy states the
   *  rule this board keeps rather than a hardcoded twelve hours. */
  leadMs?: number | null
  /** Whether the split has collapsed to one column - passed through to
   *  `CatwalkSplit`, which is the only thing that reads it. Defaults to the
   *  desktop arrangement, which is what the server renders. */
  narrow?: boolean
  dimmed?: (row: CatwalkRow) => boolean
  matched?: (row: CatwalkRow) => boolean
  onLadder?: () => void
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  /** A coin click filters the board IN PLACE. Optional with no default, so a
   *  panel rendered without it keeps every anchor's own navigation. */
  onCoin?: (mint: string) => void
  /** The ranked rail's crest resolver. See `logoFor` in CatwalkApp. */
  logoFor?: (mint: string, boardLogo?: string | null) => string | undefined
  /* NO `rankedHref`. The only thing in this panel that used it was the SOLZ
     RANKED rail's VIEW RANKED LADDER control, and that control now points at
     the real leaderboard on another site. HOW TO QUALIFY FREE still takes the
     prop - it is a DIFFERENT destination - and it lives in the search miss,
     which CatwalkApp renders itself. A prop this panel accepted and ignored
     would read as though it still steered something here. */
  configuredSeats?: number
  closedReason?: string
  /** The guaranteed seat plan, straight off the wire. Null when the server did
   *  not send a whole readable one, and the rail then omits the guarantee
   *  rather than quoting a figure this repo remembered. */
  seats?: CatwalkSeatPlan | null
  rankedLane?: CatwalkRankedLaneRead | null
  /** When a seat was last paid for, epoch ms, or null. A board-wide aggregate;
   *  never a per-coin purchase time. */
  lastSeatPaidAt?: number | null
  /** The page's single lock memo and the page's single clock, handed down. The
   *  rail head renders the one clock on this page from it; a rail deriving its
   *  own would print NO ROTATION IS SCHEDULED YET over a failed read. */
  lock?: CatwalkLock
  now?: number
}) {
  /**
   * THE WHOLE NUMBERED TABLE. One call site, and it takes no tab at all, so no
   * tab can render a different left column from any other.
   */
  const table = (
    <SlotList
      groups={catwalkGroups(shape)}
      metric="rotation"
      shape={shape}
      ladder={ladder}
      dimmed={dimmed}
      matched={matched}
      crowned={false}
      onLadder={onLadder}
      coinHref={coinHref}
      explorer={explorer}
      onCoin={onCoin}
    />
  )

  /**
   * THE OUTBID LIST, BUILT ONCE.
   *
   * It is the subject of the OUTBID tab, and it is a rail there rather than a
   * column of its own. It used to render on the CATWALK tab as well; the right
   * side of that tab is now what the list is made OF rather than what it costs,
   * which is what the owner asked for, and the price list is one click away on
   * the tab named after it.
   */
  const outbidList = (
    <CatwalkOutbidList
      rows={buildOutbidList(shape, ladder)}
      note={LADDER_NOTE[ladder]}
      onClaim={onClaim}
      claimReason={claimReason}
      coinHref={coinHref}
      explorer={explorer}
      onLadder={onLadder}
      onCoin={onCoin}
    />
  )

  // WHAT THE SALE IS DOING, said once above a list that renders either way.
  //
  // Only a ladder that ANSWERED may be reported shut. An unreadable one is its
  // own sentence: a 502 from the proxy is not a closed sale, and announcing one
  // shut the whole board's pricing over a blip.
  const note = ladder === 'closed'
    ? <LaneNote
        lane="outbid"
        title={closedReason === 'program_disabled' ? 'OUTBID IS NOT ENABLED YET.' : closedReason === 'lane_disabled' ? 'OUTBID IS DISABLED.' : 'THE SPOT LADDER IS CLOSED BETWEEN SEASONS.'}
        body={`Bidding requires an enabled Outbid lane and a live season.${configuredSeats ? ` ${configuredSeats} ${configuredSeats === 1 ? 'seat is' : 'seats are'} configured for when it opens.` : ''} Every coin standing on the board is still listed below.`}
      />
    : ladder === 'unknown'
      ? <LaneNote lane="outbid" title="THE SPOT LADDER COULD NOT BE READ." body="Prices are unavailable for the moment. This page retries on its own; nothing about the sale has changed." />
      : !shape.seats.length
        ? <LaneNote lane="outbid" title="THE LADDER IS PUBLISHING NO SEATS." body="The sale is open but carries no positions at the moment." />
        : null

  /**
   * THE ONLY THING A TAB CHANGES.
   *
   * 'agents' falls to the composition legend rather than carrying a rail of its
   * own: it is in the CatwalkTab union but not in CATWALK_TABS, so the tab never
   * renders and a lane rail for it would be a screen nobody can reach.
   */
  const rail = (id: CatwalkPanelId) =>
    id === 'outbid' ? <>{note}{outbidList}</>
      : id === 'ranked' ? <CatwalkRankedRail
            shape={shape}
            rankedLane={rankedLane}
            explorer={explorer}
            coinHref={coinHref}
            onCoin={onCoin}
            logoFor={logoFor}
          />
        : id === 'champions' ? <CatwalkChampionRail shape={shape} />
          // 'info' falls through with 'catwalk' and 'agents': it IS the
          // composition rail, shown as a tab at the widths where the rail is not
          // a column. No new branch, and no second copy of the legend.
          : <CatwalkComposition
              shape={shape}
              seats={seats}
              rankedLane={rankedLane}
              ladder={ladder}
              lastSeatPaidAt={lastSeatPaidAt}
              leadMs={leadMs}
              now={now}
            />

  // THE FRAME IS NOT BUILT HERE. `CatwalkSplit` owns the split markup, the one
  // clock and where that clock sits at a given width, so this panel and the two
  // frames CatwalkApp renders itself cannot drift apart - which is what let a
  // missing countdown sit unnoticed in the search-miss copy.
  return <CatwalkSplit tab={tab} lock={lock} leadMs={leadMs} narrow={narrow} board={table} rail={rail(tab)} />
}

export function CatwalkApp({
  endpoint = '/api/agent-arena',
  miawPrixHref = '/miaw-prix',
  rankedHref = '/agent-arena',
  // A coin's own section on this site is its row on this board, reached by
  // contract address. It is a real route this repo serves; a guessed /coin/:mint
  // would not be.
  coinHref = (mint: string) => `/catwalk?q=${encodeURIComponent(mint)}`,
  explorer,
  onClaim,
}: Props) {
  const feed = useCatwalkBoard(endpoint)
  const history = useCatwalkCycles(endpoint)
  const [tab, setTab] = useState<CatwalkPanelId>('catwalk')
  /**
   * THE FOURTH TAB EXISTS ONLY WHERE THE RAIL IS NOT A COLUMN.
   *
   * Below 1280px the split collapses and the composition legend lands about two
   * thousand pixels under the board with nothing pointing at it; at or above it
   * the legend is already on screen beside the table, so a tab pointing at it
   * would be a lie about a place the reader is looking at.
   *
   * IT IS ABSENT FROM THE TABLIST AT DESKTOP WIDTH, NOT HIDDEN. `Tabs` fills its
   * button refs positionally and moves focus by index (src/components/solz/
   * ui.tsx), so a `display:none` fourth button would still take its index -
   * ArrowRight from CHAMPIONS would select a panel nobody can see and then focus
   * a hidden node. `visibility:hidden` is worse: it stays in the accessibility
   * tree and is announced on a desktop that has no such tab.
   *
   * `useNarrow` answers false until the browser does, so the server and the
   * first paint render the four-tab desktop list.
   */
  const narrow = useNarrow(CATWALK_NARROW)
  const panels: CatwalkPanelId[] = narrow ? [...CATWALK_TABS, 'info'] : CATWALK_TABS
  const [typed, setTyped] = useState('')
  const [applied, setApplied] = useState('')
  const [now, setNow] = useState(() => Date.now())
  /**
   * A ROW CLICK IS A SEARCH, NOT A NAVIGATION.
   *
   * Every coin link on this page points at `/catwalk?q=<mint>` - the page the
   * reader is already on - and four surfaces answered a click by calling
   * `window.location.assign` on it, so pressing a row tore the document down
   * and rebuilt it in order to run a filter. This writes exactly what the URL
   * hydrate below writes, so the `?q=` effect then produces the identical
   * address a reload would have produced: shareable, with no document load.
   *
   * BOTH HALVES, DELIBERATELY. `typed` is what the search box shows, so the
   * reader can see what is filtered and clear it; `applied` is what
   * `parseCatwalkQuery` reads. The 120ms debounce re-sets `applied` to the same
   * value a moment later, which is a no-op.
   *
   * AND IT GOES THROUGH THE SAME STATE AS TYPING, which is what keeps the left
   * board's promise intact: the dim/match layer is derived by
   * `catwalkBoardLayer(shape.rows, query, tab)` over the WHOLE board, so
   * feeding `applied` cannot make the board tab-dependent. There is no second
   * filter path here and there must never be one.
   *
   * Clicking the coin that is already filtered clears the filter.
   */
  /** THE SEAT THE DIALOG IS OPEN FOR, or null. A host that passed its own
   *  `onClaim` never reaches this; everybody else gets this page's own dialog. */
  const [claimSeat, setClaimSeat] = useState<CatwalkLadderSeat | null>(null)
  const onCoin = useCallback((mint: string) => {
    setTyped((current) => (current === mint ? '' : mint))
    setApplied((current) => (current === mint ? '' : mint))
  }, [])
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const toolbarRef = useRef<HTMLDivElement | null>(null)

  /**
   * HOW TALL THE PAGE'S STICKY CHROME ACTUALLY IS - measured, not guessed.
   *
   * `--cw-sticky-top` is what every offset that has to clear the sticky header
   * AND this page's sticky toolbar is expressed against: the rail's own sticky
   * top, and `scroll-margin-block-start` on every row, which is what search uses
   * to land its first hit. The stylesheet could only ESTIMATE the toolbar - its
   * own comment said so - and the estimate was wrong wherever the toolbar wrapped
   * to more rows than the estimate allowed for. At phone width it allowed 98px
   * for a bar that is 106px with the lane tabs on one line and 141px with them on
   * two, so `scrollIntoView` put the row search had just found 43px underneath an
   * opaque bar: a 13px sliver of the answer.
   *
   * The toolbar's height is a runtime fact - it depends on how five tab labels in
   * the reader's own font wrap into the width they were given - so it is read
   * from the element rather than predicted from a breakpoint. The CSS constants
   * stay as the pre-hydration fallback and nothing else.
   *
   * NOT a layout effect. `useLayoutEffect` warns on every server render of this
   * page, and the value it writes changes nothing that is on screen at the
   * moment it lands - it is read when the reader scrolls or searches, both of
   * which are a great many frames away.
   */
  const [chromeHeight, setChromeHeight] = useState(0)
  useEffect(() => {
    const node = toolbarRef.current
    if (!node) return
    const measure = () => setChromeHeight(Math.round(node.getBoundingClientRect().height))
    measure()
    // A bar that wraps when the window narrows, when a tab count arrives, or
    // when the reader's font loads has changed height without a re-render.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  // Undefined before the measurement lands, so the stylesheet's own fallback is
  // what the first paint uses rather than a zero that would put every row's
  // scroll target under the site header.
  const boardStyle = chromeHeight
    ? ({ '--cw-sticky-top': `calc(var(--site-header-height) + ${chromeHeight}px)` } as CSSProperties)
    : undefined

  // IDENTITY THE BOARD DID NOT CARRY, read from the chain's own token registry.
  // The game API names its coins by mint and publishes a bare ticker and a
  // root-relative logo path beside them; both mints on this board are mainnet,
  // so what a coin is CALLED and what it LOOKS LIKE are knowable. The overlay
  // never touches a ticker and never overrides a logo the board published that
  // actually resolves - see src/components/solz/tokenMeta.ts.
  //
  // THE RANKED LADDER'S COINS ARE IN THIS READ TOO, and they are not on the
  // board. `useTokenMeta` is mint-keyed and board-independent, so one request
  // serves both - a second call would be a second round trip for the same
  // registry. `overlayTokenMeta` deliberately does NOT get extended to cover
  // them: it walks `board.lineup` only and returns the same object identity
  // when nothing changed, which the board's 30-second poll depends on. The rail
  // resolves its own rows instead, the way MIAW PRIX does.
  //
  // THE CAP IS SPELLED OUT HERE BECAUSE THE ROUTE'S IS SILENT.
  // src/pages/api/token-meta.ts caps at 50 mints and slices the tail away
  // without saying so, and thirty-six board positions plus a deep ladder will
  // exceed that. Truncating here, with the LINEUP FIRST, makes it a decision:
  // the board's own coins always get their identity, and a ranked coin past the
  // cap still renders - short-mint name plate, TeamMark's built-in crest, and a
  // real contract address.
  const mints = useMemo(() => [...new Set([
    ...(feed.board?.lineup ?? []).map((entry) => entry.mint),
    ...(feed.board?.rankedLane?.state === 'ready' ? feed.board.rankedLane.projects.map((row) => row.mint) : []),
  ].filter(Boolean))].slice(0, 50), [feed.board])
  const tokenMeta = useTokenMeta(mints)
  const board = useMemo(() => overlayTokenMeta(feed.board, tokenMeta), [feed.board, tokenMeta])
  /** A ranked coin's crest, resolved by the same rule the board's rows use: the
   *  wire's own logo when it is genuinely fetchable from this origin, the mint
   *  registry's otherwise, and undefined when neither answered - in which case
   *  `TeamMark` draws its own mark rather than a broken image. The ladder's rows
   *  carry root-relative paths like `/solz_logo.svg`, which resolve against THIS
   *  origin and 404, so passing the wire value through unresolved is the one
   *  thing that would keep drawing broken pictures. */
  const logoFor = useCallback(
    (mint: string, boardLogo?: string | null) => resolvedTokenLogo(boardLogo, tokenMeta.get(mint)?.icon) || undefined,
    [tokenMeta],
  )

  /**
   * THE BOARD BEING SHOWN - the live one, or a walk that has already happened.
   *
   * A RECORDED WALK IS BUILT THROUGH THE SAME `buildBoard`, so a past board gets
   * the same bands, the same numbering and the same vacancy rows as the live
   * one. Rendering history through a second, simpler path is how the two drift
   * until a recorded board quietly stops meaning what a live board means.
   *
   * THE LADDER IS ALWAYS 'closed' ON A RECORDED WALK, and the seats are empty.
   * That walk is over: there is no seat on it to take at any price, and pricing
   * a locked board off today's ladder would advertise a purchase that cannot
   * happen. The standings are passed as 'unknown' for the same reason - today's
   * record is not the record that board walked with, and an em dash is the only
   * honest thing to print.
   */
  const shape = useMemo(
    () => {
      if (history.cycle) {
        return buildBoard({
          board: {
            gameKey: feed.board?.gameKey ?? 'solz',
            activeSlots: history.cycle.activeSlots,
            lineupSize: history.cycle.lineupSize,
            season: feed.board?.season ?? null,
            lineup: history.cycle.lineup,
            seats: null,
            rankedLane: null,
            // A recorded walk carries no "latest change": the snapshot froze
            // when it locked, and today's most recent payment happened to a
            // board this one has not been for weeks.
            lastSeatPaidAt: null,
            // A recorded walk is already bound; there is no lead left to state.
            lockLeadMs: null,
            explorer: feed.board?.explorer ?? null,
          },
          spots: [],
          standings: new Map(),
          standingsState: 'unknown',
          ladder: 'closed',
        })
      }
      return buildBoard({
        standingsState: feed.standingsState,
        board,
        spots: feed.spots,
        outbidSpots: feed.outbidSpots,
        standings: feed.standings,
        ladder: feed.ladder,
      })
    },
    [board, feed.board, feed.spots, feed.outbidSpots, feed.standings, feed.standingsState, feed.ladder, history.cycle],
  )

  /** A recorded walk is never priced and never claimable, so every surface that
   *  reads the ladder must read 'closed' while one is being shown. */
  const showingCycle = history.selected !== null
  const ladderState = showingCycle ? 'closed' : feed.ladder

  // Tab and query live in the URL so a claim flow can return the viewer where
  // they were, rather than to the top of an unfiltered board.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const lane = params.get('lane') ?? ''
      if (isCatwalkTab(lane)) setTab(lane)
      const query = params.get('q') ?? ''
      if (query) { setTyped(query); setApplied(query) }
    } catch { /* a host without a parsable location is not a reason to fail */ }
  }, [])

  // WIDENING THE WINDOW OUT OF 'info' PUTS THE KEYBOARD BACK. Without this, a
  // viewport widened while INFO is selected leaves `tab` holding an id that is
  // not in `panels`, and `Tabs`' own key handler bails in silence on a value it
  // cannot find - a tablist that has stopped responding to arrow keys, with no
  // sign of why.
  useEffect(() => {
    if (!narrow && tab === 'info') setTab('catwalk')
  }, [narrow, tab])

  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(typed), 120)
    return () => window.clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      // 'info' IS NEVER WRITTEN INTO A LINK. It is a narrow-width destination
      // and `isCatwalkTab` refuses it on the way back in, so a phone that put
      // `?lane=info` in the address bar would hand a desktop reader a link to a
      // tab that does not exist there.
      if (tab === 'catwalk' || tab === 'info') url.searchParams.delete('lane')
      else url.searchParams.set('lane', tab)
      if (applied) url.searchParams.set('q', applied); else url.searchParams.delete('q')
      window.history.replaceState(null, '', url)
    } catch { /* replaceState is a convenience, never a requirement */ }
  }, [tab, applied])

  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && /^(INPUT|TEXTAREA)$/.test(target.tagName)
      if (event.key === '/' && !typing) { event.preventDefault(); searchRef.current?.focus() }
      if (event.key === 'Escape' && typing && target === searchRef.current) { setTyped(''); searchRef.current?.blur() }
    }
    window.addEventListener('keydown', listen)
    return () => window.removeEventListener('keydown', listen)
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const query = useMemo(() => parseCatwalkQuery(applied), [applied])
  /** Which rows BELONG to this tab's lane. It feeds the RIGHT RAIL's verdict and
   *  nothing else - see the comment on `hits` below for why it must not reach
   *  the board.
   *
   *  'info' is not a lane, so it asks the same question the MIAW PRIX tab asks:
   *  every row on the board. It shares that tab's rail, and a search verdict
   *  narrower than the rail it is printed beside would be a different claim. */
  /**
   * THE SEARCH LAYER IS A FACT ABOUT THE BOARD, NEVER ABOUT THE TAB.
   *
   * These were matched against `visible`, so the dim/match layer - the one part
   * of the left column a tab could still reach - moved when the tab moved. With
   * $FOOFIX standing in the CHAMPION lane and `foofix` typed, MIAW PRIX dimmed
   * thirty-five rows and outlined P01, while SOLZ RANKED found nothing in its
   * own lane, emptied the hit set, and therefore dimmed ALL THIRTY-SIX and
   * outlined none: at .22 opacity (catwalk.css `.cw-slot[data-dim='true']`) the
   * whole board faded out and the match marker vanished because the reader
   * clicked a tab. A bare slot query did the same through `matched` alone.
   *
   * The lens and the metric column were frozen for exactly this reason; this was
   * the last thing making the left side tab-dependent. Matching the WHOLE board
   * means a coin that matches is lit in its own position on every tab, which is
   * also the honest answer: the reader asked where $FOOFIX is, not whether it is
   * in the lane whose tab happens to be open.
   *
   * IT IS NOT DERIVED HERE ANY MORE, AND THAT IS THE POINT. This frame is only
   * ever reached in a browser - the board is `pending` on the server, so no
   * render test in this repo can see the searching app at all - which left the
   * call site the one place the regression could return unnoticed. Both halves
   * come from `catwalkBoardLayer` now: it builds the board layer from every row
   * and the tab's rows separately, in one covered function, and this file no
   * longer names `boardSearchLayer` or the row filter that used to be wrapped
   * around it.
   */
  const { hits, dimmed, matched, visible } = useMemo(
    () => catwalkBoardLayer(shape.rows, query, tab),
    [shape.rows, query, tab],
  )
  // Judged against BOTH lists, once, in searchOutcome. THIS is where the tab is
  // allowed to matter - an 'elsewhere' card in the rail is the tab-dependent
  // half of a search, and the rail is the half a tab may change.
  const outcome = useMemo(() => searchOutcome(query, shape.rows, visible), [query, shape.rows, visible])

  // The first match is scrolled into view rather than pulled to the top: rows
  // keep their slot order, so the board the viewer learned stays where it was.
  useEffect(() => {
    if (query.kind === 'none' || !hits.length) return
    const node = listRef.current?.querySelector(`[data-matched='true']`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [query, hits])

  const searching = query.kind !== 'none'
  const rawQuery = query.kind === 'none' ? '' : query.raw
  /** THE CLAIM CONTROLS ARE LIVE NOW. Every one of them was `disabled={!onClaim}`
   *  with "the wallet flow is not wired up yet" in its title, and nothing ever
   *  passed `onClaim` - so the whole sale was inert. It falls back to this
   *  page's own dialog, which needs no wallet connection at all.
   *
   *  `disabled={!onClaim}` stays exactly as it is inside the row components: a
   *  row rendered without a handler is still honestly inert, and this app now
   *  always passes one. */
  const claim: ClaimHandler = onClaim ?? ((seat) => setClaimSeat(seat))
  // Nothing left to state: there is no longer a reason for the control to be
  // dead, so nothing is written on it.
  const claimReason = undefined
  const pending = feed.loading && !feed.board

  // A vacancy points at the ladder only when the ladder actually has a seat
  // nobody is standing on. Otherwise the row says how the position fills and
  // offers nothing, rather than sending the viewer to an empty list.
  const forSale = shape.seats.some((seat) => !seatHeld(seat) && seat.askUsdMicros > 0)
  const toLadder = forSale ? () => setTab('outbid') : undefined

  // A tab count is a count of rows that have been read. While the board is
  // pending every one of them would be a default or a zero, so the tabs carry a
  // placeholder of the same width and say nothing.
  const counts: Partial<Record<CatwalkPanelId, string>> = {
    catwalk: String(shape.lineupSize),
    // The LADDER's length, not a filter of the board - and an em dash rather
    // than a zero when the ladder did not answer, because nobody has read it.
    outbid: feed.ladder === 'open' ? String(shape.seats.length) : feed.configuredSeats ? `${feed.configuredSeats} CLOSED` : '—',
    ranked: String(tabRows('ranked', shape.rows).length),
    champions: String(tabRows('champions', shape.rows).length),
    agents: 'SOON',
    // 'info' is not a lane and holds no positions, so it carries no count
    // badge. A zero there would state that nothing is in it.
  }
  // The board's own chain, when it published one; a host override next; and the
  // registry's own mainnet explorer last. Never a cluster this page guessed.
  const explorerVenue = feed.board?.explorer ?? explorer ?? DEFAULT_CATWALK_EXPLORER
  const tabCount = (id: CatwalkPanelId) => {
    if (counts[id] === undefined) return null
    return pending && id !== 'agents'
      ? <b><i className="cw-pending cw-pending--tab" aria-hidden="true" /></b>
      : <b>{counts[id]}</b>
  }

  /**
   * WHEN THIS BOARD NEXT LOCKS, derived once for the page.
   *
   * Three states before the schedule can answer at all, and they are three on
   * purpose. While the first poll is in flight NOBODY has read the programme,
   * so the clock says nothing; once it has settled with neither a read nor a
   * remembered schedule, the read FAILED and the clock says that. Only past both
   * may `nextCatwalkLock` speak about the schedule itself - which is the same
   * unread / unreadable / answered discipline the ladder and the standings keep,
   * and the reason a 502 cannot print NO ROTATION IS SCHEDULED YET.
   *
   * A schedule kept from an earlier poll still answers: a lock INSTANT does not
   * move because the network blinked, and the only thing a fresh read could
   * change is which rotation is next.
   */
  const lock = useMemo<CatwalkLock>(() => {
    if (feed.loading) return { state: 'unread' }
    if (!feed.scheduleRead && !feed.schedule) return { state: 'unreadable' }
    return nextCatwalkLock(feed.schedule, now, feed.board?.lockLeadMs ?? undefined)
  }, [feed.loading, feed.schedule, feed.scheduleRead, feed.board?.lockLeadMs, now])

  /**
   * WHAT WALK IS ON SCREEN, said above the rows.
   *
   * A recorded board is pixel-for-pixel a live one - same numbers, same lanes,
   * same chips - so a viewer three screens down has no way to tell that the coin
   * at slot 01 stood there three weeks ago and does not now. The banner is the
   * only thing that says so, which is why it is loud and why it carries the way
   * back.
   *
   * ITS THREE STATES ARE THE PAGE'S THREE STATES. A walk being read says so and
   * claims nothing; a walk that failed to read says THAT, and never renders as a
   * board with no coins on it.
   */
  const cycleBanner = () => {
    if (history.selected === null) return null
    if (history.error) {
      return <LaneNote lane="open" title="THAT WALK COULD NOT BE READ." body={history.error} />
    }
    if (history.loading || !history.cycle) {
      return <div className="cw-cycle-banner" role="status" aria-busy="true">
        <strong><i className="cw-pending cw-pending--line" aria-hidden="true" /></strong>
        <span className="sr-only">Reading that walk.</span>
      </div>
    }
    return <CatwalkCycleBanner cycle={history.cycle} onLive={() => history.select(null)} />
  }

  const panelBody = (active: CatwalkPanelId) => {
    // NOTHING BELOW MAY BE STATED BEFORE THE FIRST READ LANDS. An empty lane, a
    // ladder verdict, a collapsed run of vacancies and a search miss are all
    // readings of a board nobody has read; the board's own shape is the only
    // thing known without the network. So the panel holds that shape at full
    // size as skeleton rows and says nothing at all. The structure is identical
    // on every tab, so a deep-linked ?lane=champions can no longer be replaced
    // by a structurally different pane the moment the read lands.
    //
    // AND BOTH EARLY RETURNS KEEP THE SPLIT. They used to REPLACE the whole
    // panel, so the left board vanished the moment the page was reading or a
    // search missed - on the tab whose entire promise is that the left side
    // never changes. The frame is the same frame in all three states now, which
    // is what makes "the left side keeps as the MIAW PRIX tab" literally true
    // rather than true once the read has landed and nobody is searching.
    if (pending) {
      return (
        <CatwalkSplit
          tab={active}
          // THE PENDING FACE COMES FROM THE LOCK, NOT FROM A SECOND COMPONENT.
          // `lock` is already 'unread' while the board read is in flight and
          // CatwalkClock draws ClockPending for it, so first paint needs no
          // branch of its own - and the schedule read still fails independently
          // of the board's, because the memo above keeps 'unread' and
          // 'unreadable' apart.
          lock={lock}
          leadMs={feed.board?.lockLeadMs}
          narrow={narrow}
          board={<SkeletonList groups={catwalkGroups(shape)} shape={shape} />}
          // Structure only. The lanes and the bands are known without the
          // network; not one count, guarantee or verdict is.
          rail={<CatwalkComposition shape={shape} pending />}
        />
      )
    }
    if (outcome.kind !== 'hits') {
      return (
        <CatwalkSplit
          tab={active}
          // A SEARCH THAT MISSED IS NOT A REASON TO LOSE THE CLOCK. This is one
          // of the two frames the page spends real time in, and the lock is a
          // fact about the board rather than about the query.
          lock={lock}
          leadMs={feed.board?.lockLeadMs}
          narrow={narrow}
          // The real board, not a skeleton and not nothing: a search that found
          // nothing in this lane is a fact about the QUERY, and the thirty-six
          // numbered positions behind it are as true as they were a keystroke
          // ago.
          board={
            <SlotList
              groups={catwalkGroups(shape)}
              metric="rotation"
              shape={shape}
              ladder={feed.ladder}
              dimmed={dimmed}
              matched={matched}
              crowned={false}
              onLadder={toLadder}
              coinHref={coinHref}
              explorer={explorerVenue}
              onCoin={onCoin}
            />
          }
          rail={
            <CatwalkSearchPanel
              outcome={outcome}
              shape={shape}
              ladder={feed.ladder}
              onLane={(next) => setTab(next)}
              onClaim={claim}
              claimReason={claimReason}
              rankedHref={rankedHref}
            />
          }
        />
      )
    }
    return (
      <CatwalkPanel
        leadMs={feed.board?.lockLeadMs}
        tab={active}
        narrow={narrow}
        shape={shape}
        ladder={feed.ladder}
        dimmed={dimmed}
        matched={matched}
        onLadder={toLadder}
        onClaim={claim}
        claimReason={claimReason}
        coinHref={coinHref}
        explorer={explorerVenue}
        onCoin={onCoin}
        logoFor={logoFor}
        configuredSeats={feed.configuredSeats}
        closedReason={feed.closedReason}
        // Straight off the one board read. Null when the server has not shipped
        // the field, and the rail then omits the guarantee rather than quoting
        // a 4 and a 12 this repo would have had to remember.
        seats={board?.seats ?? null}
        rankedLane={board?.rankedLane ?? null}
        // ONE AGGREGATE, NOT A PURCHASE LOG. The newest paid seat on this board,
        // straight off the wire; null when the server does not publish it, and
        // the rail then prints an em dash rather than dating the last sale to
        // the epoch.
        lastSeatPaidAt={board?.lastSeatPaidAt ?? null}
        // THE PAGE'S SINGLE LOCK AND THE PAGE'S SINGLE CLOCK. Not recomputed in
        // the rail: `nextCatwalkLock` never returns 'unreadable' by itself, so a
        // rail deriving its own would print NO ROTATION IS SCHEDULED YET over a
        // 502 while another surface correctly said the read had failed.
        lock={lock}
        now={now}
      />
    )
  }

  const openCount = shape.rows.length - shape.claimed

  if (feed.error && !feed.board) {
    return (
      <AppShell className="solz-home cw-app" mainId="catwalk" mainClassName="cw-main" active="catwalk" skipTo="#catwalk" skipLabel="Skip to the board">
        <div className="cw-board">
          <LaneNote lane="open" title="THE CATWALK BOARD IS UNAVAILABLE." body={feed.error} />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell className="solz-home cw-app" mainId="catwalk" mainClassName="cw-main" active="catwalk" skipTo="#catwalk" skipLabel="Skip to the board" backToTopHref="#catwalk">
      {/* The measured sticky-chrome height rides on the board, because that is
          the element `--cw-sticky-top` is declared on and every consumer of it -
          the rail's sticky top, every row's scroll margin - is inside. */}
      <div className="cw-board" style={boardStyle}>
        {/* THE COUNTER STRIP AND THE EXPLAINER USED TO FOLLOW. Between them
            they restated every figure the board states below - claimed, open,
            the season, the days left, the band ranges - across two full rows
            above the fold, and taught the lane colours in a sentence that the
            rows' own chips teach in place. Both are gone; what is left is the
            hero, and under it the board. */}
        <CatwalkHero
          shape={shape}
          season={feed.board?.season ?? null}
          miawPrixHref={miawPrixHref}
          pending={pending}
          now={now}
          onLadder={toLadder}
        />

        {/* Disclosed once for the page rather than implied row by row. Without
            it every W-L column is an em dash and the CHAMPIONS band head reads
            "WON ON RAW WIN COUNT" over a column of them — the page looking like
            nobody has raced, when in fact nobody answered. */}
        {!pending && !shape.recordsKnown
          ? <p className="cw-notice" role="status">
              {feed.standingRows.length
                // Rows from an earlier poll are still on screen, so the honest
                // word is refreshed, not read — "unavailable" beside a visible
                // win count is a contradiction the viewer has to resolve.
                ? <><b>SEASON RECORDS COULD NOT BE REFRESHED.</b>{' '}
                    Win counts are from the last read that landed and may be out of date. A coin that
                    joined since then shows no record until the next read.</>
                : <><b>SEASON RECORDS COULD NOT BE READ.</b>{' '}
                    Win counts are unavailable for the moment. This page retries on its own; nothing
                    about any coin&rsquo;s record has changed.</>}
            </p>
          : null}

        {/* MEASURED, NOT ESTIMATED. This is the bar every sticky offset on the
            page has to clear, and how tall it is depends on how the lane tabs
            wrap in the width they were given - see `chromeHeight` above. */}
        <div className="cw-toolbar" ref={toolbarRef}>
          <Tabs
            idPrefix="cw"
            label="CATWALK lanes"
            value={tab}
            onChange={(next) => setTab(next)}
            tabs={panels.map((id) => ({
              id,
              disabled: id === 'agents',
              // The one genuinely disabled tab. It exists so the shape of the
              // product is legible; the title carries the reason, because the
              // shared Tabs component has no room for an inline note.
              // The lane's own colour, the same one its chips and its rows
              // carry. A tab that is not a lane wears none.
              label: <span className="cw-tab" data-lane={TAB_LANE[id]} title={id === 'agents' ? 'Agent-owned slots are not scheduled yet.' : undefined}>
                {TAB_LABEL[id]}{tabCount(id)}
              </span>,
            }))}
          />
          {/* WHICH WALK, beside the lanes rather than above them: it selects the
              BOARD, exactly as the tabs select the rail, so the two controls
              that change what is on screen sit together. It renders nothing at
              all until the index has been read - see CatwalkCyclePicker. */}
          <CatwalkCyclePicker
            cycles={history.cycles}
            state={history.state}
            selected={history.selected}
            onSelect={history.select}
            busy={history.loading}
          />
          <div className="cw-search">
            <Search size={14} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={typed}
              aria-label="Search the board"
              aria-controls="cw-list"
              placeholder="Search coin, ticker or contract address"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        </div>

        {/* WHAT THIS LINE SAYS NOW IS ONLY WHAT SEARCH DID.
            A four-cell figure strip stood here - WALK IN 12, ON THE BOARD 36,
            CLAIMED 2, OPEN 34 - directly under a hero that already counts the
            runway and directly above band heads that already carry 01-12 and
            13-36. Four figures, three surfaces, one board. The lane key that
            followed it went the same way: every row wears its lane's colour AND
            its lane's chip, so a separate legend taught what the next row over
            already says in words. */}
        {searching || pending
          ? <div className="cw-count" role="status">
              {pending
                ? <><i className="cw-pending cw-pending--line" aria-hidden="true" /><span className="sr-only">Reading the board.</span></>
                : <>
                    <span className="cw-count-hits">{hits.length} RESULT{hits.length === 1 ? '' : 'S'} FOR &ldquo;{rawQuery}&rdquo;</span>
                    <button type="button" onClick={() => setTyped('')}>CLEAR ×</button>
                  </>}
            </div>
          : null}

        {cycleBanner()}

        <div id="cw-list" ref={listRef}>
          {/* THE SAME ARRAY THE TABLIST WAS BUILT FROM. Feeding one and not the
              other would leave a tab's `aria-controls` pointing at a panel id
              that is not in the document. */}
          {panels.map((id) => (
            <TabPanel key={id} id={id} idPrefix="cw" active={id === tab}>
              {id === tab ? panelBody(id) : null}
            </TabPanel>
          ))}
        </div>

        {/* The invitation is the loudest count on the page, so it waits for the
            read like every other one - and it only invites a purchase when there
            is something on the ladder to buy. */}
        <CatwalkFooter pending={pending} openCount={openCount} shape={shape} ladder={feed.ladder} />

        {/* THE SALE, AND IT NEEDS NO WALLET CONNECTION.
            Mounted here rather than by src/pages/catwalk.astro because Astro
            serializes island props and a handler will not cross that boundary -
            which is the whole reason `onClaim` was never passed and every claim
            control on this page was inert. A host that owns its own flow passes
            `onClaim` and this never opens. */}
        <CatwalkClaimDialog
          open={!!claimSeat}
          seat={claimSeat}
          onClose={() => setClaimSeat(null)}
        />
      </div>
    </AppShell>
  )
}
