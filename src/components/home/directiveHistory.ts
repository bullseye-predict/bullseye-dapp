import { readDirectivePurchases, type DirectiveReceipt } from '../solz/directiveRelay'

/**
 * WHAT THE VIEWER ACTUALLY SENT.
 *
 * A paid directive never reached the AGENT INSTRUCTIONS rail. The rail reads
 * `snapshot.prompts`, which only the sample data source writes; the live path
 * pays the relay in
 * /Users/Shared/march-2026/_solz-elysia/src/api/viewer-actions.ts and returned
 * nothing to the page but a sentence under the field. So a viewer who paid,
 * approved and watched the agent obey saw an empty rail underneath.
 *
 * This is the missing half. The composer records a directive here the moment
 * the relay confirms the payment, so it appears at once, and the relay's own
 * `purchases` route is re-read while the row is still moving, so `paid` becomes
 * `executed` without a reload.
 *
 * It is a module store and not React state for the same reason
 * src/components/home/liveChatRoom.ts is one: the composer that writes lives in
 * the stage's bottom-right plate and the rail that reads lives below the stage,
 * and on the event page neither is mounted where the other is.
 */

export type DirectiveEntry = DirectiveReceipt

/** Still moving, so the relay is worth asking again. */
const SETTLED = new Set<DirectiveEntry['state']>(['executed', 'failed', 'paid_expired'])

const POLL_MS = 6_000
/** A directive that never leaves `paid` is the relay's problem, not this page's.
 *  Polling stops rather than asking forever. */
const POLL_WINDOW_MS = 5 * 60_000

let entries: DirectiveEntry[] = []
let wallet = ''
let matchId = ''
let timer: ReturnType<typeof setTimeout> | null = null
let pollingUntil = 0
let reading = false
const listeners = new Set<(value: DirectiveEntry[]) => void>()

function publish(next: DirectiveEntry[]) {
  entries = next
  for (const listener of listeners) listener(entries)
}

/** Newest first, de-duplicated by purchase id. A refresh replaces what it
 *  knows better - the relay owns the state - and keeps a row it has not seen
 *  yet, which is the one just recorded locally. */
export function mergeDirectives(previous: DirectiveEntry[], incoming: DirectiveEntry[]): DirectiveEntry[] {
  const byId = new Map(previous.map((entry) => [entry.id, entry]))
  for (const entry of incoming) {
    const known = byId.get(entry.id)
    byId.set(entry.id, known ? { ...known, ...entry, text: entry.text || known.text } : entry)
  }
  return [...byId.values()].sort((left, right) => right.at - left.at).slice(0, 40)
}

function unsettled(list: DirectiveEntry[]) {
  return list.some((entry) => !SETTLED.has(entry.state))
}

function stop() {
  if (timer) { clearTimeout(timer); timer = null }
}

function schedule() {
  if (timer || !listeners.size) return
  if (!unsettled(entries) || Date.now() >= pollingUntil) return
  timer = setTimeout(() => { timer = null; void refresh() }, POLL_MS)
}

/** Ask the relay for this wallet's directives in this match. Silent on failure:
 *  a refresh that cannot reach the relay must not erase rows the viewer paid
 *  for and can see. */
export async function refresh() {
  if (reading || !wallet || !matchId) return
  reading = true
  try {
    publish(mergeDirectives(entries, await readDirectivePurchases(matchId, wallet)))
  } catch {
    // Keep what is on screen.
  } finally {
    reading = false
    schedule()
  }
}

/**
 * A directive the relay just confirmed. `text` is this page's copy of it: the
 * confirm response carries the purchase, not the words that were bought.
 */
export function recordDirective(input: {
  purchase: DirectiveReceipt | (Omit<DirectiveReceipt, 'at' | 'text'> & { at?: number; text?: string })
  text: string
  wallet: string
  botId?: string
}) {
  const entry: DirectiveEntry = {
    ...input.purchase,
    at: input.purchase.at || Date.now(),
    text: input.text,
    ...(input.botId ? { botId: input.botId } : {}),
  }
  wallet = input.wallet
  // The relay names the match, never this client - see sendDirective.ts. So the
  // purchase it answers with is the only thing that can address the read back.
  if (entry.matchId) matchId = entry.matchId
  pollingUntil = Date.now() + POLL_WINDOW_MS
  publish(mergeDirectives(entries, [entry]))
  stop()
  schedule()
}

/**
 * Watch the list. The first subscriber starts the refresh loop when there is
 * something unsettled to refresh; the last one to leave stops it.
 */
export function subscribeDirectives(listener: (value: DirectiveEntry[]) => void) {
  listeners.add(listener)
  listener(entries)
  schedule()
  return () => {
    listeners.delete(listener)
    if (!listeners.size) stop()
  }
}

/** Tests only. The store outlives a component on purpose. */
export function resetDirectiveHistory() {
  stop()
  entries = []
  wallet = ''
  matchId = ''
  pollingUntil = 0
  listeners.clear()
}
