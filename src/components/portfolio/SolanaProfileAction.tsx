import { claimProfilePayout, releaseProfileOrder, withdrawProfileSeat } from './profileActions'
import { useEffect, useMemo, useState } from 'react'
import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import {
  applyStage,
  claimBlocker,
  claimPayout,
  planClaimSteps,
  planReleaseSteps,
  reconcileSteps,
  type ClaimFacts,
  type LiveStep,
  type Outcome,
  type StepPlan,
} from '../../../packages/adapters/solana/manifest/steps'
import { readWalletError } from '../../../packages/adapters/solana/manifest/messages'
import { explorerTxUrl } from '../../../packages/adapters/explorer'
import { solanaClusterLabel } from '../../../packages/adapters/solana/cluster'
import { ProfileRunDialog, type RunHeadings } from './ProfileRunDialog'
import type { ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'
import { useSolanaWallet } from '../session/store'
import { manifestClient } from '../home/venue/manifestClients'
import { refreshSolana } from '../home/venue/revision'
import { formatUnitsExact } from '../prediction/amounts'
import type { SolanaOrderRow, SolanaPositionRow } from './solanaRows'
export type ProfileAction =
  | { kind: 'claim'; row: SolanaPositionRow }
  | { kind: 'cancel'; row: SolanaOrderRow }
  /** A seat balance with no order behind it. An order cancelled before the
   *  release flow existed leaves exactly this, and it is reachable from
   *  Positions because the order row it used to hang off is gone. */
  | { kind: 'withdraw'; row: SolanaPositionRow }

/** What the dialog renders and what pressing its confirm actually runs. One
 *  shape for all three kinds, so there is one return and one mount point. */
type RunView = {
  headings: RunHeadings
  selection: string
  recap: { term: string; value: string }[]
  note: string
  blocker?: { message: string; detail?: string }
  plan: StepPlan
  run: (wallet: ManifestBrowserWallet, binding: ManifestBinding) => Promise<string>
}

export function SolanaProfileAction({
  action,
  venue,
  owner,
  vaultAtoms,
  onClose,
  onRefresh,
}: {
  action: ProfileAction
  venue: PublicPredictionVenue
  owner: string
  /** What the shared prediction vault already holds. A claim's last signature
   *  takes the whole balance, not only this question's payout, so the plan has
   *  to name it before the first prompt. */
  vaultAtoms: bigint
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
  const [binding, setBinding] = useState<ManifestBinding | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [uncertain, setUncertain] = useState(false),
    // Separate from `message`, which also carries the success line. The dialog
    // must not print "back in your wallet" in the red error slot.
    [failed, setFailed] = useState(false),
    // Every wallet prompt this panel raises, in arrival order. A settled run
    // keeps its rail on screen: the whole point is that the second signature is
    // still legible after the first one has confirmed.
    [liveSteps, setLiveSteps] = useState<LiveStep[]>([]),
    [settled, setSettled] = useState(false),
    // A redeemed payout leaves nothing to redeem again. Latched only when
    // collateral actually reached the wallet — see the run below.
    [claimed, setClaimed] = useState(false)
  // Readiness, not a live object. The wallet itself is built inside the confirm
  // handler: see the note on `run`.
  const connected = port?.address === owner
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
        if (active) {
          setFailed(true)
          setMessage(readWalletError(e).message)
        }
      })
    return () => {
      active = false
    }
  }, [client, marketId, outcome])
  const refresh = () => {
    refreshSolana(venue.publicRpcUrl!, marketId)
    onRefresh()
  }
  const amount = (atoms: bigint) => formatUnitsExact(atoms, venue.collateralDecimals, 6)
  const shares = (atoms: bigint) => formatUnitsExact(atoms, venue.collateralDecimals, 6)

  const view = useMemo<RunView>(() => {
    const row = action.row
    const labels = row.identity.outcomeLabels

    if (action.kind === 'claim') {
      const holding = row.holding
      const claimSide = (side: Outcome) => {
        const held = holding.outcomes[side]
        return {
          seatShares: held.seatShares,
          reservedShares: held.reservedShares,
          walletShares: held.walletShares,
          positionShares: held.vaultShares,
          // Asks only. A resting bid escrows collateral and does not block a
          // claim, so counting the whole order list would tell the trader to
          // cancel buy orders that are not in the way.
          asks: held.orders.filter((order) => order.side === 'SELL').length,
        }
      }
      const facts: ClaimFacts = {
        voided: holding.status === 4,
        winningOutcome: holding.winningOutcome === 1 ? 1 : 0,
        collateralSymbol: venue.collateralSymbol,
        sides: [claimSide(0), claimSide(1)],
        vaultAtoms,
      }
      const block = claimBlocker(facts)
      const payout = claimPayout(facts)
      return {
        headings: {
          idle: 'Claim this payout',
          running: 'Claiming your payout',
          stopped: 'Claim stopped',
          done: 'Payout claimed',
        },
        selection: `Claim · ${labels[outcome]}`,
        recap: [
          { term: 'Lands in your wallet', value: `${amount(vaultAtoms + payout)} ${venue.collateralSymbol}` },
          { term: 'Shares redeemed', value: shares(payout) },
          { term: facts.voided ? 'Question' : 'Winning outcome', value: facts.voided ? 'Voided' : labels[facts.winningOutcome] },
        ],
        note: 'Shares come off the book, then into your position, then the payout is redeemed to your prediction vault. The last signature is the one that moves it to your wallet.',
        ...(block
          ? {
              blocker: {
                message: `Cancel your open sell order${block.orders === 1 ? '' : 's'} for this question first.`,
                detail: `${shares(block.shares)} share${block.shares === 1n ? '' : 's'} on ${block.outcomes
                  .map((side) => labels[side])
                  .join(' and ')} ${block.outcomes.length === 1 ? 'is' : 'are'} reserved by ${
                  block.orders === 1 ? 'a resting offer' : `${block.orders} resting offers`
                }. The book holds them, so the payout cannot read them. Release those orders and reopen this claim.`,
              },
            }
          : {}),
        plan: planClaimSteps(facts),
        run: async (w, b) => {
          const result = await claimProfilePayout(client.adapter, w, b, venue.collateralSymbol)
          setClaimed(result.paid > 0n)
          const moved = result.withdrawn.concat(result.imported).some((atoms) => atoms > 0n)
          return result.paid > 0n
            ? `${amount(result.paid)} ${venue.collateralSymbol} are in your wallet.`
            : moved
              ? 'Your shares were moved and the payout was redeemed, but the prediction vault was empty when the withdrawal ran. Reopen this claim to try the withdrawal again.'
              : 'This position had nothing left to claim.'
        },
      }
    }

    // A release and a seat-only withdrawal are the same run, minus the
    // cancellation. The seat balance the withdrawal takes is this order's
    // escrow plus whatever the seat already holds, because one signature takes
    // the whole balance rather than only this order's part of it.
    const held = row.holding.outcomes[outcome]
    const order = action.kind === 'cancel' ? action.row.order : null
    const side = order?.side ?? 'BUY'
    const buy = side === 'BUY'
    const seatAtoms = buy ? held.seatCollateral : held.seatShares
    const releasedAtoms = order && buy ? order.reserved : 0n
    const releasedShares = order && !buy ? order.quantity : 0n
    const returning = seatAtoms + releasedAtoms + releasedShares
    const asset = buy ? venue.collateralSymbol : 'shares'
    const seatOnly = !order
    return {
      headings: seatOnly
        ? { idle: 'Withdraw from your seat', running: 'Withdrawing your balance', stopped: 'Withdrawal stopped', done: 'Withdrawal finished' }
        : { idle: 'Release this order', running: 'Releasing your order', stopped: 'Release stopped', done: 'Release finished' },
      selection: `${seatOnly ? 'Withdraw' : 'Release'} · ${labels[outcome]}`,
      recap: [
        { term: 'Returns to wallet', value: `${amount(returning)} ${asset}` },
        ...(seatOnly
          ? [{ term: 'Held on', value: 'Venue seat' }]
          : [
              { term: 'Shares released', value: amount(order!.quantity) },
              { term: 'Order', value: `#${order!.sequence}` },
            ]),
      ],
      note: seatOnly
        ? 'This balance was credited to your seat by an earlier cancellation. One signature moves it to your wallet.'
        : 'Cancelling credits your venue seat. The second signature is what moves it to your wallet.',
      plan: planReleaseSteps({
        ...(order ? {} : { cancels: false }),
        side,
        collateralSymbol: venue.collateralSymbol,
        releasedAtoms,
        releasedShares,
        seatAtoms,
      }),
      run: async (w, b) => {
        if (!order) {
          const atoms = await withdrawProfileSeat(client.adapter, w, b, side, venue.collateralSymbol)
          return atoms > 0n
            ? `${amount(atoms)} ${asset} are back in your wallet.`
            : 'The seat was already empty. Balances refreshed.'
        }
        const result = await releaseProfileOrder(client.adapter, w, b, order, venue.collateralSymbol)
        return result.withdrawn > 0n
          ? `${amount(result.withdrawn)} ${asset} are back in your wallet.`
          : result.cancelled
            ? 'Order cancelled, but the seat held nothing to withdraw.'
            : 'This order had already left the book, and the seat was empty. Balances refreshed.'
      },
    }
  }, [action, venue.collateralSymbol, venue.collateralDecimals, vaultAtoms, outcome, client])

  const rows = useMemo(
    () => reconcileSteps(view.plan, liveSteps, settled),
    [view, liveSteps, settled],
  )

  // The wallet is built here rather than in a memo, and disposed in `finally`,
  // exactly as the trade ticket does. A memo keyed on the wallet port is
  // disposed whenever that port's identity changes, and the Dynamic SDK
  // republishes its port on a timer, on window focus and on visibilitychange —
  // which every wallet approval causes. That is what killed a claim between
  // signatures with "Network or wallet selection changed", and a claim is the
  // longest run in the app.
  const run = async () => {
    if (!connected || !port || !binding || busy || uncertain || view.blocker) return
    setBusy(true)
    // A retry starts its own rail. Keeping the previous run's rows would leave
    // the earlier failure sitting above the attempt that replaced it.
    setLiveSteps([])
    setSettled(false)
    setFailed(false)
    setMessage('Review the request in your wallet.')
    const wallet = new ManifestBrowserWallet(client.adapter, port, client, (stage) =>
      setLiveSteps((current) => applyStage(current, stage)),
    )
    try {
      setMessage(await view.run(wallet, binding))
    } catch (e) {
      const { message: text, raw } = readWalletError(e)
      setFailed(true)
      setMessage(text)
      // Against the raw text, not the translation: browser.ts builds this
      // sentence and the explorer link is recovered out of it.
      if (/Check transaction .* before retrying/.test(raw)) setUncertain(true)
    } finally {
      wallet.dispose()
      setSettled(true)
      // A run may have confirmed earlier steps before a later rejection.
      refresh()
      setBusy(false)
    }
  }

  return (
    <ProfileRunDialog
      open
      onClose={onClose}
      pending={busy}
      disabled={!connected || !binding || uncertain || claimed}
      title={action.row.identity.label}
      label={view.selection}
      headings={view.headings}
      recap={view.recap}
      note={view.note}
      {...(view.blocker ? { blocker: view.blocker } : {})}
      plan={view.plan}
      steps={rows}
      settled={settled}
      collateralSymbol={venue.collateralSymbol}
      collateralDecimals={venue.collateralDecimals}
      network={solanaClusterLabel(venue.chainId)}
      {...(failed && message
        ? { error: message }
        : !connected
          ? { error: 'Connect the profile owner’s wallet to continue.' }
          : message
            ? { status: message }
            : {})}
      explorerUrl={(signature) => explorerTxUrl(venue, signature)}
      onConfirm={() => void run()}
    />
  )
}
