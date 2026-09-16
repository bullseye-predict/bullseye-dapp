import { PAIRING_LOCK_MS, matchState } from '../miawprix/board'
import type { MiawPrixBoard, MiawPrixMatch } from '../miawprix/miawPrixSource'

/**
 * WHEN THIS BOARD NEXT LOCKS.
 *
 * CATWALK binds a MIAW PRIX pairing `PAIRING_LOCK_MS` before kickoff, so the
 * board a viewer is looking at stops mattering for the next rotation at that
 * moment. That instant is the one countdown on this page a holder can act on:
 * the season's own end is a month away and tells nobody whether there is still
 * time to take a slot for the next walk.
 *
 * THE LOCK IS DERIVED, NOT READ. The programme wire carries `scheduledStartAt`
 * per match and NOTHING ELSE about timing - no lock field, no rotation cadence.
 * The twelve hours come from `PAIRING_LOCK_MS`, which is imported rather than
 * re-declared here: two copies would let /catwalk and /miaw-prix disagree about
 * when a pairing binds, on one product, from one schedule.
 *
 * AND IT IS FIVE-VALUED, FOR THE REASON EVERYTHING ELSE ON THIS PAGE IS. A read
 * that has not landed, a read that failed, and a programme with nothing
 * scheduled are three different facts, and only the last of them is about the
 * schedule. Collapsing them would put NO ROTATION SCHEDULED on the hero every
 * time the proxy returned a 502 - the same lie `LadderState` and
 * `StandingsState` exist to prevent.
 */
export type CatwalkLock =
  /** Nobody has asked the programme yet. Say nothing at all. */
  | { state: 'unread' }
  /** The programme read failed. This is a fact about the network, never about
   *  the schedule: it must not be rendered as "no rotation scheduled". */
  | { state: 'unreadable' }
  /** The programme answered and has no upcoming match with a kickoff on it. */
  | { state: 'none' }
  /** The next rotation's lock window has already opened - kickoff is less than
   *  PAIRING_LOCK_MS away - so there is no time left to count down to. */
  | { state: 'open'; startsAt: number }
  /** The lock is ahead. `locksAt` is the instant, `startsAt` the kickoff it was
   *  derived from, so a renderer can name either without recomputing it. */
  | { state: 'counting'; locksAt: number; startsAt: number }

export const LOCK_WINDOW_MS = PAIRING_LOCK_MS

/**
 * A match that could still lock: on the calendar, not settled, not cancelled,
 * and not already past its kickoff.
 *
 * `scheduledStartAt` is 0 when the programme has not scheduled a match yet (see
 * `MiawPrixMatch.scheduledStartAt`), and 0 is not a kickoff.
 *
 * THE `now` BOUND IS LOAD-BEARING. `matchState` reads a row with no result and a
 * 'scheduled' status as UPCOMING however old it is, so a fixture the programme
 * never settled sits there for ever - and without this bound the last branch
 * below answered 'open' about it, putting THE NEXT WALK IS ALREADY PAIRING on
 * the hero for a kickoff three days gone.
 */
const schedulable = (match: MiawPrixMatch, now: number) => {
  const state = matchState(match)
  return match.scheduledStartAt > now && state !== 'final' && state !== 'cancelled'
}

/**
 * The next lock, from the programme read.
 *
 * It looks for the earliest kickoff whose lock is STILL AHEAD rather than
 * simply the earliest kickoff: a rotation already inside its twelve-hour window
 * has locked, and counting down to an instant in the past would render a clock
 * that never moves. Only when every scheduled rotation is already inside its
 * window does the answer become 'open', which says the window is running rather
 * than that the schedule is empty.
 */
/** The lead in whole hours, for copy that states it. Rounded, because a lead of
 *  12h 0m 1s is twelve hours to a reader and the copy is a rule, not a clock. */
export const leadHours = (leadMs: number) => Math.max(1, Math.round(leadMs / 3_600_000))

/**
 * @param leadMs How far ahead of kickoff the board freezes. THE SERVER'S OWN
 *   `lockLeadMs` when it published one; `PAIRING_LOCK_MS` is only a fallback for
 *   a server that has not shipped the field. It used to be this constant
 *   unconditionally, so an operator who moved the lead got a page counting to an
 *   instant the server did not agree with.
 */
export function nextCatwalkLock(board: MiawPrixBoard | null, now: number, leadMs: number = PAIRING_LOCK_MS): CatwalkLock {
  if (!board) return { state: 'unread' }
  const scheduled = board.matches.filter((match) => schedulable(match, now)).sort((a, b) => a.scheduledStartAt - b.scheduledStartAt)
  if (!scheduled.length) return { state: 'none' }
  const lead = Number.isFinite(leadMs) && leadMs > 0 ? leadMs : PAIRING_LOCK_MS
  const ahead = scheduled.find((match) => match.scheduledStartAt - lead > now)
  if (ahead) {
    return { state: 'counting', locksAt: ahead.scheduledStartAt - lead, startsAt: ahead.scheduledStartAt }
  }
  // Every rotation still ahead is inside its window, so the nearest kickoff is
  // the one the board is being read for right now. A kickoff already in the past
  // never reaches here - `schedulable` drops it - so 'open' always names a walk
  // that has not happened yet.
  return { state: 'open', startsAt: scheduled[0]!.scheduledStartAt }
}
