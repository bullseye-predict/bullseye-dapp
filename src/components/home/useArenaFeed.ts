import { useEffect, useMemo, useState } from 'react'
import { createArenaFeed, type ArenaFeed } from './arenaFeed'

export function useArenaFeed(endpoint: string, predictionApiUrl = '') {
  const read = useMemo(() => createArenaFeed(endpoint, fetch, predictionApiUrl), [endpoint, predictionApiUrl])
  const [data, setData] = useState<ArenaFeed | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    setData(null)
    async function refresh() {
      try {
        const next = await read(AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]))
        if (!controller.signal.aborted) { setData(next); setError('') }
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Arena refresh failed.')
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(refresh, 15000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [read, revision])
  return { data, error, retry: () => setRevision(v => v + 1) }
}
