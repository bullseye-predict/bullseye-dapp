import { binaryQuotes, complementAsks } from '../../../../packages/adapters/solana/manifest/quotes'
import { useEffect, useMemo, useState } from 'react'
import type { createManifestHybridClient } from '../../../../packages/adapters/solana/manifest/hybrid'
import { manifestClient } from './manifestClients'
import type { DepthLevel } from '../LiveOrderBook'
import type { SolanaBinding, VenueBook, VenueMarketView, VenueQuote } from './types'
import { bumpVenue, solanaScope, useVenueRevision } from './revision'
import { schedulePoll } from './pollGate'

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
export const levels = (orders: { price: unknown; numBaseAtoms: unknown; trader?: unknown }[], owner?: string): DepthLevel[] => {
  const totals = new Map<bigint, { quantity: bigint; own: bigint }>()
  for (const order of orders) {
    const price = atoms(order.price as { toString(): string }) / PRICE_SCALE
    const quantity = atoms(order.numBaseAtoms as { toString(): string })
    const row = totals.get(price) ?? { quantity: 0n, own: 0n }
    row.quantity += quantity
    if (owner && (order.trader as { toBase58(): string } | undefined)?.toBase58() === owner) row.own += quantity
    totals.set(price, row)
  }
  // `own` only means anything once a caller has named a trader, and leaving the
  // key off otherwise keeps a level exactly the shape it has always been.
  return [...totals].map(([price, row]) => owner ? { price, quantity: row.quantity, own: row.own } : { price, quantity: row.quantity })
}

/** The part of the depth this viewer can actually take.
 *
 *  Your own resting orders are real size on the book, but nobody can fill their
 *  own order — placeBinaryLimitBuy raises an error naming the offending bid — so
 *  a quote or a route built on them promises a fill that cannot happen. Drop
 *  them here, at the point where depth becomes a price, and nowhere else: the
 *  ladder keeps drawing them marked as yours, because a panel that hides your
 *  order contradicts the order you can see in your own Activity. */
export const executable = (rows: readonly DepthLevel[]): DepthLevel[] =>
  rows.map(row => ({ price: row.price, quantity: row.quantity - (row.own ?? 0n) })).filter(row => row.quantity > 0n)

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
  // `opened` is what the read actually found, kept apart from `error` so the
  // panel can tell a question that has no books yet from a read that failed.
  // Collapsing both into a null book is what made an unopened question shimmer
  // as though it were still loading, forever.
  const [state, setState] = useState<{ key: string; book: VenueBook | null; quote: { yes?: VenueQuote; no?: VenueQuote } | null; error: string | null; now: number; opened: boolean }>({ key: '', book: null, quote: null, error: null, now: 0, opened: false })
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    // A cancel function rather than a timeout id: the poll is gated, so it
    // may be waiting on a visibility or cooldown event instead of a clock.
    let timer: (() => void) | undefined
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
      setState({ key, book: null, quote: null, opened: false, now: Date.now(), error: reason instanceof Error ? reason.message : 'Solana venue misconfigured.' })
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
        // Marked, not filtered. Dropping your own orders here made the panel and
        // the ticket render two different books side by side, because only one
        // of them passes an owner; `executable` now draws that line once, where
        // depth turns into a price.
        const side = (b: { asks(): unknown[]; bids(): unknown[] } | null) =>
          b ? { asks: levels(b.asks() as never[], owner), bids: levels(b.bids() as never[], owner) } : { asks: [], bids: [] }
        const y = side(yes as never), n = side(no as never)
        // Neither book activated is the ordinary state of a question nobody has
        // traded yet, not a failure. It is reported through `opened` so the
        // panel draws an empty book and says the first trade opens it.
        const activated = Boolean(yes || no)
        setState({
          key,
          now: Date.now(),
          opened: activated,
          error: null,
          // The same transform binaryQuotes applies one line below, so the ladder
          // the panel draws and the quote the Buy button prints cannot disagree
          // about what is executable. Asks only: there is no complete-set sell
          // route (inventory.ts nextSell), so a complemented bid ladder would
          // advertise levels this codebase deliberately cannot fill.
          book: activated ? { yesAsks: y.asks, yesBids: y.bids, noAsks: n.asks, noBids: n.bids, crossYesAsks: complementAsks(n.bids), crossNoAsks: complementAsks(y.bids) } : null,
          quote: activated ? binaryQuotes(executable(y.asks), executable(y.bids), executable(n.asks), executable(n.bids)) : null,
        })
      } catch (reason) {
        // A question whose books are not activated yet is the normal pre-first-trade
        // state, not an error worth showing as a failure.
        if (active) setState(previous => ({ key, book: previous.key === key ? previous.book : null, quote: previous.key === key ? previous.quote : null, opened: previous.key === key ? previous.opened : false, now: Date.now(), error: reason instanceof Error ? reason.message : 'Solana market data unavailable.' }))
      } finally {
        if (active) { setRefreshing(false); timer = schedulePoll(load, 10_000) }
      }
    }
    void load()
    return () => { active = false; timer?.() }
  }, [key, enabled, revision])

  const refresh = useMemo(() => () => { if (scope) bumpVenue(scope) }, [scope])
  const current = state.key === key ? state : { book: null, quote: null, error: null, now: 0, opened: false }
  return {
    family: 'SOLANA',
    opened: Boolean(binding) && current.opened,
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