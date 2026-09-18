import { useEffect, useMemo, useState } from 'react'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import { manifestClient } from '../home/venue/manifestClients'
import { useSolanaWallet } from '../session/store'
import { formatUnitsExact } from '../prediction/amounts'
import { withdrawVaultCollateral } from './profileActions'

/**
 * The last signature of a claim: prediction vault to wallet.
 *
 * It lives on the collateral disclosure rather than on a position row because
 * the vault balance outlives every row that pays into it. A redeemed position
 * holds no shares, so its row settles to Closed and the trader stops looking at
 * it — the money is an account-level balance from that moment on, and burying
 * its only exit inside a per-market panel is what stranded it.
 */
export function SolanaVaultWithdraw({
  venue,
  owner,
  atoms,
  onRefresh,
}: {
  venue: PublicPredictionVenue
  owner: string
  /** Polled balance. Used only to decide whether to offer the button; the
   *  transaction itself re-reads the vault. */
  atoms: bigint
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
    [venue.publicRpcUrl, venue.chainId, venue.programId, venue.manifestProgramId, venue.collateralToken],
  )
  const wallet = useMemo(
    () => (port?.address === owner ? new ManifestBrowserWallet(client.adapter, port, client) : null),
    [client, port, owner],
  )
  useEffect(() => () => wallet?.dispose(), [wallet])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  if (atoms <= 0n && !message) return null
  return (
    <>
      <button
        className="pf-primary sp-vault-withdraw"
        disabled={!wallet || busy || atoms <= 0n}
        onClick={() => {
          if (!wallet || busy) return
          setBusy(true)
          setFailed(false)
          setMessage('Review the withdrawal in your wallet.')
          void withdrawVaultCollateral(client.adapter, wallet, venue.collateralSymbol)
            .then((moved) =>
              setMessage(
                moved > 0n
                  ? `${formatUnitsExact(moved, venue.collateralDecimals, 6)} ${venue.collateralSymbol} are back in your wallet.`
                  : 'The prediction vault was already empty.',
              ),
            )
            .catch((reason: unknown) => {
              setFailed(true)
              setMessage(reason instanceof Error ? reason.message : 'The withdrawal failed.')
            })
            .finally(() => {
              setBusy(false)
              onRefresh()
            })
        }}
      >
        {busy ? 'Waiting for wallet…' : 'Withdraw to wallet'}
      </button>
      {message && (
        <p className={failed ? 'pf-error' : ''} role={failed ? 'alert' : 'status'}>
          {message}
        </p>
      )}
    </>
  )
}
