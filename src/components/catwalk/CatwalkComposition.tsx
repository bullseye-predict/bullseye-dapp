import { usdLabel, type CatwalkRankedLaneRead, type CatwalkSeatPlan } from '../solz/catwalkSource'
import type { CatwalkLane } from '../solz/model'
import { bandRange, type CatwalkBandKind, type CatwalkBoardShape, type LadderState } from './catwalkBands'
import { leadHours } from './catwalkLock'
import { LaneChip } from './CatwalkSlotRow'

/**
 * HOW THE LIST IS PUT TOGETHER - the right-hand rail of the MIAW PRIX tab.
 *
 * MIAW PRIX DOES NOT DECIDE ANYTHING. It is the board, and the board is made of
 * lanes: a coin arrives by paying (OUTBID), by winning (CHAMPIONS) or by
 * climbing (SOLZ RANKED). This rail is where that is said in words, once, beside
 * the table it describes - and it is the ONLY thing on the screen a tab changes.
 * The left column is the MIAW PRIX board on every tab, at every width, in every
 * read state.
 *
 * NOTHING IN HERE IS STATED BEFORE IT IS READ. Structure - the lanes, the bands,
 * their ranges - is known without the network and is drawn on the first frame.
 * Every figure below it waits: a guarantee is omitted entirely unless the server
 * sent one, a count is omitted while the board is pending, and an unread figure
 * is an em dash. A rail that printed "0 RANKED" during a 502 is the bug this
 * whole page is built to prevent, and it would print it three inches from a
 * board that correctly said nothing.
 *
 * IT QUOTES NO NUMBER IT WAS NOT GIVEN. The four guaranteed runway seats and the
 * twelve guaranteed line-up seats are BACKEND settings; this file holds neither,
 * exactly as it holds no price. If `seats` did not arrive the section is not
 * rendered at all - not as a zero, not as a dash, and above all not as a 4 and a
 * 12 remembered from a spec. A legend that restates a figure it cannot see is
 * the same failure as a board that prices a position by its number.
 *
 * COLOUR COMES FROM THE LANE, NOT FROM THIS FILE. Every swatch is the page's own
 * `LaneChip`, which resolves `--cw-hue` through `data-lane` in catwalk.css. No
 * hex value is written here, so the palette still has exactly three numbers in
 * it and moving one moves the rows, the band heads, the tabs and this legend
 * together.
 */

const LANES: CatwalkLane[] = ['outbid', 'champion', 'ranked']

/** What each lane IS, in one authored sentence. These are the only sentences on
 *  this page that explain the lanes as a system rather than row by row. */
const LANE_TITLE: Record<CatwalkLane, string> = {
  outbid: 'OUTBID', champion: 'CHAMPIONS', ranked: 'SOLZ RANKED',
}

/**
 * WHAT EACH LANE IS - AND FOR OUTBID, WHETHER IT IS OPEN.
 *
 * THIS USED TO BE A FLAT RECORD AND IT LIED ONE CLICK AWAY. It asserted that
 * OUTBID "is the one lane anybody can enter today" with no knowledge of the
 * ladder at all, so with the sale shut this rail promised an enterable lane
 * while the OUTBID tab beside it said OUTBID IS NOT ENABLED YET - and over an
 * unreadable ladder it made the same promise on the strength of a 502.
 *
 * Three answers, because the ladder has three states. 'closed' is the sale
 * saying so; 'unknown' is nobody answering, and it states no verdict about the
 * sale at all. The other two lanes do not take the ladder: no price reaches
 * either of them, so the sale's state has nothing to say about how a coin
 * arrives through them.
 */
const laneBlurb = (lane: CatwalkLane, ladder: LadderState): string => {
  // TWO WAYS TO WIN THIS LANE, AND THE SENTENCE NAMES BOTH. Stating season wins
  // alone read as the only route, so a coin that took its position on
  // prediction-market volume looked unexplained in the one place the page
  // explains the lanes. What does NOT change is the second sentence: however a
  // champion arrived, no price reaches it. The champion rail's own lede carries
  // the same pair (CatwalkChampionRail.tsx) - one lane, one story.
  if (lane === 'champion') return 'Won its position on season wins, or by leading the prediction market on volume. No price reaches it and no ask is published for it.'
  if (lane === 'ranked') return 'Climbed the SOLZ ranked ladder and took its position free at season roll. Nothing paid, nothing bid.'
  if (ladder === 'closed') {
    return 'Paid for a seat on the spot ladder. It is the one lane anybody can enter — but bidding is closed right now, so no seat can be taken until it reopens.'
  }
  if (ladder === 'unknown') {
    return 'Paid for a seat on the spot ladder. It is the one lane anybody can enter. Whether a seat can be taken right now could not be read.'
  }
  return 'Paid for a seat on the spot ladder. It is the one lane anybody can enter today, and the one lane that can be taken off you — whoever pays the next ask stands where you stood.'
}

/**
 * What each BAND is, said in prose the legend owns.
 *
 * Keyed on `kind` rather than on the label, because the label is data: a board
 * with nothing under the runway calls its one band THE BOARD, and hardcoding
 * THE RUNWAY here would name a band the page is not drawing.
 *
 * It is authored twice over on purpose. Every `CatwalkBandHead` on the board is
 * `aria-hidden` by design - a head repeated above twelve rows would be read
 * twelve times - so this rail is the FIRST place a screen-reader user is told
 * what a runway is. The fix is prose here, never un-hiding the heads.
 */
const BAND_BLURB: Record<CatwalkBandKind, string> = {
  runway: 'These positions walk the MIAW PRIX every rotation. A coin holds one until a challenger walks it down.',
  lineup: 'One rotation away. Whoever stands here walks the band above in turn.',
}

/** A figure nobody has read is an em dash. Never a zero: zero is a count, and a
 *  count is a claim.
 *
 *  Exported so the ranked ladder's unread cells are the SAME mark rather than a
 *  second em dash somebody typed. One character, one meaning, one definition. */
export const DASH = '—'

/**
 * ONE LANE, NAMED ONCE.
 *
 * The swatch is a SWATCH here and not a `LaneChip`, for the reason this page
 * deletes things: the chip spells its lane out in words, so a chip beside a
 * heading printed OUTBID twice in a row - one fact stated twice, which at a
 * glance reads as two. It takes its colour the same way the chip does, off
 * `data-lane` resolving `--cw-hue` in catwalk.css, so no hex value is restated
 * and the palette still has exactly three numbers in it.
 *
 * The chip is still the right element in the seat rows below, where it is the
 * whole label and nothing repeats it.
 */
function LaneRow({ lane, ladder }: { lane: CatwalkLane; ladder: LadderState }) {
  return (
    <li className="cw-legend-lane">
      <span className="cw-legend-swatch" data-lane={lane} aria-hidden="true" />
      <strong>{LANE_TITLE[lane]}</strong>
      <p>{laneBlurb(lane, ladder)}</p>
    </li>
  )
}

/**
 * HOW LONG AGO, IN THE COARSEST UNIT THAT IS STILL TRUE.
 *
 * The page's `now` advances once a minute, so nothing finer than a minute can be
 * stated honestly and "just now" covers the first one. A future instant - a
 * clock skew between the server and this browser - reads as JUST NOW rather than
 * as a negative age or a date in the future.
 */
export function ageLabel(at: number, now: number): string {
  const elapsed = now - at
  if (elapsed < 60_000) return 'JUST NOW'
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}M AGO`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}H AGO`
  return `${Math.floor(hours / 24)}D AGO`
}

/* THE COUNTDOWN HAS LEFT THIS RAIL. A second, text-only face of the SAME lock
   instant used to sit here, three inches from the hero's and printing the same
   BOARD LOCKS IN - and it was the LAST element on the one rail that had it, so
   the answer to "when does it lock" sat below the fold on this tab and was
   absent from OUTBID, SOLZ RANKED and CHAMPIONS entirely. THE LOCK IS A PAGE
   FACT, NOT A TAB FACT: it is now the first thing in the rail's head on every
   tab, in CatwalkLockFace.tsx, and there is exactly one of it. */

export function CatwalkComposition({
  shape, seats = null, rankedLane = null, ladder = 'unknown', lastSeatPaidAt = null, leadMs = null,
  now = 0, pending = false,
}: {
  shape: CatwalkBoardShape
  /** The EFFECTIVE guaranteed plan, or null when the wire did not carry a whole
   *  readable one. Null omits the guarantees; it never prints a zero. */
  seats?: CatwalkSeatPlan | null
  rankedLane?: CatwalkRankedLaneRead | null
  /**
   * WHAT THE SALE IS DOING, because this rail makes a claim about it.
   *
   * It defaults to 'unknown' rather than 'open': a caller that has not read the
   * ladder has not read the ladder, and the OUTBID sentence then says so instead
   * of promising a lane anybody can enter on no evidence at all.
   */
  ladder?: LadderState
  /**
   * When a seat was last PAID for, epoch milliseconds, or null.
   *
   * A board-wide aggregate off the wire - never a per-coin purchase time, which
   * is a fact about a buyer and does not belong on this page. Null is an em
   * dash: a server that does not publish it, a board where nothing has sold and
   * an unparsable stamp are all "nobody has told us", never 1970.
   */
  lastSeatPaidAt?: number | null
  /** The server's own lock lead. Null drops the figure from the copy rather
   *  than guessing an interval the board does not keep. */
  leadMs?: number | null
  /** The page's own clock, handed down. Never `Date.now()` during render: two
   *  renders of the same board have to produce the same markup. */
  now?: number
  pending?: boolean
}) {
  /** How many positions each lane is standing in, within one band. Counted from
   *  the rows the board itself drew, so the rail and the table can never
   *  disagree about who is up there. */
  const occupancy = (kind: CatwalkBandKind, lane: CatwalkLane) =>
    shape.rows.filter((row) => row.band.kind === kind && row.lane === lane).length

  return (
    <section className="cw-legend" aria-labelledby="cw-legend-head">
      <h3 id="cw-legend-head">HOW THIS LIST IS PUT TOGETHER</h3>
      <p className="cw-legend-lede">
        MIAW PRIX decides nothing about who stands here. The board is filled from three
        lanes, and a position says which lane it was reached through.
      </p>

      <h4>THE LANES</h4>
      <ul className="cw-legend-lanes">
        {LANES.map((lane) => <LaneRow key={lane} lane={lane} ladder={ladder} />)}
      </ul>

      {/* THE BANDS, FROM THE BOARD'S OWN SHAPE. The label, the range and the
          note are all data on the band (catwalkBands.ts), so an admin moving
          activeSlots moves this rail with the table rather than leaving the two
          disagreeing about where the runway ends. The runway's swatch is
          `data-walks`, NOT a lane: those twelve positions are the product, and
          the one place position carries a colour on this page. */}
      {/**
        * HOW OFTEN A WALK HAPPENS - answered honestly, which means answering
        * that THIS BOARD DOES NOT DECIDE IT.
        *
        * The rail stated a lock and never said what it was a lock ON, so the
        * obvious question - every 12h? every 6h? does it follow the MIAW PRIX
        * card? - had no answer anywhere on the page. It is the third of those:
        * the cards come from the MIAW PRIX programme, and CATWALK only freezes
        * its board a fixed lead before the first card of a cycle.
        *
        * IT STATES NO CADENCE, because there is no cadence to state. Nothing on
        * the wire carries "a walk every N hours" - walks happen when the
        * programme schedules them - and inventing an interval here would be this
        * rail publishing a rule the server does not keep. The LEAD is a real
        * configured number and is stated when the board published one.
        */}
      <h4>HOW A WALK IS CALLED</h4>
      <p className="cw-legend-lede">
        MIAW PRIX schedules the cards; this board does not. When the first card of
        the next cycle comes within{' '}
        {leadMs ? <b>{leadHours(leadMs)} hours</b> : <>the pairing lead</>}, the whole
        board freezes and the pairings are drawn from it. Everything above is live
        until that moment and fixed after it — so there is no fixed interval
        between walks, only the programme's own schedule.
      </p>

      <h4>THE BANDS</h4>
      <ul className="cw-legend-bands">
        {shape.bands.map((band) => (
          <li key={band.key} data-walks={band.walks ? 'true' : undefined}>
            <span className="cw-legend-swatch" data-walks={band.walks ? 'true' : undefined} aria-hidden="true" />
            <strong>{band.label}</strong>
            <em>{bandRange(band)}</em>
            <small>{band.note}</small>
            <p>{BAND_BLURB[band.kind]}</p>

            {/* GUARANTEED SEATS, AND ONLY WHEN THE SERVER SENT THEM. A lane may
                take further positions when another lane cannot fill its own, and
                it hands every one of them back the moment that lane can - so a
                guarantee is the floor and never the count beside it. */}
            {pending
              ? null
              : <ul className="cw-legend-seats">
                  {LANES.map((lane) => (
                    <li key={lane}>
                      <LaneChip lane={lane} />
                      {seats ? <b>GUARANTEED {seats[band.kind][lane]}</b> : null}
                      <i>{occupancy(band.kind, lane)} STANDING</i>
                    </li>
                  ))}
                </ul>}
          </li>
        ))}
      </ul>

      {/* WHAT THE BOARD IS DOING, in figures it has already drawn.
          A MOVEMENT still has no timestamp anywhere on the wire - nothing
          publishes when a coin changed position, and dating one out of the
          ranked registry's own read time would date the wrong event. A PAID
          SEAT does: `catwalk_bids` carries the instant, and the board now
          publishes the newest of them as one aggregate. So the row below is
          LAST SEAT PAID and is not labelled "latest change", because a sale is
          the only change this page can honestly date. */}
      {!pending
        ? <>
            <h4>WHERE IT STANDS</h4>
            <dl className="cw-legend-stats">
              <div><dt>ON THE BOARD</dt><dd>{shape.claimed} OF {shape.rows.length}</dd></div>
              <div><dt>WALKING IN</dt><dd>{shape.walkingClaimed} OF {shape.activeSlots}</dd></div>
              <div>
                <dt>LADDER FLOOR</dt>
                {/* THREE ANSWERS, NOT TWO. This printed the same em dash whether
                    the sale had ANSWERED that it is shut or nobody had answered
                    at all - in a file whose own DASH is documented as "a figure
                    nobody has read". A closed ladder is a read that succeeded
                    and it says CLOSED; the dash is kept for the two cases where
                    there genuinely is no figure to state. */}
                <dd className={shape.floorUsdMicros ? 'cw-money' : undefined}>
                  {shape.floorUsdMicros
                    ? usdLabel(shape.floorUsdMicros)
                    : ladder === 'closed' ? 'CLOSED' : DASH}
                </dd>
              </div>
              <div>
                <dt>LAST SEAT PAID</dt>
                <dd>{lastSeatPaidAt && now ? ageLabel(lastSeatPaidAt, now) : DASH}</dd>
              </div>
              {/* Only over a 'ready' read. A registry nobody has opened and one
                  whose read failed both carry `candidates: 0`, so printing it
                  unconditionally states "nobody is queued to climb in" every
                  time the network blinks. */}
              {rankedLane?.state === 'ready'
                ? <div><dt>RANKED CANDIDATES</dt><dd>{rankedLane.candidates}</dd></div>
                : null}
            </dl>
          </>
        : null}

    </section>
  )
}
