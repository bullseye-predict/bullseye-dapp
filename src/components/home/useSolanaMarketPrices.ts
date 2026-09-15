import { binaryQuotes } from '../../../packages/adapters/solana/manifest/quotes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { ManifestCandleReader } from '../../../packages/adapters/solana/manifest/history'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { ArenaMarket, ArenaPricePoint } from '../solz/model'
import { manifestClient } from './venue/manifestClients'
import { solanaScope, useVenueRevisions } from './venue/revision'
import type { SolanaBinding, VenueQuote } from './venue/types'
import { levels } from './venue/useSolanaMarket'
import { unpricedMarkets } from './useVenueMarketPrices'

type Result = { markets: ArenaMarket[]; status: string }

/** Collateral atoms per share map onto probability directly: one share redeems
 *  for exactly one collateral unit, so a 500000-atom price at 6dp is 50%. */
const fraction = (atoms: bigint, decimals: number) => Math.min(1, Math.max(0, Number(atoms) / 10 ** decimals))

/** A crossed interval has no probability midpoint. Only a known execution
 * can provide a reference price until the crossing orders are consumed. */
export function outcomeProbability(quote: VenueQuote | undefined, decimals: number, lastTrade?: number) {
  const price = quote?.crossed ? undefined : quote?.mid ?? quote?.ask ?? quote?.bid
  if (price !== undefined) return { probability: fraction(price, decimals), indicative: false }
  if (lastTrade !== undefined) return { probability: Math.min(1, Math.max(0, lastTrade)), indicative: false }
  return { probability: .5, indicative: true }
}

/** Quote series survive a panel collapsing and remounting, so a chart does not
 *  restart from empty every time the user closes and reopens a question. */
const observed = new Map<string, ArenaPricePoint[]>()
const seriesKey = (binding: SolanaBinding, outcome: number) => `${solanaScope(binding.rpcUrl, binding.marketId)}:${outcome}`

/** Appends one observation, unless the price has not moved. The DreamDEX
 *  producer appends on every tick, which on a dormant market is thousands of
 *  identical points a day for a flat line. */
export function appendQuote(series: readonly ArenaPricePoint[], at: number, probability: number, cap = 1200): ArenaPricePoint[] {
  const previous = series.at(-1)
  if (previous && previous.probability === probability) return series as ArenaPricePoint[]
  return [...series.filter(point => point.at !== at), { at, probability }].sort((a, b) => a.at - b.at).slice(-cap)
}

const solanaBindingOf = (market: ArenaMarket) =>
  market.onchain?.family === 'SOLANA' ? market.onchain as SolanaBinding : null

/**
 * Live prices for every Solana question on the page, from the chain.
 *
 * One hook, mounted once per page — never one per market panel. Book reads are
 * batched by account, so twelve questions are two `getMultipleAccountsInfo`
 * requests rather than twenty-four sequential reads; that is the same discipline
 * the per-panel gating in useVenueMarket was added to protect.
 *
 * Executed-trade candles cost a signature page plus a serial `getTransaction`
 * each, so they are read for the focused market only. Everything else prices
 * from resting quotes.
 */
export function useSolanaMarketPrices(sourceMarkets: ArenaMarket[], venue: PublicPredictionVenue | null | undefined, enabled: boolean, focusMarketId?: string): Result {
  // Blank first, then overwrite with chain data. The arena feed hands these
  // markets simulated probabilities and history, and unpricedMarkets is what
  // stops that fabricated series rendering as live devnet prices. It preserves
  // the Solana binding on purpose, so the batch below can still find its books.
  const base = useMemo<ArenaMarket[]>(() => unpricedMarkets(sourceMarkets), [sourceMarkets])
  const bindings = useMemo<{ market: ArenaMarket; binding: SolanaBinding | null }[]>(
    () => base.map(market => ({ market, binding: solanaBindingOf(market) })),
    [base],
  )
  const scopes = useMemo(
    () => bindings.flatMap(({ binding }) => binding ? [solanaScope(binding.rpcUrl, binding.marketId)] : []),
    [bindings],
  )
  const revision = useVenueRevisions(scopes)
  // The page identity, deliberately WITHOUT the focused market. Focus only
  // decides whose candles are read; every price comes from the two batched
  // account reads. Folding focus in here made selecting a question tear down the
  // poll loop and fail the freshness check below, so all twelve questions
  // snapped back to indicative 50/50 on every click.
  const scope = `${venue?.publicRpcUrl ?? ''}:${scopes.join('|')}`
  // The poll loop re-enters its own closure every 10s, so anything captured when
  // the effect ran would stay frozen for the life of the page — and the question
  // catalogue is refetched every 10s, handing us fresh market objects that never
  // reach the loop. Read the current render's values instead.
  const latest = useRef({ base, bindings, venue, focusMarketId })
  latest.current = { base, bindings, venue, focusMarketId }
  const [result, setResult] = useState<Result & { scope: string }>({ scope: '', markets: [], status: 'NOT CONNECTED' })
  // One reader per venue keeps the decoded-transaction cache across polls; a new
  // one each tick would re-fetch the entire signature page every time.
  // `failed` separates a terminal read error from an ordinary bounded backfill;
  // the reader reports both as `partial`, but only one of them ever resolves.
  const historyCache = useRef(new Map<string, (Awaited<ReturnType<ManifestCandleReader['read']>> & { failed?: boolean })[]>())
  const candles = useRef<{ rpcUrl: string; reader: ManifestCandleReader } | null>(null)
  // Selecting a question otherwise waits out up to ten seconds of the current
  // tick before its candles are read, because focus is deliberately kept out of
  // `scope` (see above — folding it in tore the poll loop down). Re-enter the
  // running loop instead of rebuilding it.
  const kick = useRef<(() => void) | null>(null)
  useEffect(() => { kick.current?.() }, [focusMarketId])

  useEffect(() => {
    if (!enabled) return
    if (!venue?.publicRpcUrl || !latest.current.bindings.some(item => item.binding)) {
      setResult({ scope, markets: base, status: venue?.publicRpcUrl ? 'DEVNET · 0 BOUND' : 'DEVNET · NOT CONFIGURED' })
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    // A kick landing mid-pass must not start a second overlapping read; mark it
    // and let the pass in flight reschedule immediately instead.
    let running = false, requested = false
    // Constructed inside the guard: the adapter constructor throws on a
    // malformed deployment, and a throw from an effect body escapes React and
    // blanks the page rather than this one section.
    let client: ReturnType<typeof manifestClient>
    try {
      client = manifestClient(venue.publicRpcUrl, { genesisHash: venue.chainId, predictionProgram: venue.programId!, manifestProgram: venue.manifestProgramId!, collateralMint: venue.collateralToken })
    } catch (reason) {
      setResult({ scope, markets: base, status: reason instanceof Error ? reason.message.toUpperCase() : 'DEVNET · MISCONFIGURED' })
      return
    }
    const adapter = client.adapter
    // perPass here rather than in packages/: that default belongs to both
    // consumers and packages/ is mirrored into solz-prediction-backend, but this
    // number belongs to this page. The chart now draws executed trades and says
    // so, which makes backfill latency something the reader waits on — at the
    // default of 2 a cold hundred-signature book takes ~50 passes. rpc.ts still
    // caps two concurrent calls page-wide, and the candle read happens after
    // publish() below, so quotes are never delayed behind it.
    if (candles.current?.rpcUrl !== venue.publicRpcUrl) candles.current = { rpcUrl: venue.publicRpcUrl, reader: new ManifestCandleReader(adapter.connection, 6) }
    const reader = candles.current.reader

    const load = async () => {
      if (running) { requested = true; return }
      running = true
      // Re-read every render-derived value on each pass, never from the closure.
      const { base, focusMarketId } = latest.current
      const bound = latest.current.bindings.filter((item): item is { market: ArenaMarket; binding: SolanaBinding } => item.binding !== null)
      if (!bound.length) { running = false; if (active) timer = setTimeout(() => void load(), 10_000); return }
      try {
        const requests = bound.flatMap(({ binding }) => [0, 1].map(outcome => ({ question: new PublicKey(binding.marketId), outcome: outcome as 0 | 1 })))
        const decoded = await adapter.bindings(requests)
        const books = await adapter.books(decoded)
        if (!active) return
        const at = Date.now()
        let opened = 0

        // Candles only for the question actually on screen. Reading them for
        // every question on a twelve-question event would be a signature page
        // plus serial getTransaction calls per question, per tick.
        const focus = bound.findIndex(({ market }) => market.id === focusMarketId)
        let focusCandles = historyCache.current.get(`${scope}:${focusMarketId ?? ''}`) ?? []
        const cachedFor = (id: string) => historyCache.current.get(`${scope}:${id}`)
        const publish = () => {
        opened = 0
        const markets = bound.map(({ market, binding }, index) => {
          const pair = [0, 1].map(outcome => {
            const book = books[index * 2 + outcome]
            if (book) opened++
            return { asks: book ? levels(book.asks() as never[]) : [], bids: book ? levels(book.bids() as never[]) : [] }
          })
          const binary = binaryQuotes(pair[0]!.asks, pair[0]!.bids, pair[1]!.asks, pair[1]!.bids)
          const quotes = pair.some(p => p.asks.length || p.bids.length) || books[index * 2] || books[index * 2 + 1] ? [binary.yes, binary.no] : []
          // Reading is still focus-only; this only stops the chart DISCARDING what
          // it already decoded. Dropping a decoded series the moment a question
          // lost focus emptied priceHistory, which flipped the chart's series mode
          // and its headline number under the user — the same divergence two
          // browsers showed, reproducible by clicking between answers in one.
          const history = index === focus ? focusCandles : cachedFor(market.id) ?? []
          const outcomes = market.outcomes.map((outcome, side) => {
            // Outcomes beyond the binary pair have no book of their own; leave
            // them on the blank the base markets already carry.
            if (side > 1) return outcome
            const trades = (history[side]?.candles ?? []).map(candle => ({ at: candle.timestamp, probability: fraction(candle.close, binding.collateralDecimals) }))
            const { probability, indicative } = outcomeProbability(quotes[side], binding.collateralDecimals, trades.at(-1)?.probability)
            const key = seriesKey(binding, side)
            // Only while the question can still trade: a locked market must not
            // keep extending a flat line past its own cutoff.
            const series = at < binding.tradingLocksAt && !indicative ? appendQuote(observed.get(key) ?? [], at, probability) : observed.get(key) ?? []
            observed.set(key, series)
            return {
              ...outcome,
              probability,
              indicative,
              marketQuote: quotes[side] ? {
                crossed: quotes[side]?.crossed,
                bid: quotes[side]?.bid === undefined ? undefined : fraction(quotes[side]!.bid!, binding.collateralDecimals),
                ask: quotes[side]?.ask === undefined ? undefined : fraction(quotes[side]!.ask!, binding.collateralDecimals),
                mid: quotes[side]?.mid === undefined ? undefined : fraction(quotes[side]!.mid!, binding.collateralDecimals),
              } : undefined,
              quoteHistory: series,
              priceHistory: trades,
              // Three distinct states, because the chart says three different
              // things. Candles are read for the focused market only, so anything
              // else is "not read" rather than "no trades". And `read` has not
              // returned on the first publish of a pass, so a focused market with
              // no entry yet is "still loading" — calling that 'ready' let the
              // chart assert an empty book it had never actually looked at.
              historyStatus: index === focus
                ? history[side]?.failed && !trades.length ? 'unavailable' as const
                  : !history[side] || (history[side]!.partial && !trades.length) ? 'pending' as const
                    : 'ready' as const
                // A market that has lost focus is judged on what was actually
                // decoded, and is never 'pending' — no read will advance it now,
                // so "loading" would be a promise nothing keeps.
                : trades.length ? 'ready' as const : 'unavailable' as const,
            }
          })
          const executed = history.flatMap(item => item.candles).filter(candle => at - candle.timestamp <= 86_400_000)
          const lifetimeVolume = [books[index * 2], books[index * 2 + 1]].reduce((sum, book) => {
            if (!book || typeof (book as { quoteVolume?: unknown }).quoteVolume !== 'function') return sum
            try { return sum + BigInt((book as { quoteVolume(): { toString(): string } }).quoteVolume().toString()) }
            catch { return sum }
          }, 0n)
          return {
            ...market,
            status: (at >= binding.tradingLocksAt ? 'closed' : 'open') as ArenaMarket['status'],
            onchain: {
              ...market.onchain!,
              volume: { amount: lifetimeVolume.toString(), decimals: binding.collateralDecimals },
              // Marked partial while the receipt backfill is still running: the
              // reader decodes a bounded number of new transactions per pass, so
              // this is a lower bound for the first minute or so on a busy book,
              // and presenting it as a settled 24h figure understates it
              // silently. The lifetime `volume` above is exact.
              ...(executed.length ? { volume24h: { amount: executed.reduce((sum, candle) => sum + candle.collateralVolume, 0n).toString(), decimals: binding.collateralDecimals, trades: executed.length, partial: history.some(item => item?.partial) } } : {}),
            },
            outcomes,
          }
        })
        // Markets with no Solana binding pass through unpriced rather than being
        // dropped from the page.
        const byId = new Map(markets.map(market => [market.id, market]))
        if (active) setResult({ scope, markets: base.map(market => byId.get(market.id) ?? market), status: `DEVNET · ${opened} / ${bound.length * 2} BOOKS` })
        }
        // Quotes must render before slow receipt backfills complete.
        publish()
        if (focus >= 0) {
          focusCandles = await Promise.all([0, 1].map(async outcome => {
            const binding = decoded[focus * 2 + outcome]
            if (!binding) return { candles: [], partial: false }
            try { return await reader.read(binding) }
            catch { return { candles: focusCandles[outcome]?.candles ?? [], partial: true, failed: true } }
          }))
          if (!active) return
          historyCache.current.set(`${scope}:${focusMarketId ?? ''}`, focusCandles)
          publish()
        }
      } catch (reason) {
        // Keep the last good prices through a transient RPC failure; replacing
        // them with 50/50 would read as the market having moved.
        if (active) setResult(previous => ({ scope, markets: previous.scope === scope ? previous.markets : base, status: reason instanceof Error && /429|rate/i.test(reason.message) ? 'DEVNET · THROTTLED' : 'DEVNET · DATA UNAVAILABLE' }))
      } finally {
        running = false
        if (active) timer = setTimeout(() => void load(), requested ? 0 : 10_000)
        requested = false
      }
    }
    kick.current = () => { clearTimeout(timer); void load() }
    void load()
    return () => { active = false; kick.current = null; clearTimeout(timer) }
  }, [scope, enabled, revision])

  return enabled
    ? result.scope === scope ? result : { markets: base, status: 'DEVNET · LOADING' }
    : { markets: sourceMarkets, status: '' }
}
