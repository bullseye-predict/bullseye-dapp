import { useEffect, useMemo, useState } from 'react'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding, parseDreamDexPublicConfig } from '../../../packages/adapters/dreamdex/config'
import { createDreamDexEventReader } from '../../../packages/adapters/dreamdex/event-reader'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import type { ArenaMarket } from '../solz/model'
import type { SomniaChain } from './MarketSourceControls'

type Result = { markets: ArenaMarket[]; status: string }

export function unpricedMarkets(markets: ArenaMarket[]) {
  return markets.map((market) => ({
    ...market,
    volume: { SOL: 0, COOLA: 0 },
    outcomes: market.outcomes.map((outcome) => ({ ...outcome, probability: .5, priceHistory: [] })),
  }))
}

function bindingFor(market: ArenaMarket, bindings: ReturnType<typeof parseDreamDexPublicConfig>['markets']) {
  const yes = market.outcomes.find((outcome) => outcome.id === 'yes') ?? market.outcomes[0]
  return bindings.find((binding) => binding.eventId === market.matchId && (
    binding.questionId === market.id ||
    (binding.subjectId && binding.subjectId === yes?.participantId) ||
    binding.label.trim().toLowerCase() === market.title.trim().toLowerCase()
  ))
}

export function useSomniaMarketPrices(apiUrl: string, chainId: SomniaChain, sourceMarkets: ArenaMarket[], enabled: boolean, refreshKey = 0): Result {
  const [result, setResult] = useState<Result>({ markets: sourceMarkets, status: 'NOT CONNECTED' })
  const marketKey = useMemo(() => sourceMarkets.map((market) => `${market.id}:${market.matchId}:${market.title}`).join('|'), [sourceMarkets])

  useEffect(() => {
    if (!enabled) return
    const emptyMarkets = unpricedMarkets(sourceMarkets)
    if (!apiUrl) {
      setResult({ markets: emptyMarkets, status: 'API NOT CONNECTED' })
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const label = chainId === '50312' ? 'TESTNET' : 'MAINNET'

    const load = async () => {
      try {
        // Keep confirmed bindings visible while refreshing. Replacing them with
        // an unbound placeholder every 30 seconds made an open event look closed.
        setResult((previous) => ({ markets: previous.markets.length ? previous.markets : emptyMarkets, status: `${label} · CONNECTING` }))
        const raw = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        const deployment = raw.dreamdex?.map(parseDreamDexPublicConfig).find((item) => item.chainId === chainId)
        if (!deployment) {
          setResult({ markets: emptyMarkets, status: `${label} · NOT CONFIGURED` })
          return
        }
        const linked = emptyMarkets.map((market) => ({ market, binding: bindingFor(market, deployment.markets) }))
        const bound = linked.filter((item) => item.binding).length
        if (!bound) {
          setResult({ markets: emptyMarkets, status: `${label} · 0 / ${sourceMarkets.length} BOUND` })
          return
        }

        const resources = createDreamDexEventReader(deployment)
        try {
          const markets = await Promise.all(linked.map(async ({ market, binding }) => {
            if (!binding) return market
            const boundMarket: ArenaMarket = { ...market, closesAt: binding.tradingLocksAt, status: Date.now() >= binding.tradingLocksAt ? 'closed' : 'open', rules: 'YES pays if this agent is the recorded final winner; NO pays otherwise. DreamDEX OracleHub resolves from this room’s public final winner log. Uniform void payouts apply if no valid answer is finalized.', description: 'Real DreamDEX game event. Creation and wallet trading are separate transactions.', onchain: { chainId: deployment.chainId, marketId: binding.marketId, oracleQuestionId: binding.oracleQuestionId, tradingStartsAt: binding.tradingStartsAt, tradingLocksAt: binding.tradingLocksAt, voidPolicy: binding.voidPolicy, indexerUrl: deployment.indexerUrl, wsRpcUrl: deployment.wsRpcUrl, creationTxHash: binding.creationTxHash, sponsoredTransactions: binding.sponsoredTransactions } }
            try {
              const candles = await new DreamDexBrowser(deployment, eventBinding(deployment, binding), resources).candles(0)
              if (!candles.length) return boundMarket
              const history = candles.map((candle) => ({ at: candle.timestamp, probability: Number(candle.close) / 1_000_000 }))
              const probability = history.at(-1)?.probability ?? .5
              return {
                ...boundMarket,
                outcomes: market.outcomes.map((outcome, index) => ({
                  ...outcome,
                  probability: index === 0 ? probability : 1 - probability,
                  priceHistory: history.map((point) => ({ ...point, probability: index === 0 ? point.probability : 1 - point.probability })),
                })),
              }
            } catch {
              return boundMarket
            }
          }))
          if (!controller.signal.aborted) setResult({ markets, status: `${label} · ${bound} / ${sourceMarkets.length} BOUND` })
        } finally {
          await resources.close()
        }
      } catch {
        if (!controller.signal.aborted) setResult((previous) => ({ markets: previous.markets.length ? previous.markets : emptyMarkets, status: `${label} · DATA UNAVAILABLE` }))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 30_000)
      }
    }

    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [apiUrl, chainId, enabled, marketKey, refreshKey])

  return enabled ? result : { markets: sourceMarkets, status: '' }
}
