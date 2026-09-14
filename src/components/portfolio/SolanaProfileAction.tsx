import { cancelProfileOrder, submitProfileSale } from './profileActions'
import { useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import type { ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'
import { takerFee } from '../../../packages/adapters/solana/manifest/wire'
import { useSolanaWallet } from '../session/store'
import { manifestClient } from '../home/venue/manifestClients'
import { refreshSolana } from '../home/venue/revision'
import { formatUnitsExact, parseUnitsExact } from '../prediction/amounts'
import { decodeTraderFills } from './solanaFills'
import type { SolanaOrderRow, SolanaPositionRow } from './solanaRows'
export type ProfileAction =
  | { kind: 'sell' | 'claim'; row: SolanaPositionRow }
  | { kind: 'cancel'; row: SolanaOrderRow }
export function SolanaProfileAction({
  action,
  venue,
  owner,
  onClose,
  onRefresh,
}: {
  action: ProfileAction
  venue: PublicPredictionVenue
  owner: string
  onClose: () => void
  onRefresh: () => void
}) {
  const port = useSolanaWallet()
  const client = useMemo(
    () =>
      manifestClient(venue.publicRpcUrl!, {
        genesisHash: venue.chainId,
        predictionProgram: venue.programId!,
        manifestProgram: venue.manifestProgramId!,
        collateralMint: venue.collateralToken,
      }),
    [
      venue.publicRpcUrl,
      venue.chainId,
      venue.programId,
      venue.manifestProgramId,
      venue.collateralToken,
    ],
  )
  const wallet = useMemo(
    () =>
      port?.address === owner
        ? new ManifestBrowserWallet(client.adapter, port, client)
        : null,
    [client, port, owner],
  )
  useEffect(() => () => wallet?.dispose(), [wallet])
  const [binding, setBinding] = useState<ManifestBinding | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [uncertain, setUncertain] = useState(false)
  const [quantity, setQuantity] = useState(
    action.kind === 'sell' ? formatUnitsExact(action.row.quantity, 6, 6) : '',
  )
  const [price, setPrice] = useState(''),
    [kind, setKind] = useState<'IOC' | 'LIMIT'>('IOC'),
    [review, setReview] = useState(false)
  const marketId = action.row.identity.marketId,
    outcome = action.row.outcome
  useEffect(() => {
    let active = true
    void client.adapter
      .binding(new PublicKey(marketId), outcome)
      .then((b) => {
        if (active) setBinding(b)
      })
      .catch((e) => {
        if (active) setMessage(e.message)
      })
    return () => {
      active = false
    }
  }, [client, marketId, outcome])
  const refresh = () => {
    refreshSolana(venue.publicRpcUrl!, marketId)
    onRefresh()
  }
  const run = async (
    task: (w: ManifestBrowserWallet, b: ManifestBinding) => Promise<void>,
  ) => {
    if (!wallet || !binding || busy || uncertain) return
    setBusy(true)
    setMessage('Review the request in your wallet.')
    try {
      await task(wallet, binding)
    } catch (e) {
      const text = e instanceof Error ? e.message : 'Transaction failed'
      setMessage(text)
      if (/Check transaction .* before retrying/.test(text)) setUncertain(true)
    } finally {
      // Preparation may have confirmed earlier steps before a later rejection.
      refresh()
      setBusy(false)
    }
  }
  let size = 0n,
    limit = 0n,
    error = ''
  if (action.kind === 'sell')
    try {
      size = parseUnitsExact(quantity, 6)
      limit = parseUnitsExact(price, 4)
      if (size <= 0n || limit <= 0n || limit >= 1_000_000n)
        error = 'Enter positive shares and a minimum price between 0 and 100¢.'
    } catch {
      error = 'Enter shares and a minimum price in cents.'
    }
  const maxFee = binding ? takerFee(size, binding.bps) : 0n
  const sell = () =>
    run(async (w, b) => {
      const signature = await submitProfileSale(client.adapter, w, b, {
        side: 'SELL',
        quantity: size,
        priceMicros: limit,
        lastValidSlot: 0,
        kind,
        maxFeeAtoms: maxFee,
      })
      const receipt = await client.adapter.connection.getTransaction(
        signature,
        { commitment: 'confirmed', maxSupportedTransactionVersion: 0 },
      )
      if (!receipt?.meta?.logMessages) {
        setMessage(`Confirmed ${signature}. Fill details are syncing.`)
        return
      }
      const fills = decodeTraderFills(
        receipt.meta.logMessages,
        venue.manifestProgramId!,
        owner,
        { address: b.venue.toBase58(), marketId, outcome },
        signature,
        (receipt.blockTime ?? 0) * 1000,
      ).filter((f) => f.side === 'SELL')
      const filled = fills.reduce((n, f) => n + f.shares, 0n)
      setMessage(
        `Sold ${formatUnitsExact(filled, 6, 6)} shares. ${filled < size ? (kind === 'IOC' ? 'The unfilled remainder was cancelled.' : 'The remainder is an open limit order.') : 'Fully filled.'}`,
      )
      setReview(false)
    })
  return (
    <aside
      className="pf-action sp-action"
      aria-label={`${action.kind} position`}
    >
      <header>
        <h3>
          {action.kind === 'sell'
            ? 'Sell shares'
            : action.kind === 'claim'
              ? 'Claim payout'
              : 'Cancel order'}
        </h3>
        <button aria-label="Close action" disabled={busy} onClick={onClose}>
          ×
        </button>
      </header>
      <strong>{action.row.identity.label}</strong>
      <p>{action.row.identity.outcomeLabels[outcome]}</p>
      {!wallet && (
        <p role="alert">Connect the profile owner’s wallet to continue.</p>
      )}
      {action.kind === 'sell' && (
        <>
          <label>
            Shares
            <input
              value={quantity}
              inputMode="decimal"
              onChange={(e) => {
                setQuantity(e.target.value)
                setReview(false)
              }}
            />
          </label>
          <label>
            Minimum price (¢)
            <input
              value={price}
              inputMode="decimal"
              onChange={(e) => {
                setPrice(e.target.value)
                setReview(false)
              }}
            />
          </label>
          <label>
            Order type
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value as typeof kind)
                setReview(false)
              }}
            >
              <option value="IOC">Immediate · cancel unfilled</option>
              <option value="LIMIT">Limit · keep unfilled open</option>
            </select>
          </label>
          <button
            disabled={!wallet || !binding || busy || uncertain}
            onClick={() =>
              void run(async (w, b) => {
                await w.prepare(b)
                let h = await client.adapter.holdings(w.owner, b)
                if (h.internalClaims > 0n)
                  await w.claims(b, h.internalClaims, 'export')
                h = await client.adapter.holdings(w.owner, b)
                if (h.walletClaims > 0n)
                  await w.send(
                    await client.adapter.moveTokens(
                      w.owner,
                      b,
                      'claims',
                      h.walletClaims,
                      'deposit',
                    ),
                    'Move shares to the order book',
                  )
                setMessage('Available shares are ready on the order book.')
              })
            }
          >
            Prepare available shares
          </button>
          <p>
            Preparation can require multiple wallet signatures. Shares in open
            sell orders stay reserved.
          </p>
          {review ? (
            <>
              <p>
                {formatUnitsExact(size, 6, 6)} shares at a minimum{' '}
                {formatUnitsExact(limit * 100n, 6, 4)}¢. Gross proceeds if fully
                filled at that price:{' '}
                {formatUnitsExact((size * limit) / 1_000_000n, 6, 6)}{' '}
                {venue.collateralSymbol}. Maximum fee authorization:{' '}
                {formatUnitsExact(maxFee, 6, 6)} {venue.collateralSymbol};
                actual fees depend on execution.
              </p>
              <button
                className="pf-sell"
                disabled={!!error || !wallet || !binding || busy || uncertain}
                onClick={() => void sell()}
              >
                Sign & sell
              </button>
            </>
          ) : (
            <button
              className="pf-sell"
              disabled={!!error || !wallet || !binding || busy || uncertain}
              onClick={() => setReview(true)}
            >
              Review sale
            </button>
          )}
          {error && <p>{error}</p>}
        </>
      )}
      {action.kind === 'cancel' && (
        <>
          <p>
            Release the remaining{' '}
            {formatUnitsExact(action.row.order.quantity, 6, 6)} shares’
            reservation for order #{action.row.order.sequence}. Already filled
            shares are unaffected.
          </p>
          <button
            disabled={!wallet || !binding || busy || uncertain}
            onClick={() =>
              void run(async (w, b) => {
                const result = await cancelProfileOrder(
                  client.adapter,
                  w,
                  b,
                  action.row.order.sequence,
                )
                if (result.status === 'already-closed') {
                  setMessage(
                    'This order is no longer open. Balances refreshed.',
                  )
                  return
                }
                setMessage(
                  'Order cancelled. Reserved funds or shares are available on the venue seat.',
                )
              })
            }
          >
            Sign & cancel order
          </button>
        </>
      )}
      {action.kind === 'claim' && (
        <>
          <p>
            First cancel any open sell orders for this question. Preparation
            withdraws available claims from both books and imports wallet claims
            into your prediction vault. Each step requests a wallet signature.
          </p>
          <button
            disabled={!wallet || !binding || busy || uncertain}
            onClick={() =>
              void run(async (w, b) => {
                await w.prepare(b)
                for (const side of [0, 1] as const) {
                  const sideBinding = await client.adapter.binding(
                    b.question,
                    side,
                  )
                  let h = await client.adapter.holdings(w.owner, sideBinding)
                  if (h.venueReservedClaims > 0n)
                    throw new Error(
                      'Cancel open sell orders for this question before claiming.',
                    )
                  if (h.venueAvailableClaims > 0n)
                    await w.send(
                      await client.adapter.moveTokens(
                        w.owner,
                        sideBinding,
                        'claims',
                        h.venueAvailableClaims,
                        'withdraw',
                      ),
                      'Withdraw claim shares',
                    )
                  h = await client.adapter.holdings(w.owner, sideBinding)
                  if (h.walletClaims > 0n)
                    await w.claims(sideBinding, h.walletClaims, 'import')
                }
                setMessage(
                  'Claims prepared. Review and redeem the settled payout below.',
                )
              })
            }
          >
            Prepare claims
          </button>
          <button
            className="pf-primary"
            disabled={!wallet || !binding || busy || uncertain}
            onClick={() =>
              void run(async (w, b) => {
                await w.collateral(b, 'redeem')
                setMessage('Payout redeemed to your prediction vault.')
              })
            }
          >
            Sign & redeem payout
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
      {busy && <p>Waiting for wallet or confirmation…</p>}
      {uncertain && (
        <p>
          Check the transaction and refresh the profile before opening another
          action.
        </p>
      )}
    </aside>
  )
}
