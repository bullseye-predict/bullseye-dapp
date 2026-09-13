import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding } from '../../../packages/adapters/dreamdex/config'
import type { DreamDexPublicConfig } from '../../../packages/prediction-core/market-data'
import type { ArenaMarket } from '../solz/model'
import { useDreamDexRevision } from './venue/revision'

/**
 * A Solana market also carries `onchain`, so a truthy check is not enough to
 * decide this hook may read it: a Solana binding has no `oracleQuestionId`, and
 * BigInt(undefined) threw synchronously out of the effect body and blanked the
 * app. Callers that pass a raw market (TradeTicket) are protected here rather
 * than at each call site. Legacy records predate `family` and are DreamDEX.
 */
export function dreamDexOnly(market: ArenaMarket) {
  const binding = market.onchain
  if (!binding || binding.family === 'SOLANA') return undefined
  return binding.oracleQuestionId && binding.indexerUrl ? binding : undefined
}

export function createMarketBrowser(market: ArenaMarket) {
  const binding = dreamDexOnly(market)
  if (!binding) throw new Error('This market is not a DreamDEX market.')
  const config: DreamDexPublicConfig = {
    chainId: binding.chainId, label: market.title, indexerUrl: binding.indexerUrl, wsRpcUrl: binding.wsRpcUrl,
    markets: [{ eventId: market.matchId ?? '', label: market.title, marketId: binding.marketId, oracleQuestionId: binding.oracleQuestionId, tradingStartsAt: binding.tradingStartsAt, tradingLocksAt: binding.tradingLocksAt, voidPolicy: binding.voidPolicy }],
  }
  return new DreamDexBrowser(config, eventBinding(config, config.markets[0]))
}
type Snapshot = Awaited<ReturnType<DreamDexBrowser['snapshot']>>

/** Scope reads to the exact chain, question, and account; never expose the last match's data. */
export function useDreamDexSnapshot(market: ArenaMarket, owner?: string) {
  const binding = dreamDexOnly(market)
  const key = JSON.stringify([binding, market.matchId, owner?.toLowerCase()])
  const revision = useDreamDexRevision(binding?.chainId ?? '')
  const [refreshing, setRefreshing] = useState(false)
  const [result, setResult] = useState<{ key: string; data: Snapshot | null; error: string | null }>({ key: '', data: null, error: null })
  useEffect(() => {
    if (!binding) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    // Constructed inside the guard: a throw here is adapter misconfiguration,
    // and from an effect body it escapes React and unmounts the whole tree.
    let adapter: DreamDexBrowser
    try {
      adapter = createMarketBrowser(market)
    } catch (reason) {
      setResult({ key, data: null, error: reason instanceof Error ? reason.message : 'Market data unavailable. Retry shortly.' })
      return
    }
    async function load() {
      setRefreshing(true)
      try {
        const data = await adapter.snapshot(owner as Address | undefined)
        if (active) setResult({ key, data, error: null })
      } catch (reason) {
        if (active) setResult({ key, data: null, error: reason instanceof Error ? reason.message : 'Market data unavailable. Retry shortly.' })
      } finally {
        if (active) { setRefreshing(false); timer = setTimeout(load, 10_000) }
      }
    }
    void load()
    return () => { active = false; clearTimeout(timer); void adapter.close() }
  }, [key, revision])
  return result.key === key ? { ...result, refreshing } : { key, data: null, error: null, refreshing: !!binding }
}
