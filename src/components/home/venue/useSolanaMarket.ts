import { useEffect, useMemo, useState } from 'react'
import { createManifestHybridClient } from '../../../../packages/adapters/solana/manifest/hybrid'
import type { DepthLevel } from '../LiveOrderBook'
import type { SolanaBinding, VenueBook, VenueMarketView } from './types'
import { bumpVenue, useVenueRevision } from './revision'

// Orders are submitted with priceMantissa = priceMicros and priceExponent = -6,
// so the resting price reads back as a 1e18 fixed point of quote atoms per base
// atom. Both mints are 6dp, so dividing by 1e12 returns the same integer the
// ticket sent and the same scale the book renders at.
const PRICE_SCALE = 10n ** 12n
const atoms = (value: { toString(): string }) => BigInt(value.toString())
const levels = (orders: { price: unknown; numBaseAtoms: unknown }[]): DepthLevel[] =>
  orders.map(order => ({ price: atoms(order.price as { toString(): string }) / PRICE_SCALE, quantity: atoms(order.numBaseAtoms as { toString(): string }) }))

/** Reads the guarded Manifest books for both outcomes of one question.
 *  Mirrors useDreamDexSnapshot: poll, scope by binding, never show another
 *  market's data, and re-read on a confirmed transaction. */
export function useSolanaMarket(binding: SolanaBinding | null, enabled: boolean): VenueMarketView {
  const key = binding ? `solana:${binding.rpcUrl}:${binding.marketId}` : ''
  const revision = useVenueRevision(key)
  const [state, setState] = useState<{ key: string; book: VenueBook | null; error: string | null; now: number }>({ key: '', book: null, error: null, now: 0 })
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const client = createManifestHybridClient(binding.rpcUrl, {
      genesisHash: binding.genesisHash,
      predictionProgram: binding.predictionProgram,
      manifestProgram: binding.manifestProgram,
      collateralMint: binding.collateralMint,
    })
    async function load() {
      setRefreshing(true)
      try {
        // Settled, not all: a question can have one outcome book activated and not
        // the other, and one unreadable side must not blank the side that works.
        const [yes, no] = await Promise.all([0, 1].map(async outcome => {
          try {
            const bound = await client.binding(binding!.marketId, outcome as 0 | 1)
            return await client.adapter.readBook(bound)
          } catch { return null }
        }))
        if (!active) return
        const side = (b: { asks(): unknown[]; bids(): unknown[] } | null) =>
          b ? { asks: levels(b.asks() as never[]), bids: levels(b.bids() as never[]) } : { asks: [], bids: [] }
        const y = side(yes as never), n = side(no as never)
        setState({
          key,
          now: Date.now(),
          error: yes || no ? null : 'This question has no Manifest books yet.',
          book: yes || no ? { yesAsks: y.asks, yesBids: y.bids, noAsks: n.asks, noBids: n.bids } : null,
        })
      } catch (reason) {
        // A question whose books are not activated yet is the normal pre-first-trade
        // state, not an error worth showing as a failure.
        if (active) setState({ key, book: null, now: Date.now(), error: reason instanceof Error ? reason.message : 'Solana market data unavailable.' })
      } finally {
        if (active) { setRefreshing(false); timer = setTimeout(load, 10_000) }
      }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [key, enabled, revision])

  const refresh = useMemo(() => () => { if (key) bumpVenue(key) }, [key])
  const current = state.key === key ? state : { book: null, error: null, now: 0 }
  return {
    family: 'SOLANA',
    opened: Boolean(binding) && current.book !== null,
    book: current.book,
    decimals: binding?.collateralDecimals ?? 6,
    finalized: Boolean(binding && Date.now() >= binding.tradingLocksAt),
    now: current.now,
    error: current.error,
    refreshing,
    refresh,
  }
}