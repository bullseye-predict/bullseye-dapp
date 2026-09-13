import { accountCashFlow, type CashFlow } from './cashFlow'
import { canonicalMatchId, type MatchMetadata } from './matchIdentity'
import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding, parseDreamDexPublicConfig } from '../../../packages/adapters/dreamdex/config'
import type { DreamDexPublicConfig } from '../../../packages/prediction-core/market-data'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import { useDreamDexRevision } from '../home/venue/revision'

export type PortfolioMarket = {
  config: DreamDexPublicConfig
  binding: DreamDexPublicConfig['markets'][number]
  snapshot: Awaited<ReturnType<DreamDexBrowser['snapshot']>>
  historicalOutcomes?: (0 | 1)[]
  cashFlows?: CashFlow[]
  metadata?: MatchMetadata
  participated: boolean
  historyLimited: boolean
  historyError: boolean
}

async function readHolding(config: DreamDexPublicConfig, binding: PortfolioMarket['binding'], owner: Address, signal: AbortSignal): Promise<PortfolioMarket> {
  const adapter = new DreamDexBrowser(config, eventBinding(config, binding))
  try {
    const snapshot = await adapter.snapshot(owner)
    const cashFlows: CashFlow[] = []
    const outcomes = new Set<0 | 1>()
    let participated = false, historyLimited = false, historyError = false
    // The SDK joins maker and taker ownership and includes direct mints/redemptions.
    // Its inclusive timestamp cursor cannot exhaust a second containing a full page.
    try {
      const seen = new Set<string>()
      let until: number | undefined
      for (let page = 0; page < 20 && !signal.aborted; page++) {
        const rows = await adapter.client.getMarketActivity(binding.marketId, { limit: 100, until, kinds: ['TRADE', 'MINT_SET', 'MERGE_SET', 'REDEEM'] })
        let added = 0
        for (const row of rows) {
          if (seen.has(row.id)) continue
          seen.add(row.id); added++
          if (row.market.toLowerCase() !== binding.marketId.toLowerCase()) continue
          if (row.kind === 'TRADE') {
            try {
              const flow = accountCashFlow(row, owner, snapshot.market.decimals)
              if (flow) cashFlows.push({ ...flow, id: `${binding.marketId}:${flow.id}` })
            } catch { historyError = true }
          }
          if (row.kind === 'TRADE') {
            for (const [account, side] of [[row.maker, row.makerSide], [row.taker, row.takerSide]] as const) {
              if (account?.toLowerCase() !== owner.toLowerCase()) continue
              participated = true
              if (side) outcomes.add(side.endsWith('YES') ? 0 : 1)
            }
          } else if ('account' in row && row.account.toLowerCase() === owner.toLowerCase()) {
            participated = true
            if (row.kind === 'MINT_SET' || row.kind === 'MERGE_SET') { outcomes.add(0); outcomes.add(1) }
          }
        }
        if (rows.length < 100) break
        if (!added || page === 19) { historyLimited = true; break }
        until = Number(rows.at(-1)!.timestamp)
      }
    } catch { historyError = true }
    return { config, binding, snapshot, participated, cashFlows, historicalOutcomes: [...outcomes], historyLimited, historyError }
  } finally { await adapter.close() }
}

export function usePortfolio(apiUrl: string, chainId: '50312' | '5031', owner: string | undefined, retry: number, matchApiUrl = '') {
  const revision = useDreamDexRevision(chainId)
  const key = `${matchApiUrl}:${apiUrl}:${chainId}:${owner?.toLowerCase()}`
  const [result, setResult] = useState<{ key: string; markets: PortfolioMarket[]; loading: boolean; error: string; failures: number }>({ key: '', markets: [], loading: true, error: '', failures: 0 })
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    if (!owner || !apiUrl) return
    async function load() {
      try {
        const raw = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]))
        const config = raw.dreamdex?.map(parseDreamDexPublicConfig).find(c => c.chainId === chainId)
        if (!config) throw Error('This network has no configured prediction markets.')
        const metadata = new Map<string, MatchMetadata>()
        if (matchApiUrl) {
          try {
            let cursor: string | null = null
            const cursors = new Set<string>()
            for (let page = 0; page < 20; page++) {
              const url = new URL(matchApiUrl, window.location.origin)
              url.searchParams.set('kind', 'matches'); url.searchParams.set('limit', '100')
              if (cursor) url.searchParams.set('cursor', cursor)
              const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]) })
              if (!response.ok) break
              const value = await response.json()
              if (!Array.isArray(value.matches)) break
              for (const match of value.matches) if (typeof match.matchId === 'string') metadata.set(canonicalMatchId(match.matchId), match)
              cursor = value.nextCursor
              if (!cursor || cursors.has(cursor)) break
              cursors.add(cursor)
            }
          } catch { /* On-chain state and deterministic labels remain available. */ }
        }
        const markets: PortfolioMarket[] = []
        let failures = 0
        // Bound RPC concurrency while retaining every configured past event.
        for (let offset = 0; offset < config.markets.length && !controller.signal.aborted; offset += 4) {
          const batch = await Promise.allSettled(config.markets.slice(offset, offset + 4).map(binding => readHolding(config, binding, owner as Address, controller.signal)))
          for (const item of batch) item.status === 'fulfilled' ? markets.push({ ...item.value, metadata: metadata.get(canonicalMatchId(item.value.binding.eventId)) }) : failures++
        }
        if (!controller.signal.aborted) setResult({ key, markets, loading: false, error: '', failures })
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, markets: [], loading: false, error: error instanceof Error ? error.message : 'Portfolio unavailable.', failures: 0 })
      } finally { if (!controller.signal.aborted) timer = setTimeout(load, 30000) }
    }
    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [key, revision, retry])
  if (!apiUrl) return { markets: [], loading: false, error: 'Prediction API is not configured.', failures: 0 }
  return result.key === key ? result : { markets: [], loading: !!owner, error: '', failures: 0 }
}
