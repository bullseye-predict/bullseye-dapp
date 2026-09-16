import { ArrowUpRight, Crown, Receipt } from 'lucide-react'
import { TeamMark } from '../home/HomePrimitives'
import { catwalkSeasonLabel, type CatwalkSeason } from '../solz/catwalkSource'
import { SegBar } from '../solz/ui'
import { catwalkFront, pad, type CatwalkBoardShape, type CatwalkRow } from './catwalkBands'
import { LaneChip } from './CatwalkSlotRow'

/* THE CLOCK HAS LEFT THIS FILE. `CatwalkClock`, `ClockPending`, `lockFace`,
   `clockParts` and `useReducedMotion` now live in CatwalkLockFace.tsx and are
   mounted at the HEAD OF THE RAIL, on every tab - see that file for why one
   clock became the rule rather than two. Both are re-exported here so no caller
   has to learn where they went. */
export { clockParts, useReducedMotion } from './CatwalkLockFace'

/**
 * The head of the board: the season, the runway rail, and the three cards at
 * the front of the walk.
 *
 * It used to carry a six-cell counter strip and a four-cell explainer under it,
 * which between them restated every figure the board states again below and cost
 * the page two full rows above the fold. Both are gone; the board explains
 * itself in its band heads and its lane chips, where the thing being explained
 * is the next thing the eye lands on.
 *
 * The hero always renders exactly three cards, whatever the fill - never two,
 * never four - so an empty board is the same code path as a full one and there
 * is no separate launch screen to maintain. WHICH three is decided by
 * `catwalkFront` (see catwalkBands.ts): champions first, then every other
 * holder in board order, then vacancies. They are a choice across the lanes and
 * not a slice of the board, so a card's big number is THAT COIN'S BOARD SLOT and
 * never its place in this row of three.
 *
 * THE ONE THING IT WILL NOT DO IS COUNT BEFORE IT HAS READ. Until the board read
 * lands, the fill of the board is unknown, and an unknown number is not zero:
 * every count, the headline that summarises them and the three plinths render as
 * skeletons of exactly the size they will occupy, and state nothing. Rendering
 * the default shape as fact told every first-frame viewer the board was empty
 * while it may have been full.
 */

const DAY = 86_400_000

/** Days remaining in the season, rounded up. Rendered beside the season number
 *  in the kicker - two labelled items, never "SEASON 07 · 4d". */
export function daysLeft(season: CatwalkSeason | null, now: number) {
  if (!season?.endsAt) return null
  return Math.max(0, Math.ceil((season.endsAt - now) / DAY))
}

/**
 * THE CROWN GATE. A crown renders if and only if the coin holds the slot through
 * the champion lane. A coin holding the front of the walk because it outbid
 * wears a receipt instead, and a ranked holder wears neither.
 *
 * `catwalkFront` now puts champions in card one, so card one and the champion
 * lane coincide on nearly every board - and that correlation must never become
 * the gate. Simplifying this to `rank === 1` would tell the viewer a coin won
 * MIAW PRIX when it merely paid, which is the one distinction the whole product
 * turns on, and it would do so silently the first time a board has no champion.
 */
function HeroBadge({ lane }: { lane: CatwalkRow['lane'] }) {
  if (lane === 'champion') return <Crown className="cw-crown" size={38} aria-hidden="true" />
  if (lane === 'outbid') return <Receipt className="cw-bought" size={28} aria-hidden="true" />
  return null
}

/**
 * One card at the front of the walk.
 *
 * `rank` is WHERE IN THIS ROW OF THREE the card sits - 1, 2, 3 - and it is
 * `data-pos`, which is the only thing catwalk.css keys the sizes, tilts and
 * metals off. `row.spot` is the coin's BOARD POSITION, and it is what the card
 * prints and what it says out loud. The two used to be one integer because the
 * hero took board slots 01-03 by number; they are different questions and the
 * card must never print one as the other.
 */
function HeroCard({ rank, row, pending }: {
  rank: number; row: CatwalkRow | null; pending: boolean
}) {
  const team = row?.entry?.team ?? null
  const open = !row || row.lane === 'open'

  // The plinth at its full size with nothing written on it.
  //
  // It does NOT carry `cw-hero-card--open`. Withholding the word OPEN was only
  // half the job: that class is this page's visual vocabulary for a vacancy -
  // dashed edge, unlit fill, ghosted number - so the first frame painted three
  // vacancies before any read landed, which is the same claim in paint rather
  // than in words. `--pending` owns its own neutral treatment in catwalk.css.
  //
  // It carries no number either: before the read there is no telling WHICH
  // three positions stand here.
  if (pending) {
    return (
      <div className="cw-hero-card cw-hero-card--pending" data-pos={rank}>
        <div className="cw-hero-face">
          <i className="cw-pending cw-pending--plinth" aria-hidden="true" />
          <i className="cw-pending cw-pending--act" aria-hidden="true" />
        </div>
      </div>
    )
  }

  // A PLINTH CARRIES NO PRICE. The number on it is a board position, and board
  // positions are not sold: the ladder seat with the matching number may be held
  // by someone else entirely, and pricing the front of the walk from it sold a
  // stranger's seat off the hero. The plinth states the vacancy only.
  if (open) {
    return (
      <div className="cw-hero-card cw-hero-card--open" data-pos={rank}>
        <div className="cw-hero-face">
          <i aria-hidden="true">{row ? pad(row.spot) : '—'}</i>
          <strong>OPEN</strong>
          <span className="cw-hero-fills">FILLS FROM THE LANES</span>
        </div>
      </div>
    )
  }

  return (
    <div className="cw-hero-card" data-pos={rank}>
      <HeroBadge lane={row!.lane} />
      <span className="cw-hero-position" aria-label={`Slot ${row!.spot}`}>{pad(row!.spot)}</span>
      <div className="cw-hero-face">
        <TeamMark id={team?.id ?? row!.entry!.mint} color={team?.color} logoUrl={team?.logoUrl} className="cw-hero-mark" />
        <i className="cw-hero-scrim" aria-hidden="true" />
      </div>
      <div className="cw-hero-name">
        <b>{team?.symbol ?? '—'}</b>
        <small>{team?.name ?? row!.entry!.mint}</small>
        {/* Two labelled figures on a rule, not "3 W · 0 L": the middle dot was
            doing the work a column gap does better, and this page was leaning
            on it in nine different places. */}
        {row!.standing
          ? <span className="cw-hero-record"><b>{row!.standing.wins}W</b><b>{row!.standing.losses}L</b></span>
          : row!.recordKnown
            ? <span className="cw-hero-norecord">NO WALKS YET</span>
            : <span className="cw-hero-norecord" title="The season record could not be read.">RECORD UNAVAILABLE</span>}
        <LaneChip lane={row!.lane} />
      </div>
    </div>
  )
}

/**
 * THE REACT KEY FOR ONE FRONT CARD.
 *
 * Keyed on the COIN, because this row of three reorders between polls - a
 * champion settles, a seat is bought - and an index key would have React reuse a
 * champion card's crown, mark and metal for whichever coin landed there next.
 *
 * A card with NO ROW keys on its position in the row, not on a spot it does not
 * have. `slot-${row?.spot ?? index}` mixed a 1-based board spot with a 0-based
 * card index, so on a two-slot board card three claimed 'slot-2' - the key the
 * vacancy at spot 02 already held, and React collapses a duplicate key onto one
 * element. Exported so that collision is testable: a duplicate key is invisible
 * in rendered markup, so nothing in the DOM can prove its absence.
 */
export function frontCardKey(row: CatwalkRow | null, index: number): string {
  if (!row) return `card-${index}`
  return row.entry?.mint ?? `slot-${row.spot}`
}

export type HeroProps = {
  shape: CatwalkBoardShape
  season: CatwalkSeason | null
  /* NO `lock` PROP. The hero does not state the lock any more - the one clock
     on this page is in the head of the rail, where it survives the tab bar
     sticking to the top of the viewport. Keeping an ignored prop here would
     have let a caller believe it was still handing the hero a countdown. */
  /** Where the MIAW PRIX programme lives. The kicker names the season this
   *  board walks in, so the name is the link to it. */
  miawPrixHref?: string
  /** True until the BOARD read lands. Nothing countable may be stated. It is
   *  deliberately not reused for the schedule: that read fails independently. */
  pending?: boolean
  /** The clock in `now`, from the page's own 60-second tick, so the season's
   *  remaining days and every other figure on the page agree.
   *
   *  ZERO MEANS NO CLOCK WAS SUPPLIED, and the kicker then states no days left
   *  rather than measuring the season from the epoch - which printed 20716D LEFT
   *  for any caller that omitted it. */
  now?: number
  /** Sends the viewer to the spot ladder. Passed only when the ladder is open
   *  and has an unheld seat, because that is the only time there is one to take. */
  onLadder?: () => void
}

export function CatwalkHero({
  shape, season, miawPrixHref = '/miaw-prix',
  pending = false, now = 0, onLadder,
}: HeroProps) {
  const front = catwalkFront(shape)
  // `claimed`, not `walkingClaimed`: the front row draws from every lane and
  // every band, so a champion standing at slot 20 puts a coin on this page that
  // the walk-in count does not know about. Gating the headline on the narrower
  // figure rendered "NOBODY HAS WALKED IN YET" over three occupied cards.
  const empty = shape.claimed === 0
  const headline = empty ? 'NOBODY HAS WALKED IN YET' : `THE TOP ${shape.activeSlots} WALK EVERY MIAW PRIX ROTATION`
  const label = catwalkSeasonLabel(season)
  const remaining = now ? daysLeft(season, now) : null
  return (
    <section className="cw-hero">
      <div className="cw-hero-season">
        {/* Labelled items rather than "MIAW PRIX · SEASON 00 · 4d". The season's
            own end lives here now that the counter strip that held it is gone:
            it is context for the programme's name, not a figure to act on. */}
        <span className="cw-kicker">
          <i aria-hidden="true" />
          <a href={miawPrixHref}>MIAW PRIX</a>
          {label ? <em>{label}</em> : null}
          {remaining === null ? null : <em>{remaining}D LEFT</em>}
        </span>
        {pending
          ? <div className="cw-hero-intro cw-hero-intro--pending" aria-busy="true"><h1>Catwalk</h1><i className="cw-pending cw-pending--line" aria-hidden="true" /><span className="sr-only">Reading the board.</span></div>
          : <div className="cw-hero-intro">
              <h1>Catwalk</h1>
              <h2>{empty ? <>The spotlight<br />is yours to take.</> : <>{front[0]?.entry?.team?.symbol ?? 'Meet the front row.'}</>}</h2>
              <span className="sr-only">{headline}</span>
              <a className="cw-hero-link" href="#cw-list" onClick={onLadder}>{onLadder ? 'Explore the spot ladder' : 'Explore the board'}<ArrowUpRight size={17} aria-hidden="true" /></a>
            </div>}
        {/* THE CLOCK USED TO SHARE THIS ROW. It is in the head of the rail now,
            on every tab: the hero is the first thing off screen once the tab bar
            sticks, which is precisely why the one countdown a holder acts on
            must not live here. The claim rail keeps the row to itself. */}
        <div className="cw-hero-meta">
          <div className="cw-claim-rail">
            {pending
              ? <>
                  <span><i className="cw-pending cw-pending--word" aria-hidden="true" /></span>
                  <i className="cw-pending cw-pending--seg" aria-hidden="true" />
                </>
              : <>
                  <span>{shape.walkingClaimed} OF {shape.activeSlots} ON THE RUNWAY</span>
                  {/* Segments, not a percentage: two lit ticks out of twelve reads
                      as a countable start, where a 17% bar reads as failure. */}
                  <SegBar value={shape.walkingClaimed} total={shape.activeSlots} cells={shape.activeSlots} tone="acid" label="Runway slots claimed" />
                </>}
          </div>
        </div>
      </div>
      <div className="cw-hero-front">
        {/* Keyed on the COIN, not on the card index. This row of three reorders
            between polls - a champion settles, a seat is bought - and an index
            key would have React reuse a champion card's crown, mark and metal
            for whichever coin landed in that position next. */}
        {[0, 1, 2].map((index) => {
          const row = front[index] ?? null
          return <HeroCard key={frontCardKey(row, index)} rank={index + 1} row={row} pending={pending} />
        })}
      </div>
    </section>
  )
}
