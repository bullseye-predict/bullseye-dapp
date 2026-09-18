/**
 * What the RPC endpoint is currently willing to take, and whether a wallet run
 * is in the middle of asking for it.
 *
 * Two facts, one module, because they answer the same question: may a
 * background reader make a request right now? The transport records them and
 * never acts on them; the pollers read them and skip. That split is deliberate
 * — a transport that reacts to a 429 can only react by sending something, and
 * sending more is how a rate limit turns into a rate-limit storm.
 *
 * Framework-free and DOM-free on purpose: this file is shared with the backend
 * (`bun run check:shared`), and the browser-only half of the gate — page
 * visibility — lives beside the hooks that need it.
 */

/** The first refusal parks background reads for this long. */
export const MIN_RPC_COOLDOWN_MS = 15_000
/** Repeated refusals double it up to here, which is longer than any poll
 *  interval in the app, so a throttled endpoint gets real quiet rather than a
 *  slightly slower version of the same traffic. */
export const MAX_RPC_COOLDOWN_MS = 120_000
/** A clean stretch this long forgets the strikes. Without decay, one bad
 *  minute would hold the two-minute cooldown for the rest of the session. */
const FORGIVE_AFTER_MS = 60_000

type State = {
  /** Wall-clock time background reads may resume. */
  until: number
  /** Consecutive refusals, for the backoff. */
  strikes: number
  /** Last time a read came back without being refused. */
  lastAccepted: number
  /** Wallet runs in flight. A count, not a flag: the portfolio and the trade
   *  ticket can both be signing, and the last one to finish is the one that
   *  releases the gate. */
  signing: number
  /** When the last run ended, for the tail below. */
  signingEndedAt: number
}

/** A run is several transactions with short gaps between them. Holding the
 *  gate open across a gap this long keeps one trade one quiet period, rather
 *  than five transactions with a burst of polling between each pair. */
const SIGNING_TAIL_MS = 4_000

const state: State = { until: 0, strikes: 0, lastAccepted: 0, signing: 0, signingEndedAt: 0 }
const listeners = new Set<() => void>()
const announce = () => { for (const listener of [...listeners]) listener() }

/** Fires whenever the cooldown or the signing count changes, so a waiting
 *  poller can wake without sitting on a one-second timer of its own. */
export function onRpcGateChange(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Record a refusal. Returns the cooldown now in force, in milliseconds. */
export function noteRpcThrottled(now = Date.now()): number {
  if (state.lastAccepted && now - state.lastAccepted > FORGIVE_AFTER_MS) state.strikes = 0
  state.strikes += 1
  const cooldown = Math.min(MAX_RPC_COOLDOWN_MS, MIN_RPC_COOLDOWN_MS * 2 ** (state.strikes - 1))
  // Never shorten a cooldown already running: several in-flight reads refused
  // together are one episode, not an escalation that resets the clock.
  state.until = Math.max(state.until, now + cooldown)
  announce()
  return state.until - now
}

/** Record a read the endpoint accepted. */
export function noteRpcAccepted(now = Date.now()): void {
  state.lastAccepted = now
  if (state.strikes && now >= state.until) { state.strikes = 0; announce() }
}

/** Milliseconds until background reads may resume. Zero when nothing is wrong. */
export function rpcCooldownRemaining(now = Date.now()): number {
  return Math.max(0, state.until - now)
}

/**
 * Mark a wallet run as under way; call the returned function when it ends.
 *
 * A signing run is several transactions, each with its own simulation, send and
 * confirmation poll, all of it behind a two-slot concurrency gate. A book price
 * refreshed in the middle of that is a request taking a slot from the
 * transaction the trader is actually waiting on — and nobody is reading the
 * price while a wallet prompt is up.
 */
export function beginSigningRun(): () => void {
  state.signing += 1
  announce()
  let ended = false
  return () => {
    if (ended) return
    ended = true
    state.signing = Math.max(0, state.signing - 1)
    if (!state.signing) state.signingEndedAt = Date.now()
    announce()
  }
}

/** True while a run is signing, and for a short tail after it ends. */
export function signingInFlight(now = Date.now()) {
  return state.signing > 0 || now - state.signingEndedAt < SIGNING_TAIL_MS
}

/** Milliseconds until the signing tail lapses; zero when nothing is signing. */
export function signingSettlesInMs(now = Date.now()) {
  if (state.signing > 0) return SIGNING_TAIL_MS
  const remaining = SIGNING_TAIL_MS - (now - state.signingEndedAt)
  return remaining > 0 ? remaining : 0
}

/** Test seam. Nothing in the app calls this. */
export function resetRpcGate() {
  state.until = 0
  state.strikes = 0
  state.lastAccepted = 0
  state.signing = 0
  state.signingEndedAt = 0
  announce()
}
