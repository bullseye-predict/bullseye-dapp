import {
  onRpcGateChange,
  rpcCooldownRemaining,
  signingInFlight,
  signingSettlesInMs,
} from '../../../../packages/adapters/solana/manifest/throttle'

/**
 * Whether a background chain reader may make its next request.
 *
 * Three reasons it may not, and all three share the same shape: nobody is
 * reading the answer, or the endpoint has asked for less traffic.
 *
 *  - The page is hidden. A tab in the background polled the chain at full rate
 *    for as long as it stayed open, and several tabs multiplied that against
 *    one rate limit.
 *  - A wallet run is signing. Every request a poller makes during a trade
 *    takes a slot from the transaction the trader is watching.
 *  - The endpoint returned 429. The transport records it and stops retrying;
 *    standing down here is the half that actually reduces traffic.
 *
 * This is only for BACKGROUND readers. A trade's own reads, and a read a
 * person just asked for by opening a panel, always go.
 */
export type PollBlock = { blocked: boolean; retryInMs: number; reason: 'hidden' | 'signing' | 'throttled' | null }

/** Server-rendered and test environments have no document; treat them as
 *  visible so a non-browser caller is never silently parked forever. */
const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

/** How long a hidden page waits before looking again. A hidden tab is woken by
 *  the visibility event, so this is only a backstop for a browser that does
 *  not fire one. */
const HIDDEN_RECHECK_MS = 60_000

export function pollBlocked(now = Date.now()): PollBlock {
  const cooldown = rpcCooldownRemaining(now)
  // Throttling first: it is the one the user is actually being hurt by, and
  // the one whose remaining time is worth reporting.
  if (cooldown > 0) return { blocked: true, retryInMs: cooldown, reason: 'throttled' }
  if (signingInFlight(now)) return { blocked: true, retryInMs: signingSettlesInMs(now), reason: 'signing' }
  if (hidden()) return { blocked: true, retryInMs: HIDDEN_RECHECK_MS, reason: 'hidden' }
  return { blocked: false, retryInMs: 0, reason: null }
}

/**
 * Run `task` after `delayMs`, unless the gate is shut — then wait for it.
 *
 * A drop-in replacement for the `setTimeout(load, 10_000)` that every venue
 * poller re-arms itself with. Returns a cancel function, so the cleanup that
 * used to be `clearTimeout(timer)` becomes `timer?.()`.
 *
 * A woken poller waits a short random extra beat. Every poller on the page is
 * released by the same event, and sending all of them at the identical
 * millisecond is how a page recovering from a cooldown earns the next one.
 */
export function schedulePoll(task: () => void, delayMs: number, random = Math.random): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false
  let unsubscribe: (() => void) | undefined
  let listening = false

  const stopListening = () => {
    if (!listening) return
    listening = false
    unsubscribe?.()
    unsubscribe = undefined
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', wake)
  }

  const arm = (ms: number) => {
    clearTimeout(timer)
    timer = setTimeout(tick, Math.max(0, ms))
  }

  function wake() {
    if (cancelled || pollBlocked().blocked) return
    stopListening()
    // 0-750ms of stagger, so a page full of pollers does not resume in lockstep.
    arm(random() * 750)
  }

  const tick = () => {
    if (cancelled) return
    const gate = pollBlocked()
    if (!gate.blocked) {
      stopListening()
      task()
      return
    }
    if (!listening) {
      listening = true
      unsubscribe = onRpcGateChange(wake)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake)
    }
    // The events above are the normal way out; this is the backstop for a
    // cooldown that simply elapses with nothing to announce it.
    arm(Math.min(gate.retryInMs, HIDDEN_RECHECK_MS))
  }

  arm(delayMs)
  return () => {
    cancelled = true
    clearTimeout(timer)
    stopListening()
  }
}
