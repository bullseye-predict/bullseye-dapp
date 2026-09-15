import { useEffect, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { ManifestHoldersReader, type ManifestClaimHolder } from '../../../../packages/adapters/solana/manifest/holders'
import { manifestClient } from './manifestClients'
import { solanaScope, useVenueRevision } from './revision'
import type { SolanaBinding } from './types'

export type SolanaTopHoldersView = {
  /** null until the first read completes, so a renderer can tell "still reading"
   *  from "read, and nobody holds this question yet". */
  holders: ManifestClaimHolder[] | null
  /** True when a scan failed: the list is then a floor, not the leaderboard.
   *  getProgramAccounts leans on the validator's secondary indexes, which some
   *  hosted RPCs disable or throttle harder than an ordinary read. */
  partial: boolean
  error: string
  loading: boolean
}

export const EMPTY_TOP_HOLDERS: SolanaTopHoldersView = { holders: null, partial: false, error: '', loading: false }

/**
 * Every wallet holding either outcome of one Solana question.
 *
 * No poll of its own, for the same reason useSolanaHoldings has none: the read
 * is two program scans plus a chunked vault hop, and a leaderboard is not a
 * quote. It reads on mount and whenever a confirmed transaction bumps this
 * question's revision scope — which is the only moment these balances can move.
 */
export function useSolanaTopHolders(binding: SolanaBinding | null, enabled: boolean): SolanaTopHoldersView {
  const key = binding ? solanaScope(binding.rpcUrl, binding.marketId) : ''
  const revision = useVenueRevision(key)
  const [state, setState] = useState<SolanaTopHoldersView & { key: string }>({ ...EMPTY_TOP_HOLDERS, key: '' })
  // One reader per question, so a revision bump reuses the connection rather
  // than building a second one alongside the shared client's.
  const reader = useRef<{ key: string; reader: ManifestHoldersReader } | null>(null)

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    // Constructed inside the guard: the adapter constructor throws on a malformed
    // deployment, and a throw from an effect body escapes React and blanks the
    // whole page rather than this one panel.
    let client: ReturnType<typeof manifestClient>
    try {
      client = manifestClient(binding.rpcUrl, { genesisHash: binding.genesisHash, predictionProgram: binding.predictionProgram, manifestProgram: binding.manifestProgram, collateralMint: binding.collateralMint })
    } catch (reason) {
      setState({ ...EMPTY_TOP_HOLDERS, key, error: reason instanceof Error ? reason.message : 'Solana venue misconfigured.' })
      return
    }
    const adapter = client.adapter
    if (reader.current?.key !== key) reader.current = { key, reader: new ManifestHoldersReader(adapter.connection, new PublicKey(binding.predictionProgram)) }
    const current = reader.current.reader
    setState(previous => previous.key === key ? { ...previous, loading: true } : { ...EMPTY_TOP_HOLDERS, key, loading: true })

    async function load() {
      try {
        const question = new PublicKey(binding!.marketId)
        // Both outcome bindings in one request, and their books in one more —
        // exactly the two reads the price hook already makes for this question.
        // An unactivated outcome comes back null, which is the normal
        // pre-first-trade state and must not blank the side that works.
        const bindings = await adapter.bindings([0, 1].map(outcome => ({ question, outcome: outcome as 0 | 1 })))
        const books = await adapter.books(bindings)
        if (!active) return
        const { holders, partial } = await current.read(question, bindings, books)
        if (!active) return
        setState({ key, holders, partial, error: '', loading: false })
      } catch (reason) {
        // Keep the last good list through a transient RPC failure; replacing it
        // with an empty one would read as every holder having sold.
        if (active) setState(previous => ({
          key,
          holders: previous.key === key ? previous.holders : null,
          partial: previous.key === key ? previous.partial : false,
          error: reason instanceof Error && /429|rate/i.test(reason.message) ? 'Solana RPC is throttling this read. Holders will refresh shortly.' : reason instanceof Error ? reason.message : 'Holder data unavailable.',
          loading: false,
        }))
      }
    }
    void load()
    return () => { active = false }
  }, [key, enabled, revision])

  return state.key === key ? state : { ...EMPTY_TOP_HOLDERS, loading: Boolean(enabled && binding) }
}
