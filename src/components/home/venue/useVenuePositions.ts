import { useMemo } from 'react'
import type { PositionAccounting } from '../../../../packages/prediction-core/portfolio/model'
import { useProfileAccounting } from '../../portfolio/useProfileAccounting'
import type { ArenaMarket } from '../../solz/model'
import type { SolanaBinding } from './types'
import { venueBinding } from './useVenueMarket'

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

const atoms = (value: string | null | undefined): bigint | null => {
  if (value == null) return null
  try { return BigInt(value) } catch { return null }
}

/**
 * Your own positions in one market — the fourth of the useVenueMarket family.
 *
 * This reads the same portfolio accounting service the profile page reads, for
 * one market instead of all of them. It has to: a position account on this venue
 * carries quantities and nothing else, and the Manifest seat's quoteVolume is a
 * lifetime bidirectional sum, so entry price and P&L cannot be derived from the
 * chain at read time by anyone. They come from replaying this wallet's own fills
 * in order, which is what the indexer behind `/solana/portfolio/:owner` does.
 *
 * Before this hook the Positions tab read the local arena preview's account,
 * which is why it was permanently empty on every Solana question: nothing you
 * ever traded on chain was in it.
 */
export function useVenuePositions(market: ArenaMarket, owner: string | undefined, apiUrl: string, enabled = true): VenuePositionsView {
  const binding = venueBinding(market)
  const solana = binding?.family === 'SOLANA' ? binding as SolanaBinding : null
  const active = Boolean(solana && enabled && apiUrl)
  // useProfileAccounting is inert without an owner, which is how this hook stays
  // gated without breaking hook order.
  const { data, error } = useProfileAccounting(active ? apiUrl : '', active ? owner : undefined, '', '', 0)
  const outcomeIds = market.outcomes.map(outcome => outcome.id)

  return useMemo(() => {
    if (!solana) return EMPTY
    const decimals = solana.collateralDecimals
    const base = { supported: true, connected: Boolean(owner), decimals, ...(owner ? { owner } : {}) }
    if (!owner) return { ...EMPTY, ...base, rows: [], loading: false }
    if (error) return { ...EMPTY, ...base, error, loading: false }
    if (!data) return { ...EMPTY, ...base, loading: true }
    const mine = data.accounting.positions.filter((position: PositionAccounting) => position.marketId === solana.marketId)
    return {
      ...base,
      loading: false,
      error: '',
      complete: data.accounting.complete && data.coverage.complete,
      reason: data.accounting.reason ?? data.coverage.reason,
      rows: mine.flatMap((position): VenuePositionRow[] => {
        const outcomeId = outcomeIds[position.outcome]
        if (!outcomeId) return []
        return [{
          outcomeId,
          outcome: position.outcome,
          quantity: atoms(position.quantity) ?? 0n,
          costBasis: atoms(position.costBasis),
          average: atoms(position.average),
          current: atoms(position.current),
          value: atoms(position.value),
          pnl: atoms(position.pnl),
          realized: atoms(position.realized),
          disposed: atoms(position.disposed) ?? 0n,
          complete: position.complete,
          ...(position.reason ? { reason: position.reason } : {}),
        }]
      }),
    }
    // outcomeIds is rebuilt every render; join it so the memo tracks its value.
  }, [solana?.marketId, solana?.collateralDecimals, owner, data, error, outcomeIds.join('|')])
}
