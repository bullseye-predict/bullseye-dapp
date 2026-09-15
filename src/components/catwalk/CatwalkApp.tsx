import '../../styles/home.css'
import '../../styles/catwalk.css'
import { ArrowUpRight, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AppShell } from '../solz/AppShell'
import { DEFAULT_CATWALK_EXPLORER, catwalkSeasonLabel, usdLabel } from '../solz/catwalkSource'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import { Tabs, TabPanel } from '../solz/ui'
import {
  bandRange, buildBoard, cheapestSeat, pad, seatHeld,
  type CatwalkBoardShape, type CatwalkRow, type LadderState,
} from './catwalkBands'
import {
  CATWALK_TABS, isCatwalkTab, matchedSpots, parseCatwalkQuery, tabLens, tabRows,
  type CatwalkQuery, type CatwalkTab,
} from './catwalkQuery'
import {
  CatwalkBandHead, CatwalkSlotRow, CatwalkSlotSkeleton, CatwalkWalkLine,
  type CatwalkMetric, type CatwalkRowState,
} from './CatwalkSlotRow'
import { CatwalkLadderList, type ClaimHandler } from './CatwalkLadder'
import { CatwalkCounter, CatwalkExplain, CatwalkHero, daysLeft } from './CatwalkHero'
import { useCatwalkBoard } from './useCatwalkBoard'

/**
 * CATWALK - the table the top twelve walk every MIAW PRIX rotation.
 *
 * The board is one list of numbered positions, and EVERY TAB RENDERS ALL OF
 * THEM. A tab chooses a lane to look through and search dims the rest, but
 * neither ever renumbers and neither ever removes a position: a slot number is
 * absolute identity in every tab, which is why an open slot is a first-class
 * row rather than a gap, and why a lane with nothing in it still shows
 * thirty-six numbered positions rather than one centred card over a dashed box.
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

const TAB_LABEL: Record<CatwalkTab, string> = {
  catwalk: 'CATWALK', outbid: 'OUTBID', ranked: 'SOLZ RANKED', champions: 'CHAMPIONS', agents: 'AGENTS',
}

/** Which lane colour a tab wears. The table itself and the not-yet-scheduled
 *  agents lane wear none, because neither is a lane a coin can arrive through. */
const TAB_LANE: Partial<Record<CatwalkTab, string>> = {
  outbid: 'outbid', champions: 'champion', ranked: 'ranked',
}

const TAB_SUB: Record<CatwalkTab, string> = {
  catwalk: 'THE WHOLE TABLE, MERGED. ONE COIN HOLDS ONE SLOT.',
  outbid: 'THE SPOT LADDER. SEAT NUMBERS ARE THE SALE’S OWN, NOT BOARD POSITIONS.',
  ranked: 'COINS THAT CLIMBED IN. NOTHING PAID.',
  champions: 'TOP THREE BY SEASON WINS. CANNOT BE OUTBID.',
  agents: 'AGENT-OWNED SLOTS ARE NOT SCHEDULED YET.',
}

const TAB_METRIC: Record<CatwalkTab, CatwalkMetric> = {
  catwalk: 'record', outbid: 'take', ranked: 'lane', champions: 'wins', agents: 'record',
}

type Props = {
  /** Same-origin proxy. Injected rather than built here, per the adapter rule. */
  endpoint?: string
  miawPrixHref?: string
  rankedHref?: string
  standingsHref?: string
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
  /** Supplied by a host that owns the wallet flow. Without it the claim controls
   *  render inert with a stated reason; they never simulate a purchase. A claim
   *  takes a LADDER SEAT, because a seat is the only thing on sale. */
  onClaim?: ClaimHandler
}

/** A band of the rotation, ready to render.
 *
 *  It carries no colour. A band is a POSITION range, and position is the number
 *  chip and this head - never a hue. Only a head that names a LANE takes a
 *  colour, and the one head that does (the spot ladder's) sets it itself. */
type Group = {
  key: string
  head?: { label: string; range?: string; note: string }
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
    head: { label: band.label, range: bandRange(band), note: band.note },
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
          {group.head ? <CatwalkBandHead label={group.head.label} range={group.head.range} note={group.head.note} /> : null}
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
          {group.head ? <CatwalkBandHead label={group.head.label} range={group.head.range} note={group.head.note} /> : null}
          <ol>{group.rows.map((row) => <CatwalkSlotSkeleton key={row.spot} spot={row.spot} />)}</ol>
          {group.walkLineAfter ? <CatwalkWalkLine activeSlots={shape.activeSlots} /> : null}
        </div>
      ))}
    </>
  )
}

/**
 * A lane's own state, said ABOVE the table rather than instead of it.
 *
 * This used to be a centred card with a headline over a large dashed box, and
 * it REPLACED the board: the SOLZ RANKED tab with nothing in it rendered
 * "NOBODY HAS CLIMBED IN YET" and no numbered positions at all, which is the
 * screen the owner rejected. An empty lane is a fact about the lane, not the
 * disappearance of the board, so it is now a slim banner and the thirty-six
 * numbered positions render underneath it exactly as on every other tab.
 */
function LaneNote({ title, body, cta, lane }: { title: string; body: string; cta?: { label: string; href: string }; lane: string }) {
  return (
    <div className="cw-lane-note" data-lane={lane}>
      <strong>{title}</strong>
      <p>{body}</p>
      {cta ? <a className="cw-act" href={cta.href}>{cta.label}<ArrowUpRight size={12} aria-hidden="true" /></a> : null}
    </div>
  )
}

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
 * ONE TAB'S PANEL, ONCE THE BOARD HAS BEEN READ.
 *
 * Exported so the promise this component makes is testable on its own: EVERY
 * TAB RENDERS THE WHOLE NUMBERED TABLE. The SOLZ RANKED tab with nothing in it
 * used to render one centred card - "NOBODY HAS CLIMBED IN YET" over a large
 * dashed box - and no numbered positions at all, which is the screen the owner
 * rejected. A lane's own state is a BANNER above the table now, never instead
 * of it, and the structure below the banner is the same structure on all five
 * tabs: same bands, same thirty-six numbers, same walk line.
 */
export function CatwalkPanel({
  tab, shape, ladder, dimmed = () => false, matched = () => false,
  onLadder, onClaim, claimReason, coinHref, explorer,
  rankedHref, standingsHref, daysRemaining,
}: {
  tab: CatwalkTab
  shape: CatwalkBoardShape
  ladder: LadderState
  dimmed?: (row: CatwalkRow) => boolean
  matched?: (row: CatwalkRow) => boolean
  onLadder?: () => void
  onClaim?: ClaimHandler
  claimReason?: string
  coinHref?: (mint: string) => string
  explorer?: ExplorerVenue | null
  rankedHref?: string
  standingsHref?: string
  daysRemaining?: number | null
}) {
  /** The whole numbered table, under this tab's lens. One call site, so no tab
   *  can quietly render a different structure from the others. */
  const table = (
    <SlotList
      groups={catwalkGroups(shape)}
      metric={TAB_METRIC[tab]}
      shape={shape}
      ladder={ladder}
      dimmed={dimmed}
      matched={matched}
      crowned={tab === 'champions'}
      onLadder={onLadder}
      coinHref={coinHref}
      explorer={explorer}
      lens={tabLens(tab)}
    />
  )

  /**
   * What a lane tab says about ITSELF, above the table. Null when the lane has
   * coins in it and there is nothing to explain. Never a replacement for the
   * board: the thirty-six numbered positions render underneath it either way.
   */
  const laneNote = () => {
    const rows = tabRows(tab, shape.rows)
    if (tab === 'agents') {
      return <LaneNote
        lane="open"
        title="AGENT-OWNED SLOTS ARE NOT SCHEDULED YET."
        body="No position is held through this lane, so every slot below is either open or taken through another one."
      />
    }
    if (tab === 'ranked' && rows.length === 0) {
      return <LaneNote
        lane="ranked"
        title="NOBODY HAS CLIMBED IN YET."
        body="High coins on the SOLZ ranked ladder take a slot free at season roll. Nothing to pay, nothing to bid."
        cta={rankedHref ? { label: 'VIEW RANKED LADDER', href: rankedHref } : undefined}
      />
    }
    if (tab === 'champions' && rows.length === 0) {
      return <LaneNote
        lane="champion"
        title="CHAMPION SLOTS UNLOCK WHEN THE SEASON CLOSES."
        body={`Top 3 by MIAW PRIX season wins take slots 1–3 free, and those three cannot be outbid at any price.${daysRemaining === null || daysRemaining === undefined ? '' : ` ${daysRemaining}d to go.`}`}
        cta={standingsHref ? { label: 'SEE SEASON STANDINGS', href: standingsHref } : undefined}
      />
    }
    return null
  }

  if (tab === 'outbid') {
    // Only a ladder that ANSWERED may be reported shut. An unreadable one is its
    // own sentence: a 502 from the proxy is not a closed sale, and announcing
    // one shut the whole board's pricing over a blip. Either way the numbered
    // table renders beside it - the ladder's state is news about the ladder,
    // not about the thirty-six positions.
    const head = ladder === 'closed'
      ? <LaneNote lane="outbid" title="THE SPOT LADDER IS CLOSED BETWEEN SEASONS." body="Seats reopen when the next season starts." />
      : ladder === 'unknown'
        ? <LaneNote lane="outbid" title="THE SPOT LADDER COULD NOT BE READ." body="Prices are unavailable for the moment. This page retries on its own; nothing about the sale has changed." />
        : !shape.seats.length
          ? <LaneNote lane="outbid" title="THE LADDER IS PUBLISHING NO SEATS." body="The sale is open but carries no positions at the moment." />
          : <CatwalkLadderList seats={shape.seats} onClaim={onClaim} claimReason={claimReason} coinHref={coinHref} explorer={explorer} />
    return (
      <div className="cw-outbid">
        <div className="cw-outbid-list">{head}</div>
        <div className="cw-outbid-board">{table}</div>
      </div>
    )
  }

  return <>{laneNote()}{table}</>
}

export function CatwalkApp({
  endpoint = '/api/agent-arena',
  miawPrixHref = '/miaw-prix',
  rankedHref = '/agent-arena',
  standingsHref = '/miaw-prix#standings',
  // A coin's own section on this site is its row on this board, reached by
  // contract address. It is a real route this repo serves; a guessed /coin/:mint
  // would not be.
  coinHref = (mint: string) => `/catwalk?q=${encodeURIComponent(mint)}`,
  explorer,
  onClaim,
}: Props) {
  const feed = useCatwalkBoard(endpoint)
  const [tab, setTab] = useState<CatwalkTab>('catwalk')
  const [typed, setTyped] = useState('')
  const [applied, setApplied] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const searchRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  const shape = useMemo(
    () => buildBoard({
      standingsState: feed.standingsState,
      board: feed.board,
      spots: feed.spots,
      outbidSpots: feed.outbidSpots,
      standings: feed.standings,
      ladder: feed.ladder,
    }),
    [feed.board, feed.spots, feed.outbidSpots, feed.standings, feed.standingsState, feed.ladder],
  )

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

  useEffect(() => {
    const timer = window.setTimeout(() => setApplied(typed), 120)
    return () => window.clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    try {
      const url = new URL(window.location.href)
      if (tab === 'catwalk') url.searchParams.delete('lane'); else url.searchParams.set('lane', tab)
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
  const visible = useMemo(() => tabRows(tab, shape.rows), [tab, shape.rows])
  const hits = useMemo(() => matchedSpots(visible, query), [visible, query])
  const hitSet = useMemo(() => new Set(hits), [hits])
  // Judged against BOTH lists, once, in searchOutcome.
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
  const dimmed = (row: CatwalkRow) => query.kind === 'text' && !hitSet.has(row.spot)
  const matched = (row: CatwalkRow) => searching && hitSet.has(row.spot)
  const claimReason = onClaim ? undefined : 'Claiming a seat needs the wallet flow, which is not wired up yet.'
  const pending = feed.loading && !feed.board

  // A vacancy points at the ladder only when the ladder actually has a seat
  // nobody is standing on. Otherwise the row says how the position fills and
  // offers nothing, rather than sending the viewer to an empty list.
  const forSale = shape.seats.some((seat) => !seatHeld(seat) && seat.askUsdMicros > 0)
  const toLadder = forSale ? () => setTab('outbid') : undefined

  // A tab count is a count of rows that have been read. While the board is
  // pending every one of them would be a default or a zero, so the tabs carry a
  // placeholder of the same width and say nothing.
  const counts: Record<CatwalkTab, string> = {
    catwalk: String(shape.lineupSize),
    // The LADDER's length, not a filter of the board - and an em dash rather
    // than a zero when the ladder did not answer, because nobody has read it.
    outbid: feed.ladder === 'open' ? String(shape.seats.length) : '—',
    ranked: String(tabRows('ranked', shape.rows).length),
    champions: String(tabRows('champions', shape.rows).length),
    agents: 'SOON',
  }
  // The board's own chain, when it published one; a host override next; and the
  // registry's own mainnet explorer last. Never a cluster this page guessed.
  const explorerVenue = feed.board?.explorer ?? explorer ?? DEFAULT_CATWALK_EXPLORER
  const tabCount = (id: CatwalkTab) =>
    pending && id !== 'agents'
      ? <b><i className="cw-pending cw-pending--tab" aria-hidden="true" /></b>
      : <b>{counts[id]}</b>

  const remaining = daysLeft(feed.board?.season ?? null, now)

  const panelBody = (active: CatwalkTab) => {
    // NOTHING BELOW MAY BE STATED BEFORE THE FIRST READ LANDS. An empty lane, a
    // ladder verdict, a collapsed run of vacancies and a search miss are all
    // readings of a board nobody has read; the board's own shape is the only
    // thing known without the network. So the panel holds that shape at full
    // size as skeleton rows and says nothing at all. The structure is identical
    // on every tab, so a deep-linked ?lane=champions can no longer be replaced
    // by a structurally different pane the moment the read lands.
    if (pending) return <SkeletonList groups={catwalkGroups(shape)} shape={shape} />
    if (outcome.kind !== 'hits') {
      return <CatwalkSearchPanel
        outcome={outcome}
        shape={shape}
        ladder={feed.ladder}
        onLane={(next) => setTab(next)}
        onClaim={onClaim}
        claimReason={claimReason}
        rankedHref={rankedHref}
      />
    }
    return (
      <CatwalkPanel
        tab={active}
        shape={shape}
        ladder={feed.ladder}
        dimmed={dimmed}
        matched={matched}
        onLadder={toLadder}
        onClaim={onClaim}
        claimReason={claimReason}
        coinHref={coinHref}
        explorer={explorerVenue}
        rankedHref={rankedHref}
        standingsHref={standingsHref}
        daysRemaining={remaining}
      />
    )
  }

  const openCount = shape.rows.length - shape.claimed
  /**
   * The board's figures, as figures.
   *
   * This line used to read "12 OF 36 SLOTS RACING · 0 CLAIMED · 36 OPEN" -
   * three separate claims strung on two middle dots, in a page that was leaning
   * on that character in nine different places. Each figure now has its own
   * labelled cell, and none of them says "racing", because nothing here races.
   */
  const figures: Array<{ head: string; value: string }> = [
    { head: 'WALK IN', value: String(shape.activeSlots) },
    { head: 'ON THE BOARD', value: String(shape.lineupSize) },
    { head: 'CLAIMED', value: String(shape.claimed) },
    { head: 'OPEN', value: String(openCount) },
  ]

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
      <div className="cw-board">
        <CatwalkHero shape={shape} season={feed.board?.season ?? null} pending={pending} onLadder={toLadder} />
        <CatwalkCounter shape={shape} season={feed.board?.season ?? null} ladder={feed.ladder} pending={pending} now={now} />
        <CatwalkExplain shape={shape} miawPrixHref={miawPrixHref} />

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

        <div className="cw-toolbar">
          <Tabs
            idPrefix="cw"
            label="CATWALK lanes"
            value={tab}
            onChange={(next) => setTab(next)}
            tabs={CATWALK_TABS.map((id) => ({
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

        <p className="cw-tabs-sub">{TAB_SUB[tab]}</p>
        <div className="cw-count" role="status">
          {/* Not "0 CLAIMED" until something has been counted - but a reader is
              told the read is running, because a silent shimmer says nothing. */}
          {pending
            ? <><i className="cw-pending cw-pending--line" aria-hidden="true" /><span className="sr-only">Reading the board.</span></>
            : searching
              ? <span className="cw-count-hits">{hits.length} RESULT{hits.length === 1 ? '' : 'S'} FOR &ldquo;{rawQuery}&rdquo;</span>
              : <span className="cw-figures">
                  {figures.map((figure) => (
                    <span key={figure.head}><b>{figure.value}</b><small>{figure.head}</small></span>
                  ))}
                </span>}
          {searching ? <button type="button" onClick={() => setTyped('')}>CLEAR ×</button> : null}
        </div>

        <div id="cw-list" ref={listRef}>
          {CATWALK_TABS.map((id) => (
            <TabPanel key={id} id={id} idPrefix="cw" active={id === tab}>
              {id === tab ? panelBody(id) : null}
            </TabPanel>
          ))}
        </div>

        {/* The invitation is the loudest count on the page, so it waits for the
            read like every other one - and it only invites a purchase when there
            is something on the ladder to buy. */}
        <CatwalkFooter pending={pending} openCount={openCount} shape={shape} ladder={feed.ladder} />
      </div>
    </AppShell>
  )
}
