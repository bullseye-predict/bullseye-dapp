import { useCallback, useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import type { ManifestAdapter } from '../../../packages/adapters/solana/manifest/adapter'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import { takerFee } from '../../../packages/adapters/solana/manifest/wire'
import { useSolanaWallet } from '../session/store'
import { manifestClient } from '../home/venue/manifestClients'
import { refreshSolana } from '../home/venue/revision'
import { formatUnitsExact } from '../prediction/amounts'
import { submitProfileSale } from './profileActions'
import { decodeTraderFills } from './solanaFills'
import type { SolanaPositionRow } from './solanaRows'

/** Shares the book will actually release. Anything committed to an open sell
 *  order stays locked until that order is cancelled, so it is never counted. */
export const sellableShares = (row: SolanaPositionRow) =>
  row.custody.wallet + row.custody.seat + row.custody.vault

/** Why an immediate sale cannot run, in the trader's words, or '' if it can. */
export function instantSellBlocker(row: SolanaPositionRow) {
  if (row.state !== 'Trading') return 'This question is no longer trading.'
  if (row.bestBid === undefined)
    return 'No bid is resting on this book. Place a limit order from the event page.'
  if (sellableShares(row) <= 0n)
    return row.custody.reserved > 0n
      ? 'Every share is reserved by an open sell order. Cancel it first.'
      : 'No shares are available to sell.'
  return ''
}

/**
 * Sell a whole position into the resting bid, in one go.
 *
 * Shares can sit in the wallet, the prediction vault or the venue seat, and
 * only seat inventory can back an order, so custody is consolidated first. The
 * size comes from the seat balance read back afterwards rather than from the
 * caller's snapshot: that is the only number the order is allowed to exceed.
 */
export async function sellPositionNow(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  row: SolanaPositionRow,
  manifestProgramId: string,
  onStep: (message: string) => void,
) {
  const bid = row.bestBid
  if (bid === undefined) throw new Error('No bid is resting on this book.')
  const binding = await adapter.binding(
    new PublicKey(row.identity.marketId),
    row.outcome,
  )
  onStep('Approve moving your shares onto the order book.')
  await wallet.prepare(binding)
  let held = await adapter.holdings(wallet.owner, binding)
  if (held.internalClaims > 0n) {
    await wallet.claims(binding, held.internalClaims, 'export')
    held = await adapter.holdings(wallet.owner, binding)
  }
  if (held.walletClaims > 0n) {
    await wallet.send(
      await adapter.moveTokens(
        wallet.owner,
        binding,
        'claims',
        held.walletClaims,
        'deposit',
      ),
      'Move shares to the order book',
    )
    held = await adapter.holdings(wallet.owner, binding)
  }
  const size = held.venueAvailableClaims
  if (size <= 0n)
    throw new Error(
      held.venueReservedClaims > 0n
        ? 'Every share is reserved by an open sell order. Cancel it first.'
        : 'No shares are available to sell.',
    )
  onStep('Approve the sale in your wallet.')
  const signature = await submitProfileSale(adapter, wallet, binding, {
    side: 'SELL',
    quantity: size,
    priceMicros: bid,
    lastValidSlot: 0,
    // Bounded by shares rather than notional: a sell executes above its limit
    // whenever a better bid lands first, so the ceiling has to survive that.
    maxFeeAtoms: takerFee(size, binding.bps),
    kind: 'IOC',
  })
  const receipt = await adapter.connection.getTransaction(signature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  })
  if (!receipt?.meta?.logMessages)
    return { signature, size, filled: null as bigint | null }
  const filled = decodeTraderFills(
    receipt.meta.logMessages,
    manifestProgramId,
    wallet.owner.toBase58(),
    {
      address: binding.venue.toBase58(),
      marketId: row.identity.marketId,
      outcome: row.outcome,
    },
    signature,
    (receipt.blockTime ?? 0) * 1000,
  )
    .filter((fill) => fill.side === 'SELL')
    .reduce((total, fill) => total + fill.shares, 0n)
  return { signature, size, filled }
}

export type InstantSellState = {
  /** Row id currently being sold, so only that button shows progress. */
  pending: string
  /** Row id the last result belongs to. */
  settled: string
  message: string
  /** A failure the trader has to read before the row can be trusted again. */
  failed: boolean
}

/** One click on a position row: consolidate custody and take the resting bid. */
export function useInstantSell(
  venue: PublicPredictionVenue | null,
  owner: string | undefined,
  onRefresh: () => void,
) {
  const [state, setState] = useState<InstantSellState>({
    pending: '',
    settled: '',
    message: '',
    failed: false,
  })
  const client = useMemo(
    () =>
      venue?.publicRpcUrl
        ? manifestClient(venue.publicRpcUrl, {
            genesisHash: venue.chainId,
            predictionProgram: venue.programId!,
            manifestProgram: venue.manifestProgramId!,
            collateralMint: venue.collateralToken,
          })
        : null,
    [
      venue?.publicRpcUrl,
      venue?.chainId,
      venue?.programId,
      venue?.manifestProgramId,
      venue?.collateralToken,
    ],
  )
  const port = useSolanaWallet()
  const wallet = useMemo(
    () =>
      client && port?.address && port.address === owner
        ? new ManifestBrowserWallet(client.adapter, port, client)
        : null,
    [client, port, owner],
  )
  useEffect(() => () => wallet?.dispose(), [wallet])
  const sell = useCallback(
    async (row: SolanaPositionRow) => {
      if (!client || !wallet || !venue || state.pending) return
      const blocker = instantSellBlocker(row)
      if (blocker) {
        setState({
          pending: '',
          settled: row.id,
          message: blocker,
          failed: true,
        })
        return
      }
      setState({
        pending: row.id,
        settled: '',
        message: 'Approve the request in your wallet.',
        failed: false,
      })
      try {
        const { signature, size, filled } = await sellPositionNow(
          client.adapter,
          wallet,
          row,
          venue.manifestProgramId!,
          (message) => setState((s) => ({ ...s, message })),
        )
        setState({
          pending: '',
          settled: row.id,
          failed: false,
          message:
            filled === null
              ? `Confirmed ${signature.slice(0, 8)}…. Fill details are syncing.`
              : filled >= size
                ? `Sold ${formatUnitsExact(filled, 6, 4)} shares.`
                : `Sold ${formatUnitsExact(filled, 6, 4)} of ${formatUnitsExact(size, 6, 4)} shares; the bid did not cover the rest, which stayed on the book.`,
        })
      } catch (error) {
        setState({
          pending: '',
          settled: row.id,
          failed: true,
          message: error instanceof Error ? error.message : 'Sale failed',
        })
      } finally {
        // Preparation can confirm earlier steps before a later rejection, so
        // holdings are re-read whether or not the sale itself went through.
        if (venue.publicRpcUrl)
          refreshSolana(venue.publicRpcUrl, row.identity.marketId)
        onRefresh()
      }
    },
    [client, wallet, venue, state.pending, onRefresh],
  )
  return { ...state, ready: !!wallet, sell }
}
