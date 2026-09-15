import { useEffect, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { manifestClient } from './manifestClients'
import { solanaScope, useVenueRevision } from './revision'
import type { SolanaBinding } from './types'

/**
 * Does this question's market account already exist on chain?
 *
 * Asked only when neither order book is activated, which is the only case where
 * the answer changes what the trader is told: creating the question is the
 * largest single item in the first-open SOL figure, and a figure that might be
 * wrong by that much is not worth showing. Once either binding exists the
 * question provably exists too, so this stays idle for every other trade.
 *
 * One getAccountInfo, on mount and on a confirmed-transaction revision bump.
 * `undefined` means unread — the plan then marks the step uncertain rather than
 * guessing in either direction.
 */
export function useQuestionPresence(binding: SolanaBinding | null, enabled: boolean): boolean | undefined {
  const key = binding ? solanaScope(binding.rpcUrl, binding.marketId) : ''
  const revision = useVenueRevision(key)
  const [state, setState] = useState<{ key: string; exists: boolean | undefined }>({ key: '', exists: undefined })

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    let client: ReturnType<typeof manifestClient>
    try {
      client = manifestClient(binding.rpcUrl, {
        genesisHash: binding.genesisHash,
        predictionProgram: binding.predictionProgram,
        manifestProgram: binding.manifestProgram,
        collateralMint: binding.collateralMint,
      })
    } catch {
      return
    }
    void (async () => {
      try {
        const record = await client.adapter.connection.getAccountInfo(new PublicKey(binding.marketId), 'confirmed')
        if (active) setState({ key, exists: Boolean(record) })
      } catch {
        // A failed read leaves the step uncertain, which is already how the plan
        // describes an unread question. Nothing to report and nothing to retry.
        if (active) setState({ key, exists: undefined })
      }
    })()
    return () => {
      active = false
    }
  }, [key, enabled, revision])

  return state.key === key ? state.exists : undefined
}
