import { useEffect, useState } from 'react'
import { leadHours, type CatwalkLock } from './catwalkLock'

/**
 * WHEN THIS BOARD NEXT LOCKS - the one countdown on this page a holder can act
 * on, and now the one countdown on this page full stop.
 *
 * IT USED TO BE TWO. The hero carried this clock and the composition rail
 * carried a second, text-only face of the SAME instant three inches away, both
 * printing BOARD LOCKS IN. The rail's face was also the LAST element on the one
 * rail that had it, so the answer to "when does it lock" sat below the fold on
 * the MIAW PRIX tab and was absent from OUTBID, SOLZ RANKED and CHAMPIONS
 * entirely - while the hero's copy scrolled away the moment the tab bar stuck
 * to the top of the viewport.
 *
 * THE LOCK IS A PAGE FACT, NOT A TAB FACT. So this face moved out of both and
 * into the head of the rail, where it is the first thing in the column on every
 * tab and in every read state. There is exactly one of it, which is what keeps
 * the page's single `role="timer"` region single: promoting either copy without
 * deleting the other would have made two clocks of one instant unmissable.
 *
 * THIS IS THE HERO'S CLOCK, MOVED VERBATIM, because it was the accurate one. Its
 * chained timeout re-picks a 1s or 60s period from the remainder it just read,
 * so it shows seconds in the final hours - where the deleted rail face
 * deliberately carried none, the page's own `now` advancing only once a minute.
 *
 * AND THE LOCK IS NEVER DERIVED HERE. It is the page's single `lock` memo,
 * handed down as a prop. A rail computing its own would return 'unread' for a
 * null board and print NO ROTATION IS SCHEDULED YET over a 502 while another
 * surface correctly said the read had failed.
 */

const DAY = 86_400_000

/**
 * Whether the viewer asked for less motion. It lives here rather than in
 * CatwalkHero.tsx because the clock's tick is the only motion it governs on
 * this page; CatwalkHero re-exports it so no host has to know it moved.
 */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return
    setReduced(query.matches)
    const listen = () => setReduced(query.matches)
    query.addEventListener('change', listen)
    return () => query.removeEventListener('change', listen)
  }, [])
  return reduced
}

/**
 * The lock clock's digits.
 *
 * Under a day: HH:MM:SS, bare, because the thing being counted is a twelve-hour
 * pairing window and a `00:` day column that can never be anything else is a
 * column of noise. A day or more: `02D 05:30`, with the day field LABELLED and
 * the seconds dropped - nobody reads the second hand of a three-day countdown,
 * and src/components/miawprix/board.ts:167 makes the same argument for the same
 * schedule on the sibling page.
 *
 * THE `D` IS NOT DECORATION. Both regimes want three figures, so an unlabelled
 * `01:00:00` meant twenty-four hours in one and one hour in the other - the
 * same six digits for two answers a day apart, on the one clock this page
 * expects a holder to act on.
 *
 * ui.tsx's shared Countdown is the app's clock but its formatClock tops out at
 * hours, so a multi-day remainder reads `73:04:11` there. Lifting both this and
 * a reduced-motion tick into ui.tsx is the right home for them once it is safe
 * to change a component every other surface renders.
 */
export function clockParts(remaining: number, withSeconds: boolean) {
  const total = Math.max(0, remaining)
  const pad2 = (field: number) => String(field).padStart(2, '0')
  const days = Math.floor(total / DAY)
  const hours = Math.floor((total % DAY) / 3_600_000)
  const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1_000)
  if (days > 0) return `${pad2(days)}D ${pad2(hours)}:${pad2(minutes)}`
  return [hours, minutes, ...(withSeconds ? [seconds] : [])].map(pad2).join(':')
}

/**
 * THREE STATED OUTCOMES AND ONE SILENCE.
 *
 * A schedule nobody has read yet returns null and the clock draws its own
 * skeleton; a schedule that could not be READ says exactly that and never "no
 * rotation scheduled", which is a claim about the programme rather than about
 * the network.
 *
 * 'unread' is returned as null rather than folded into the unreadable sentence.
 * The two are one keystroke apart in a switch and a whole lie apart on screen,
 * and the fallthrough version told every caller that omitted a lock prop - every
 * test, and any host rendering this on its own - that the network had failed.
 */
export function lockFace(lock: CatwalkLock, now: number, withSeconds: boolean, leadMs?: number | null) {
  // THE RULE IS STATED FROM THE SERVER'S OWN LEAD, never from a literal. This
  // line read "PAIRINGS BIND 12H BEFORE THE WALK" whatever `lockLeadMs` was set
  // to, so an operator who moved it had the page stating a rule the board does
  // not keep. With no lead published the sentence drops the number rather than
  // guessing one.
  const bind = leadMs && leadMs > 0
    ? `PAIRINGS BIND ${leadHours(leadMs)}H BEFORE THE WALK`
    : 'PAIRINGS BIND BEFORE THE WALK'
  if (lock.state === 'unread') return null
  if (lock.state === 'counting') {
    return {
      label: 'BOARD LOCKS IN',
      value: clockParts(Math.max(0, lock.locksAt - now), withSeconds),
      note: bind,
      timer: true,
    }
  }
  if (lock.state === 'open') {
    /**
     * THE WINDOW IS RUNNING, SO COUNT TO THE WALK INSTEAD OF THE LOCK.
     *
     * This branch used to render a static 'LOCKED' and no clock at all, which is
     * why the page could sit for hours with no countdown anywhere on it: once
     * every scheduled rotation is inside its twelve-hour pairing window there is
     * no future LOCK to count to, and the face simply stopped counting.
     *
     * But there is always something ahead - `nextCatwalkLock` only reaches this
     * branch for a kickoff that has NOT happened yet (`schedulable` drops every
     * past one), so `startsAt` is a real instant in the future and counting to it
     * is a fact, not a guess. The note says which instant it is, so a viewer is
     * never told a pairing deadline when they are being shown a kickoff.
     */
    return {
      // THE HEADING CHANGES WITH THE FACE. It was a hardcoded BOARD LOCKS IN
      // above every state, so this branch read "BOARD LOCKS IN / 04:12:00 /
      // PAIRED" - a pairing deadline printed over a kickoff. The clock now names
      // the instant it is actually counting to.
      label: 'THE WALK BEGINS IN',
      value: clockParts(Math.max(0, lock.startsAt - now), withSeconds),
      note: 'PAIRED — THIS BOARD IS BOUND',
      timer: true,
    }
  }
  if (lock.state === 'none') return { label: 'BOARD LOCKS IN', value: '—', note: 'NO ROTATION IS SCHEDULED YET', timer: false }
  return { label: 'BOARD LOCKS IN', value: '—', note: 'THE SCHEDULE COULD NOT BE READ', timer: false }
}

/** The clock's box with nothing stated in it. Same height either way, so the
 *  rail does not move a pixel when the schedule read lands.
 *
 *  IT IS NOT A DASH AND IT IS NOT A ROW. `aria-hidden` and no text at all: a
 *  schedule nobody has asked about is a silence, and an em dash here would be
 *  an answer to a question that has not been put yet. */
export function ClockPending() {
  return (
    <div className="cw-clock cw-clock--pending" aria-hidden="true">
      <i className="cw-pending cw-pending--word" />
      <i className="cw-pending cw-pending--num" />
    </div>
  )
}

export function CatwalkClock({ lock, leadMs }: { lock: CatwalkLock; leadMs?: number | null }) {
  const reduced = useReducedMotion()
  const [now, setNow] = useState(() => Date.now())
  // WHICHEVER INSTANT THE FACE IS COUNTING TO. It was `locksAt` alone, so when
  // the pairing window opened - the state that now counts to kickoff - the
  // ticker never started and the clock sat frozen at whatever it read on mount.
  const locksAt = lock.state === 'counting' ? lock.locksAt : lock.state === 'open' ? lock.startsAt : 0
  useEffect(() => {
    if (!locksAt) return
    setNow(Date.now())
    // A CHAINED TIMEOUT, NOT AN INTERVAL, BECAUSE THE RIGHT PERIOD CHANGES.
    //
    // A twelve-hour window is worth a second hand; a multi-day wait is not, and
    // neither is any of it under reduced motion. An interval picks its period
    // ONCE, at mount, so a lock set 25 hours out kept its minute tick as the
    // remainder fell under a day - and clockParts had by then switched to a
    // seconds column that only moved once a minute. Each tick now chooses the
    // next delay from the remainder it just read.
    let timer = 0
    const tick = () => {
      // CLEARED BEFORE IT IS RE-ARMED. `tick` is called again by the resync
      // listeners below, and without this each visibilitychange would leave the
      // previous timeout running - so a page switched away from and back to a
      // few times would end up with a handful of chains all ticking the same
      // state, at increasing cost for no extra accuracy.
      window.clearTimeout(timer)
      const at = Date.now()
      setNow(at)
      const remaining = locksAt - at
      if (remaining <= 0) return
      timer = window.setTimeout(tick, reduced || remaining > DAY ? 60_000 : 1_000)
    }
    tick()
    /**
     * AND IT RESYNCS THE MOMENT THE PAGE IS LOOKED AT AGAIN.
     *
     * A chained timeout is at the mercy of the browser: a hidden tab has its
     * timers clamped to about once a minute and, after a few minutes hidden,
     * frozen outright. So the clock genuinely STOPPED while the tab was in the
     * background and then sat on a stale figure until the next tick happened to
     * fire - which is the "it gets paused when I switch tabs" everybody sees.
     *
     * `tick()` is idempotent: it reads the clock, re-renders, and re-arms. So
     * both listeners can simply call it, and a page brought back to the front is
     * correct in the same frame rather than up to a minute later.
     */
    const resync = () => { if (document.visibilityState === 'visible') tick() }
    document.addEventListener('visibilitychange', resync)
    window.addEventListener('focus', resync)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', resync)
      window.removeEventListener('focus', resync)
    }
  }, [locksAt, reduced])

  const face = lockFace(lock, now, !reduced, leadMs)
  if (!face) return <ClockPending />
  return (
    <div className="cw-clock" data-lock={lock.state}>
      <small>{face.label}</small>
      <b {...(face.timer ? { role: 'timer', 'aria-live': 'off' as const } : {})}>{face.value}</b>
      <span>{face.note}</span>
    </div>
  )
}
