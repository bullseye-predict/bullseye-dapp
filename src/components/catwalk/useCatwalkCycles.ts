import { useCallback, useEffect, useMemo, useState } from 'react'
import { catwalkSource, type CatwalkCycle, type CatwalkCycleHeader } from '../solz/catwalkSource'

/**
 * THE WALKS THIS BOARD HAS ALREADY TAKEN.
 *
 * /catwalk had no memory. The server has snapshotted the whole board at every
 * lock since the feature shipped - `catwalk_match_cycles` carries an ordered
 * lineup per cycle - and nothing on this page could read one, so a coin that
 * walked in cycle 3 and was walked down in cycle 4 left no trace either way and
 * "who was on the board last week" had no answer at all.
 *
 * TWO READS, NOT ONE. The INDEX is what the picker needs to draw itself, and it
 * is headers only; a selected cycle's board is fetched on demand. Shipping
 * thirty-six coins per recorded walk just to fill a dropdown would make the page
 * slower the longer the season ran.
 *
 * THE SAME UNREAD / UNREADABLE / ANSWERED DISCIPLINE the rest of this page
 * keeps. A picker that has not loaded and a board with no recorded walks are
 * different facts: the first must say nothing, and only the second may say that
 * nothing has been recorded.
 */
export type CycleIndexState = 'unread' | 'unreadable' | 'read'

export type CatwalkCyclesFeed = {
  /** The recorded walks, newest first. Empty until `state` is 'read'. */
  cycles: CatwalkCycleHeader[]
  state: CycleIndexState
  /** Which recorded walk is being shown, or null for the LIVE board. */
  selected: number | null
  /** The selected walk's board. Null while it loads, or when showing live. */
  cycle: CatwalkCycle | null
  /** True only while a selected cycle's board is in flight. A picker must not
   *  render the previous walk's rows under the new walk's number. */
  loading: boolean
  /** Why the selected walk could not be read, when it could not be. */
  error: string | null
  select: (cycleIndex: number | null) => void
}

export function useCatwalkCycles(endpoint: string): CatwalkCyclesFeed {
  const source = useMemo(() => catwalkSource(endpoint), [endpoint])
  const [cycles, setCycles] = useState<CatwalkCycleHeader[]>([])
  const [state, setState] = useState<CycleIndexState>('unread')
  const [selected, setSelected] = useState<number | null>(null)
  const [cycle, setCycle] = useState<CatwalkCycle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // THE INDEX IS READ ONCE. A recorded walk never changes after its lock, and a
  // new one only appears when the board locks again - which is hours apart, not
  // seconds. Polling it would be a request per viewer per interval for a list
  // that is almost always byte-identical to the one already in hand.
  useEffect(() => {
    const abort = new AbortController()
    source.cycles(abort.signal)
      .then((rows) => { setCycles(rows); setState('read') })
      .catch((cause) => {
        if (abort.signal.aborted) return
        // An index that could not be read is NOT a board with no history. The
        // picker says so rather than presenting itself as empty.
        setState('unreadable')
      })
    return () => abort.abort()
  }, [source])

  useEffect(() => {
    if (selected === null) { setCycle(null); setError(null); setLoading(false); return }
    const abort = new AbortController()
    setLoading(true)
    setError(null)
    // The previous walk's board is dropped BEFORE the new one is asked for.
    // Keeping it would render cycle 4's coins under the heading for cycle 7 for
    // as long as the read took, which is the one thing a history view cannot do.
    setCycle(null)
    source.cycle(selected, abort.signal)
      .then((read) => { if (!abort.signal.aborted) { setCycle(read); setLoading(false) } })
      .catch((cause: Error & { status?: number }) => {
        if (abort.signal.aborted) return
        setLoading(false)
        setError(cause?.status === 404
          ? 'That walk is not recorded on this board.'
          : 'That walk could not be read just now.')
      })
    return () => abort.abort()
  }, [source, selected])

  const select = useCallback((next: number | null) => setSelected(next), [])

  return { cycles, state, selected, cycle, loading, error, select }
}
