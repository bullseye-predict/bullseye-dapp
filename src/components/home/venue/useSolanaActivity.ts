import { useEffect, useMemo, useRef, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import { bookAddress } from '../../../../packages/adapters/solana/manifest/wire'
import { manifestClient } from './manifestClients'
import { solanaScope, useVenueRevision } from './revision'
import { schedulePoll } from './pollGate'
import { ManifestActivityReader, type ActivityBook } from './solanaActivity'
import type { SolanaBinding, VenueActivityRow } from './types'

export type VenueActivityView = { rows: VenueActivityRow[]; error: string; loading: boolean }

/** Both outcome books for a question, derived locally. `bookAddress` is a PDA,
 *  so discovery costs no RPC — and a book that has not been activated simply
 *  returns an empty signature list, which is the correct "nothing yet" state. */
export function activityBooks(binding: SolanaBinding, labels: [string, string] = ['YES', 'NO']): ActivityBook[] {
  const program = new PublicKey(binding.predictionProgram)
  const question = new PublicKey(binding.marketId)
  return [0, 1].map(outcome => ({
    address: bookAddress(program, question, outcome as 0 | 1).toBase58(),
    outcome: outcome as 0 | 1,
    label: labels[outcome]!,
    oppositeLabel: labels[outcome === 0 ? 1 : 0],
    question: binding.marketId,
    predictionProgram: binding.predictionProgram,
  }))
}

/** Reads both guarded Manifest books for one question. Mirrors useSolanaMarket:
 *  poll, scope by binding, never show another market's rows, and re-read on a
 *  confirmed transaction. */
export function useSolanaActivity(binding: SolanaBinding | null, enabled: boolean): VenueActivityView {
  const key = binding ? solanaScope(binding.rpcUrl, binding.marketId) : ''
  const revision = useVenueRevision(key)
  // Starts not-loading. An initial `loading: true` collides with the stale-key
  // sentinel below when both keys are the empty string — which is exactly the
  // disabled case — and renders a spinner for a read that will never start.
  const [state, setState] = useState<{ key: string; rows: VenueActivityRow[]; error: string; loading: boolean }>({ key: '', rows: [], error: '', loading: false })
  // One reader per question keeps the decoded-receipt cache across polls.
  const reader = useRef<{ key: string; reader: ManifestActivityReader } | null>(null)
  const books = useMemo(() => binding ? activityBooks(binding) : [], [key])

  useEffect(() => {
    if (!enabled || !binding) return
    let active = true
    // A cancel function rather than a timeout id: the poll is gated, so it
    // may be waiting on a visibility or cooldown event instead of a clock.
    let timer: (() => void) | undefined
    const controller = new AbortController()
    let client: ReturnType<typeof manifestClient>
    try {
      client = manifestClient(binding.rpcUrl, { genesisHash: binding.genesisHash, predictionProgram: binding.predictionProgram, manifestProgram: binding.manifestProgram, collateralMint: binding.collateralMint })
    } catch (reason) {
      setState({ key, rows: [], error: reason instanceof Error ? reason.message : 'Solana venue misconfigured.', loading: false })
      return
    }
    if (reader.current?.key !== key) reader.current = { key, reader: new ManifestActivityReader(client.adapter.connection, binding.manifestProgram) }
    setState(previous => previous.key === key ? previous : { key, rows: [], error: '', loading: true })
    const current = reader.current.reader
    async function load() {
      const timeout = setTimeout(() => {
        if (active) setState(previous => ({ key, rows: previous.key === key ? previous.rows : [], error: 'Solana activity is taking longer than expected. Retrying; confirmed transactions may appear shortly.', loading: false }))
      }, 12_000)
      try {
        const { rows, partial } = await current.read(books, address => new PublicKey(address), controller.signal, () => {
          if (active) setState({ key, rows: current.cached(books), error: '', loading: false })
        })
        if (!active) return
        // The reader returns only what this pass fetched; the cache holds the
        // rest, so a bounded backfill does not make earlier rows disappear.
        const merged = current.cached(books)
        setState({ key, rows: merged.length ? merged : rows, error: partial && !merged.length ? 'Some recent transactions could not be read yet.' : '', loading: false })
      } catch (reason) {
        if (active) setState(previous => ({ key, rows: previous.key === key ? previous.rows : [], error: reason instanceof Error ? reason.message : 'Market activity unavailable.', loading: false }))
      } finally {
        clearTimeout(timeout)
        if (active && !controller.signal.aborted) timer = schedulePoll(() => void load(), 10_000)
      }
    }
    void load()
    return () => { active = false; controller.abort(); timer?.() }
  }, [key, enabled, revision])

  return state.key === key ? state : { rows: [], error: '', loading: Boolean(enabled && binding) }
}
