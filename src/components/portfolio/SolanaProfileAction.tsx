import { cancelProfileOrder } from './profileActions'
import { useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import type { ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'
import { useSolanaWallet } from '../session/store'
import { manifestClient } from '../home/venue/manifestClients'
import { refreshSolana } from '../home/venue/revision'
import { formatUnitsExact } from '../prediction/amounts'
import type { SolanaOrderRow, SolanaPositionRow } from './solanaRows'
export type ProfileAction =
  | { kind: 'claim'; row: SolanaPositionRow }
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
  return (
    <aside
      className="pf-action sp-action"
      aria-label={`${action.kind} position`}
    >
      <header>
        <h3>
          {action.kind === 'claim' ? 'Claim payout' : 'Cancel order'}
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
