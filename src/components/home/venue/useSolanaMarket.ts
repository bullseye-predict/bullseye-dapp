import { binaryQuotes } from '../../../../packages/adapters/solana/manifest/quotes'
import { useEffect, useMemo, useState } from 'react'
import type { createManifestHybridClient } from '../../../../packages/adapters/solana/manifest/hybrid'
import { manifestClient } from './manifestClients'
import type { DepthLevel } from '../LiveOrderBook'
import type { SolanaBinding, VenueBook, VenueMarketView, VenueQuote } from './types'
import { bumpVenue, solanaScope, useVenueRevision } from './revision'

// Orders are submitted with priceMantissa = priceMicros and priceExponent = -6,
// so the resting price reads back as a 1e18 fixed point of quote atoms per base
// atom. Both mints are 6dp, so dividing by 1e12 returns the same integer the
// ticket sent and the same scale the book renders at.
const PRICE_SCALE = 10n ** 12n
const atoms = (value: { toString(): string }) => BigInt(value.toString())

/** One row per price, not one row per resting order. DepthLevel is the
 *  aggregated-level contract every consumer assumes, and LiveOrderBook keys its
 *  rows by price — a 1:1 map made twelve orders resting at 50¢ render as twelve
 *  identical rows sharing one React key. Keyed on the *post-scale* price so two
 *  raw 1e18 prices that truncate to the same displayed price merge rather than
 *  colliding. */
export const levels = (orders: { price: unknown; numBaseAtoms: unknown }[]): DepthLevel[] => {
  const totals = new Map<bigint, bigint>()
  for (const order of orders) {
    const price = atoms(order.price as { toString(): string }) / PRICE_SCALE
    totals.set(price, (totals.get(price) ?? 0n) + atoms(order.numBaseAtoms as { toString(): string }))
  }
  return [...totals].map(([price, quantity]) => ({ price, quantity }))
}

/** Best-of-book by reduce, never by array index. The Manifest SDK returns
 *  bids()/asks() least-competitive first (its own bestBidPrice() takes .at(-1))
 *  and levels() does not sort, so asks[0] is the *worst* ask. */
export function bookQuote(asks: DepthLevel[], bids: DepthLevel[]): VenueQuote {
  const ask = asks.reduce<bigint | undefined>((best, row) => best === undefined || row.price < best ? row.price : best, undefined)
  const bid = bids.reduce<bigint | undefined>((best, row) => best === undefined || row.price > best ? row.price : best, undefined)
  // A one-sided book returns that side alone: averaging a lone bid with nothing
  // would invent a mid that no one is offering.
  return { bid, ask, ...(ask !== undefined && bid !== undefined ? { mid: (ask + bid) / 2n } : {}) }
}

/** Reads the guarded Manifest books for both outcomes of one question.
 *  Mirrors useDreamDexSnapshot: poll, scope by binding, never show another
 *  market's data, and re-read on a confirmed transaction. */
export function useSolanaMarket(binding: SolanaBinding | null, enabled: boolean, owner?: string): VenueMarketView {
  const scope = binding ? solanaScope(binding.rpcUrl, binding.marketId) : ''
  const key = `${scope}:${owner ?? ''}`
  const revision = useVenueRevision(scope)
  const [state, setState] = useState<{ key: string; book: VenueBook | null; quote: { yes?: VenueQuote; no?: VenueQuote } | null; error: string | null; now: number }>({ key: '', book: null, quote: null, error: null, now: 0 })
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    // Constructed inside the guard: ManifestAdapter's constructor throws on a
    // malformed deployment, and a throw in an effect body escapes React and
    // blanks the entire page rather than just emptying this panel.
    let client: ReturnType<typeof createManifestHybridClient>
    try {
      client = manifestClient(binding.rpcUrl, {
        genesisHash: binding.genesisHash,
        predictionProgram: binding.predictionProgram,
        manifestProgram: binding.manifestProgram,
        collateralMint: binding.collateralMint,
      })
    } catch (reason) {
      setState({ key, book: null, quote: null, now: Date.now(), error: reason instanceof Error ? reason.message : 'Solana venue misconfigured.' })
      return
    }
    async function load() {
      setRefreshing(true)
      try {
        // Settled, not all: a question can have one outcome book activated and not
        // the other, and one unreadable side must not blank the side that works.
        const [yes, no] = await Promise.all([0, 1].map(async outcome => {
          try {
            const bound = await client.binding(binding!.marketId, outcome as 0 | 1)
            return await client.adapter.readBook(bound)
          } catch (reason) {
            if (reason instanceof Error && reason.message === 'Question is not activated for Manifest') return null
            throw reason
          }
        }))
        if (!active) return
        const side = (b: { asks(): unknown[]; bids(): unknown[] } | null) =>
          b ? { asks: levels(b.asks().filter(o => !owner || (o as { trader: { toBase58(): string } }).trader.toBase58() !== owner) as never[]), bids: levels(b.bids().filter(o => !owner || (o as { trader: { toBase58(): string } }).trader.toBase58() !== owner) as never[]) } : { asks: [], bids: [] }
        const y = side(yes as never), n = side(no as never)
        setState({
          key,
          now: Date.now(),
          error: yes || no ? null : 'This question has no Manifest books yet.',
          book: yes || no ? { yesAsks: y.asks, yesBids: y.bids, noAsks: n.asks, noBids: n.bids } : null,
          quote: yes || no ? binaryQuotes(y.asks, y.bids, n.asks, n.bids) : null,
        })
      } catch (reason) {
        // A question whose books are not activated yet is the normal pre-first-trade
        // state, not an error worth showing as a failure.
        if (active) setState(previous => ({ key, book: previous.key === key ? previous.book : null, quote: previous.key === key ? previous.quote : null, now: Date.now(), error: reason instanceof Error ? reason.message : 'Solana market data unavailable.' }))
      } finally {
        if (active) { setRefreshing(false); timer = setTimeout(load, 10_000) }
      }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [key, enabled, revision])

  const refresh = useMemo(() => () => { if (scope) bumpVenue(scope) }, [scope])
  const current = state.key === key ? state : { book: null, quote: null, error: null, now: 0 }
  return {
    family: 'SOLANA',
    opened: Boolean(binding) && current.book !== null,
    book: current.book,
    quote: current.quote ?? undefined,
    decimals: binding?.collateralDecimals ?? 6,
    finalized: Boolean(binding && Date.now() >= binding.tradingLocksAt),
    now: current.now,
    error: current.error,
    refreshing,
    refresh,
  }
}