import { useEffect, useState } from 'react'
import { readMarketActivity, type MarketActivity } from '../../../packages/adapters/dreamdex/activity'
import type { ArenaMarket } from '../solz/model'
import { useDreamDexRevision } from './dreamDexRefresh'

export function useDreamDexActivity(market: ArenaMarket, enabled: boolean) {
  const binding = market.onchain
  const key = `${binding?.chainId}:${binding?.marketId}:${binding?.indexerUrl}`
  const revision = useDreamDexRevision(binding?.chainId ?? '')
  const [state, setState] = useState<{ key: string; rows: MarketActivity[]; error: string; loading: boolean }>({ key: '', rows: [], error: '', loading: true })
  useEffect(() => {
    if (!enabled || !binding) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function load() {
      try {
        const rows = await readMarketActivity(binding!.indexerUrl, binding!.marketId, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
        if (!controller.signal.aborted) setState({ key, rows, error: '', loading: false })
      } catch (error) {
        if (!controller.signal.aborted) setState(previous => ({ key, rows: previous.key === key ? previous.rows : [], error: error instanceof Error ? error.message : 'Activity unavailable.', loading: false }))
      } finally { if (!controller.signal.aborted) timer = setTimeout(load, 5000) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [key, enabled, revision])
  return state.key === key ? state : { rows: [], error: '', loading: true }
}
