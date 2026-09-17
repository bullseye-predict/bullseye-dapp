import { useEffect, useRef } from 'react'
import { predictionUrl } from '../../../packages/sdk/prediction-url'
import type { SolanaPositionRow } from './solanaRows'

/**
 * Why a viewer settles a market.
 *
 * A question market only exists once a trader opens one, and most matches are
 * never opened on a given cluster, so a settler that polls on a timer spends
 * nearly all of its reads confirming there is nothing to do. The person looking
 * at a stuck position is the cheapest possible signal that there IS something:
 * they are here, the row in front of them says the match is over and the result
 * has not landed, and they want to claim.
 *
 * This is a nudge, never a dependency. The standalone settler still settles
 * every market on its own; the request only asks it to look now instead of on
 * its next tick. Nothing on this page waits for the answer.
 */
const NUDGE_INTERVAL_MS = 60_000

/** One attempt per minute per tab, per deployment. The API coalesces concurrent
 *  callers and rate-limits on its own, so this only keeps a page with several
 *  stuck rows from asking several times over. */
const lastNudge = new Map<string, number>()

/** A position whose match is over and whose result never arrived on chain.
 *  `Awaiting result` is exactly that state: not tradeable, not claimable. An
 *  exited row is somebody else's problem, so shares held is part of it. */
export const isAwaitingSettlement = (row: SolanaPositionRow) => row.state === 'Awaiting result' && row.quantity > 0n

/** Whether this viewer should ask now. Pure, so the decision is testable
 *  without a DOM: the effect below only supplies the clock and the map. */
export function nudgeDue(stuck: number, lastAt: number | undefined, now: number) {
  if (stuck === 0) return false
  return now - (lastAt ?? -Infinity) >= NUDGE_INTERVAL_MS
}

/**
 * Whether a response means the chain may have changed.
 *
 * Only a pass that finished can have written anything. NOT_CONFIGURED,
 * THROTTLED, RUNNING and LOCK_HELD all left the chain as it was, so refreshing
 * on them would spend a portfolio read to redraw the same rows.
 */
export const nudgeChangedChain = (body: { configured?: boolean; status?: string }) =>
  body.configured === true && body.status === 'COMPLETED'

export function useSettlementNudge(rows: readonly SolanaPositionRow[], apiUrl: string | undefined, onSettled: () => void) {
  // Read inside the effect so a new row list does not re-run it, and so the
  // refresh callback never has to be a stable reference.
  const refresh = useRef(onSettled)
  refresh.current = onSettled
  const stuck = rows.filter(isAwaitingSettlement).length
  useEffect(() => {
    if (!apiUrl) return
    const now = Date.now()
    if (!nudgeDue(stuck, lastNudge.get(apiUrl), now)) return
    lastNudge.set(apiUrl, now)
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(predictionUrl('/solana/settle', apiUrl), {
          method: 'POST', signal: controller.signal, headers: { accept: 'application/json' },
        })
        if (!response.ok) return
        if (nudgeChangedChain(await response.json())) refresh.current()
      } catch {
        // A nudge that fails is not an error the viewer needs: the settler's
        // own loop is what guarantees settlement, and this page already shows
        // the position honestly as awaiting its result.
      }
    })()
    return () => controller.abort()
  }, [apiUrl, stuck])
}
