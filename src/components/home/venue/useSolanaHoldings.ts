import { useEffect, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { ManifestAdapter } from '../../../../packages/adapters/solana/manifest/adapter'
import { manifestClient } from './manifestClients'
import { solanaScope, useVenueRevision } from './revision'
import type { SolanaBinding } from './types'

type Holdings = Awaited<ReturnType<ManifestAdapter['holdings']>>
/** One outcome's custody, or the reason it could not be read. An unactivated
 *  book throws inside holdings(); that is the normal pre-first-trade state for
 *  one side and must not blank the side that works. */
export type OutcomeHoldings = { outcome: 0 | 1; holdings: Holdings | null; bps: number | null }
export type SolanaHoldingsView = {
  /** null until the first read completes, so the ticket can tell "loading" from
   *  "read, and the answer is zero" — which is what it could never do before. */
  outcomes: [OutcomeHoldings, OutcomeHoldings] | null
  error: string
  loading: boolean
}

/** The venue's immutable taker fee for this outcome, in basis points. It lives
 *  on the binding, so it does not exist until the books are activated — the
 *  ticket has to say "once the market is opened" rather than imply zero. */
export const takerBps = (entry: OutcomeHoldings | undefined) => entry?.bps ?? null

export const EMPTY_HOLDINGS: SolanaHoldingsView = { outcomes: null, error: '', loading: false }

/** Shares this wallet can actually put behind a sell on one book. Only the
 *  venue seat backs a resting ask: wallet claims need a deposit first, internal
 *  claims need an export, and reserved claims are already committed. */
export const sellableShares = (entry: OutcomeHoldings | undefined) => entry?.holdings?.venueAvailableClaims ?? 0n
/** Every share this wallet owns on one outcome, wherever it sits. */
export const ownedShares = (entry: OutcomeHoldings | undefined) => entry?.holdings?.totalClaims ?? 0n

/**
 * Per-outcome Manifest holdings for the connected wallet.
 *
 * Deliberately has no short poll of its own. Each holdings() call is a validate
 * plus a book read plus a four-key account read, so two outcomes on a 10s timer
 * would double the RPC cost of having the ticket open. It reads on mount and
 * whenever a confirmed transaction bumps this question's revision scope, which
 * is the only time these numbers can actually change for this wallet.
 */
export function useSolanaHoldings(binding: SolanaBinding | null, owner: string | undefined, enabled: boolean): SolanaHoldingsView {
  const key = binding && owner ? `${solanaScope(binding.rpcUrl, binding.marketId)}:${owner}` : ''
  const revision = useVenueRevision(binding ? solanaScope(binding.rpcUrl, binding.marketId) : '')
  const [state, setState] = useState<SolanaHoldingsView & { key: string }>({ ...EMPTY_HOLDINGS, key: '' })

  useEffect(() => {
    if (!enabled || !binding || !owner) return
    let active = true
    let client: ReturnType<typeof manifestClient>
    try {
      client = manifestClient(binding.rpcUrl, { genesisHash: binding.genesisHash, predictionProgram: binding.predictionProgram, manifestProgram: binding.manifestProgram, collateralMint: binding.collateralMint })
    } catch (reason) {
      setState({ key, outcomes: null, error: reason instanceof Error ? reason.message : 'Solana venue misconfigured.', loading: false })
      return
    }
    setState(previous => previous.key === key ? previous : { key, outcomes: null, error: '', loading: true })
    void (async () => {
      try {
        const trader = new PublicKey(owner)
        const question = new PublicKey(binding.marketId)
        const outcomes = await Promise.all(([0, 1] as const).map(async outcome => {
          try {
            const bound = await client.adapter.binding(question, outcome)
            return { outcome, bps: bound.bps, holdings: await client.adapter.holdings(trader, bound) }
          } catch (reason) {
            if (reason instanceof Error && reason.message === 'Question is not activated for Manifest') return { outcome, holdings: null, bps: null }
            throw reason
          }
        }))
        if (active) setState({ key, outcomes: outcomes as [OutcomeHoldings, OutcomeHoldings], error: '', loading: false })
      } catch (reason) {
        if (active) setState({ key, outcomes: null, error: reason instanceof Error ? reason.message : 'Balances unavailable.', loading: false })
      }
    })()
    return () => { active = false }
  }, [key, enabled, revision])

  return state.key === key ? state : { ...EMPTY_HOLDINGS, loading: Boolean(enabled && binding && owner) }
}
