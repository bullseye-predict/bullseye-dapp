import { useEffect, useMemo, useState } from 'react'
import { ManifestPortfolioReader } from '../../portfolio/solanaPortfolio'
import type { ArenaMarket } from '../../solz/model'
import type { SolanaBinding } from './types'
import { venueBinding } from './useVenueMarket'
import { manifestClient } from './manifestClients'

/** One outcome of one market, as the accounting service reports it. Amounts stay
 *  in collateral atoms: a cost basis that has been through a float is not a cost
 *  basis. */
export type VenuePositionRow = {
  outcomeId: string
  outcome: 0 | 1
  quantity: bigint
  /** Null when the service could not account for this position — see `reason`. */
  costBasis: bigint | null
  average: bigint | null
  current: bigint | null
  value: bigint | null
  pnl: bigint | null
  realized: bigint | null
  /** Shares this wallet has sold or redeemed. Non-zero with `quantity` at zero
   *  is a closed trade, which has a realised result worth showing. */
  disposed: bigint
  complete: boolean
  reason?: string
}

export type VenuePositionsView = {
  /** null until the service has answered. An empty array is a real answer: this
   *  wallet holds nothing in this market. */
  rows: VenuePositionRow[] | null
  /** True when this market settles somewhere the accounting service indexes. */
  supported: boolean
  /** True when there is a wallet to report on at all. */
  connected: boolean
  /** The wallet these rows belong to, so a renderer can show whose they are
   *  without being handed the session separately. */
  owner?: string
  /** The replay could not see the whole history, so every P&L on screen is a
   *  partial figure and says so. */
  complete: boolean
  reason?: string
  decimals: number
  error: string
  loading: boolean
}

const EMPTY: VenuePositionsView = { rows: null, supported: false, connected: false, complete: true, decimals: 6, error: '', loading: false }

/**
 * Your own positions in one market, read directly from the configured Solana
 * deployment. Position quantities and the executable best bid are authoritative
 * on chain; a future indexer may add cost basis and complete P/L.
 */
export function useVenuePositions(market: ArenaMarket, owner: string | undefined, _apiUrl: string, enabled = true): VenuePositionsView {
  const binding = venueBinding(market)
  const solana = binding?.family === 'SOLANA' ? binding as SolanaBinding : null
  const active = Boolean(solana && enabled && owner)
  const [holding, setHolding] = useState<Awaited<ReturnType<ManifestPortfolioReader['read']>>['questions'][number] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active || !solana || !owner) { setHolding(null); setLoading(false); setError(''); return }
    let cancelled = false
    setLoading(true)
    setError('')
    try {
      const client = manifestClient(solana.rpcUrl, {
        genesisHash: solana.genesisHash,
        predictionProgram: solana.predictionProgram,
        manifestProgram: solana.manifestProgram,
        collateralMint: solana.collateralMint,
      })
      const reader = new ManifestPortfolioReader(client.adapter)
      void reader.read(owner, [solana.marketId], []).then((portfolio) => {
        if (cancelled) return
        setHolding(portfolio.questions.find((question) => question.marketId === solana.marketId) ?? null)
        setLoading(false)
      }).catch((reason) => {
        if (cancelled) return
        setHolding(null)
        setLoading(false)
        setError(reason instanceof Error ? reason.message : 'Solana position is unavailable.')
      })
    } catch (reason) {
      setHolding(null)
      setLoading(false)
      setError(reason instanceof Error ? reason.message : 'Solana venue is misconfigured.')
    }
    return () => { cancelled = true }
  }, [active, owner, solana?.marketId, solana?.rpcUrl, solana?.genesisHash, solana?.predictionProgram, solana?.manifestProgram, solana?.collateralMint])
  const outcomeIds = market.outcomes.map(outcome => outcome.id)

  return useMemo(() => {
    if (!solana) return EMPTY
    const decimals = solana.collateralDecimals
    const base = { supported: true, connected: Boolean(owner), decimals, ...(owner ? { owner } : {}) }
    if (!owner) return { ...EMPTY, ...base, rows: [], loading: false }
    if (error) return { ...EMPTY, ...base, error, loading: false }
    if (loading) return { ...EMPTY, ...base, loading: true }
    if (!holding) return { ...EMPTY, ...base, rows: [], loading: false }
    return {
      ...base,
      loading: false,
      error: '',
      complete: false,
      reason: 'Holdings are read live from Solana. Cost basis and P/L need a complete fill index.',
      rows: ([0, 1] as const).flatMap((outcome): VenuePositionRow[] => {
        const outcomeId = outcomeIds[outcome]
        if (!outcomeId) return []
        const side = holding.outcomes[outcome]
        const quantity = side.totalShares
        if (quantity === 0n && side.seatCollateral === 0n && side.reservedCollateral === 0n) return []
        const current = side.bestBid ?? null
        return [{
          outcomeId,
          outcome,
          quantity,
          costBasis: null,
          average: null,
          current,
          value: current === null ? null : quantity * current / 10n ** BigInt(decimals),
          pnl: null,
          realized: null,
          disposed: 0n,
          complete: false,
          reason: 'Cost basis and P/L need a complete fill index.',
        }]
      }),
    }
    // outcomeIds is rebuilt every render; join it so the memo tracks its value.
  }, [solana?.marketId, solana?.collateralDecimals, owner, holding, loading, error, outcomeIds.join('|')])
}
