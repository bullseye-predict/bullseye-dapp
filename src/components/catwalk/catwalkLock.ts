import { PAIRING_LOCK_MS } from '../miawprix/board'
import type { CatwalkBoard } from '../solz/catwalkSource'

/**
 * WHEN THIS BOARD NEXT LOCKS.
 *
 * CATWALK binds one complete MIAW PRIX cycle `PAIRING_LOCK_MS` before the
 * cycle's first kickoff, so the board a viewer is looking at stops mattering
 * for all matches in that walk at the same moment. That instant is the one
 * countdown on this page a holder can act on:
 * the season's own end is a month away and tells nobody whether there is still
 * time to take a slot for the next walk.
 *
 * THE LOCK IS READ FROM THE BOARD AUTHORITY. The public programme deliberately
 * carries assigned cards only, so it cannot reveal the first unbound slot. The
 * board payload names that slot's `startsAt` and `locksAt` together; the page
 * never manufactures one deadline per visible match again.
 *
 * AND IT IS FIVE-VALUED, FOR THE REASON EVERYTHING ELSE ON THIS PAGE IS. A read
 * that has not landed, a read that failed, and a programme with nothing
 * scheduled are three different facts, and only the last of them is about the
 * schedule. Collapsing them would put NO ROTATION SCHEDULED on the hero every
 * time the proxy returned a 502 - the same lie `LadderState` and
 * `StandingsState` exist to prevent.
 */
export type CatwalkLock =
  /** Nobody has asked the board yet. Say nothing at all. */
  | { state: 'unread' }
  /** The board read failed or lacks the authority field. This is never evidence
   *  about the schedule: it must not render as "no rotation scheduled". */
  | { state: 'unreadable' }
  /** The board authority found no upcoming unbound cycle. */
  | { state: 'none' }
  /** The next cycle's lock window has already opened - kickoff is less than
   *  PAIRING_LOCK_MS away - so there is no time left to count down to. */
  | { state: 'open'; startsAt: number }
  /** The lock is ahead. `locksAt` is the instant, `startsAt` the kickoff it was
   *  derived from, so a renderer can name either without recomputing it. */
  | { state: 'counting'; locksAt: number; startsAt: number }

export const LOCK_WINDOW_MS = PAIRING_LOCK_MS

/**
 * The next lock, from the board read.
 *
 * `undefined` means an older/unreadable board did not publish the fact; `null`
 * means the authority read the schedule and found no unbound cycle. Keeping
 * those apart prevents an absent field from becoming a confident NO SCHEDULE.
 */
/** The lead in whole hours, for copy that states it. Rounded, because a lead of
 *  12h 0m 1s is twelve hours to a reader and the copy is a rule, not a clock. */
export const leadHours = (leadMs: number) => Math.max(1, Math.round(leadMs / 3_600_000))

/**
 * The server publishes both instants because `lockLeadMs` is configurable. The
 * browser validates and renders them; it does not subtract the lead itself.
 */
export function nextCatwalkLock(
  timing: CatwalkBoard['nextCycleLock'],
  now: number,
): CatwalkLock {
  if (timing === undefined) return { state: 'unreadable' }
  if (timing === null) return { state: 'none' }
  if (timing.locksAt > now)
    return { state: 'counting', locksAt: timing.locksAt, startsAt: timing.startsAt }
  // The cycle is due but has not acquired its atomic cycle index yet. This is
  // an operational state, not permission to skip to its second match and start
  // another countdown.
  return { state: 'open', startsAt: timing.startsAt }
}
