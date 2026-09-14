import { useEffect, useMemo, useRef, useState } from 'react'
import { DreamDexBrowser } from '../../../packages/adapters/dreamdex/browser'
import { eventBinding, parseDreamDexPublicConfig } from '../../../packages/adapters/dreamdex/config'
import { createDreamDexEventReader } from '../../../packages/adapters/dreamdex/event-reader'
import { getPredictionConfig } from '../../../packages/sdk/PredictionTradingClient'
import type { ArenaMarket } from '../solz/model'
import { useDreamDexRevision } from './venue/revision'
import type { SomniaChain } from './MarketSourceControls'

type Result = { markets: ArenaMarket[]; status: string }

/** Clears venue *pricing* so a market renders without quotes. It must not
 *  destroy the venue *binding*: this is the path the Solana source renders
 *  through, and dropping the binding made every activated Solana question report
 *  "no market opened" with an empty book however many trades had settled.
 *  A DreamDEX binding is still cleared, because its pricing is what is absent. */
export function unpricedMarkets(markets: ArenaMarket[]) {
  return markets.map((market) => ({
    ...market,
    onchain: market.onchain?.family === 'SOLANA' ? market.onchain : undefined,
    volume: { SOL: 0, COOLA: 0 },
    outcomes: market.outcomes.map((outcome) => ({ ...outcome, probability: .5, marketQuote: undefined, indicative: true, priceHistory: [], quoteHistory: [], historyStatus: undefined })),
  }))
}

export function bindingFor(market: ArenaMarket, bindings: ReturnType<typeof parseDreamDexPublicConfig>['markets']) {
  const yes = market.outcomes.find((outcome) => outcome.id === 'yes') ?? market.outcomes[0]
  return bindings.find((binding) => binding.eventId === market.matchId && (
    binding.questionId ? binding.questionId === market.id :
    binding.subjectId ? binding.subjectId === yes?.participantId :
    binding.label.trim().toLowerCase() === market.title.trim().toLowerCase()
  ))
}

export function useSomniaMarketPrices(apiUrl: string, chainId: SomniaChain, sourceMarkets: ArenaMarket[], enabled: boolean, refreshKey = 0): Result {
  const observations = useRef<{ scope: string; markets: Map<string, { at: number; probability: number }[]> }>({ scope: '', markets: new Map() })
  const revision = useDreamDexRevision(chainId)
  const scope = `${apiUrl}:${chainId}:${sourceMarkets.map(market => `${market.matchId}:${market.id}`).join('|')}`
  const [result, setResult] = useState<Result & { scope: string }>({ scope: '', markets: [], status: 'NOT CONNECTED' })
  const marketKey = useMemo(() => sourceMarkets.map((market) => `${market.id}:${market.matchId}:${market.title}`).join('|'), [sourceMarkets])

  useEffect(() => {
    if (!enabled) return
    if (observations.current.scope !== scope) observations.current = { scope, markets: new Map() }
    const observed = observations.current.markets
    const emptyMarkets = unpricedMarkets(sourceMarkets)
    if (!apiUrl) {
      setResult({ scope, markets: emptyMarkets, status: 'API NOT CONNECTED' })
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const label = chainId === '50312' ? 'TESTNET' : 'MAINNET'

    const load = async () => {
      try {
        // Keep confirmed bindings visible while refreshing. Replacing them with
        // an unbound placeholder makes an open event look closed.
        setResult((previous) => ({ scope, markets: previous.scope === scope ? previous.markets : emptyMarkets, status: `${label} · CONNECTING` }))
        const raw = await getPredictionConfig(apiUrl, AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]))
        if (controller.signal.aborted) return
        const deployment = raw.dreamdex?.map(parseDreamDexPublicConfig).find((item) => item.chainId === chainId)
        if (!deployment) {
          setResult({ scope, markets: emptyMarkets, status: `${label} · NOT CONFIGURED` })
          return
        }
        const linked = emptyMarkets.map((market) => ({ market, binding: bindingFor(market, deployment.markets) }))
        const bound = linked.filter((item) => item.binding).length
        if (!bound) {
          setResult({ scope, markets: emptyMarkets, status: `${label} · 0 / ${sourceMarkets.length} BOUND` })
          return
        }

        const resources = createDreamDexEventReader(deployment)
        try {
          const markets = await Promise.all(linked.map(async ({ market, binding }) => {
            if (!binding) return market
            const boundMarket: ArenaMarket = { ...market, closesAt: binding.tradingLocksAt, status: Date.now() >= binding.tradingLocksAt ? 'closed' : 'open', rules: 'YES pays if this agent is the recorded final winner; NO pays otherwise. DreamDEX OracleHub resolves from this room’s public final winner log. Uniform void payouts apply if no valid answer is finalized.', description: 'Real DreamDEX game event. Creation and wallet trading are separate transactions.', onchain: { chainId: deployment.chainId, marketId: binding.marketId, oracleQuestionId: binding.oracleQuestionId, tradingStartsAt: binding.tradingStartsAt, tradingLocksAt: binding.tradingLocksAt, voidPolicy: binding.voidPolicy, indexerUrl: deployment.indexerUrl, wsRpcUrl: deployment.wsRpcUrl, creationTxHash: binding.creationTxHash, sponsoredTransactions: binding.sponsoredTransactions } }
            try {
              const browser = new DreamDexBrowser(deployment, eventBinding(deployment, binding), resources)
              const [candles, onchain, volume] = await Promise.all([
                browser.candles(0).catch(() => null),
                browser.snapshot(),
                resources.reader.volume(eventBinding(deployment, binding)).catch(() => null),
              ])
              const history = (candles ?? []).map((candle) => ({ at: candle.timestamp, probability: Number(candle.close) / 1_000_000 }))
              const ask = onchain.book?.yesAsks[0]?.price, bid = onchain.book?.yesBids[0]?.price
              const quote = ask !== undefined && bid !== undefined ? (ask + bid) / 2n : ask ?? bid
              const quotePrice = quote === undefined ? undefined : Number(quote) / Number(10n ** BigInt(onchain.market.decimals))
              let quoteHistory = observed.get(market.id) ?? []
              if (quotePrice !== undefined && onchain.now < binding.tradingLocksAt && !controller.signal.aborted) {
                quoteHistory = [...quoteHistory.filter(point => point.at !== onchain.now), { at: onchain.now, probability: quotePrice }].sort((a, b) => a.at - b.at).slice(-1200)
                observed.set(market.id, quoteHistory)
              }
              const probability = history.at(-1)?.probability ?? quotePrice ?? .5
              const indicative = history.length === 0 && quotePrice === undefined
              return {
                ...boundMarket,
                onchain: {
                  ...boundMarket.onchain!,
                  ...(volume ? { volume24h: { amount: volume.volume24h.toString(), decimals: volume.collateralDecimals, trades: volume.trades24h } } : {}),
                },
                outcomes: market.outcomes.map((outcome, index) => ({
                  ...outcome,
                  probability: index === 0 ? probability : 1 - probability,
                  indicative,
                  historyStatus: candles === null ? 'unavailable' as const : 'ready' as const,
                  quoteHistory: quoteHistory.map(point => ({ ...point, probability: index === 0 ? point.probability : 1 - point.probability })),
                  priceHistory: history.map((point) => ({ ...point, probability: index === 0 ? point.probability : 1 - point.probability })),
                })),
              }
            } catch {
              return { ...boundMarket, outcomes: boundMarket.outcomes.map(outcome => ({ ...outcome, historyStatus: 'unavailable' as const })) }
            }
          }))
          if (!controller.signal.aborted) setResult({ scope, markets, status: `${label} · ${bound} / ${sourceMarkets.length} BOUND` })
        } finally {
          await resources.close()
        }
      } catch {
        if (!controller.signal.aborted) setResult((previous) => ({ scope, markets: previous.scope === scope ? previous.markets : emptyMarkets, status: `${label} · DATA UNAVAILABLE` }))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 3_000)
      }
    }

    void load()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [apiUrl, chainId, enabled, marketKey, refreshKey, revision])

  return enabled ? result.scope === scope ? result : { markets: unpricedMarkets(sourceMarkets), status: 'LOADING CURRENT MATCH' } : { markets: sourceMarkets, status: '' }
}
