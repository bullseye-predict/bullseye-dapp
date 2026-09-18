import { Transaction } from '@solana/web3.js'
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, unpackAccount } from '@solana/spl-token'
import { TOKEN_PROGRAM_ID, moveVaultCollateral, vaultAddress, vaultCollateralAddress } from '../../../packages/adapters/solana/wire'
import type { ManifestAdapter } from '../../../packages/adapters/solana/manifest/adapter'
import type { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import { TRADE_STEPS } from '../../../packages/adapters/solana/manifest/steps'
import type { ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'

export type ReleaseOutcome = {
  /** False when the order had already left the book, which is not a failure:
   *  the withdrawal still runs, and that is how a trader who cancelled before
   *  this flow existed gets their money out. */
  cancelled: boolean
  /** Atoms actually withdrawn. Zero means the seat was already empty. */
  withdrawn: bigint
}

/**
 * Cancel a resting order AND take the proceeds off the seat.
 *
 * Manifest's cancellation moves no tokens: it credits the trader's seat inside
 * the market account. Stopping there left a confirmed transaction, an unchanged
 * wallet balance and nothing on screen to connect the two. These are two
 * signatures because they are two transactions, and both are named with a
 * TRADE_STEPS label so the stepper can render them as a run.
 *
 * The seat is re-read between them rather than predicted: another client may
 * have swept it, and withdrawing a figure that is no longer there would fail
 * the second transaction after the first had already been approved.
 */
export async function releaseProfileOrder(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  binding: ManifestBinding,
  order: { sequence: string; side: 'BUY' | 'SELL' },
  collateralSymbol: string,
): Promise<ReleaseOutcome> {
  const book = await adapter.readBook(binding)
  const resting = [...book.bids(), ...book.asks()].some(
    (entry) =>
      entry.trader.equals(wallet.owner) &&
      entry.sequenceNumber.toString() === order.sequence,
  )
  if (resting)
    await wallet.send(
      await adapter.cancel(wallet.owner, binding, [BigInt(order.sequence)]),
      TRADE_STEPS.cancelOrder,
    )
  return {
    cancelled: resting,
    withdrawn: await withdrawProfileSeat(adapter, wallet, binding, order.side, collateralSymbol),
  }
}

/**
 * Take a seat balance to the wallet, with no order involved.
 *
 * This is the other half of the same problem. An order cancelled before the
 * release flow existed left its collateral on the seat and then vanished from
 * the book, taking its own Release button with it — the balance was visible in
 * Positions and reachable from nowhere. A seat balance is withdrawable on its
 * own, on a locked question as much as a live one, so it gets its own entry
 * point rather than requiring an order to hang off.
 */
export async function withdrawProfileSeat(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  binding: ManifestBinding,
  side: 'BUY' | 'SELL',
  collateralSymbol: string,
): Promise<bigint> {
  const holdings = await adapter.holdings(wallet.owner, binding)
  const buy = side === 'BUY'
  const atoms = buy ? holdings.venueAvailableUsdc : holdings.venueAvailableClaims
  if (atoms <= 0n) return 0n
  await wallet.send(
    await adapter.moveTokens(wallet.owner, binding, buy ? 'USDC' : 'claims', atoms, 'withdraw'),
    buy ? TRADE_STEPS.withdrawSeat(collateralSymbol) : TRADE_STEPS.withdrawShares,
  )
  return atoms
}
/** A prepared wallet can own shares in several places; only unreserved venue
 * inventory can back this order. Never silently sell a different amount. */
export async function submitProfileSale(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  binding: ManifestBinding,
  input: Parameters<ManifestAdapter['order']>[2],
) {
  if (input.side !== 'SELL')
    throw new Error('A profile sale must sell the selected outcome.')
  const holdings = await adapter.holdings(wallet.owner, binding)
  if (input.quantity > holdings.venueAvailableClaims)
    throw new Error(
      'Move shares to the order book first, or reduce the quantity. Reserved shares must be cancelled before selling.',
    )
  return wallet.send(
    await adapter.order(wallet.owner, binding, input),
    'Sell shares',
  )
}

/**
 * Take the prediction vault's collateral to the wallet.
 *
 * `redeem` pays a settled position into the shared prediction vault, never into
 * the wallet, so a claim that stops at the redeem leaves the money one
 * signature short of the trader. That last signature had no entry point outside
 * the debug terminal.
 *
 * The vault is per-wallet and names no market, so this needs no question, no
 * binding and no position row — which is the point, because the row that paid
 * into the vault is already gone by the time a trader looks for their money.
 *
 * The balance is re-read rather than taken from the polled portfolio: a figure
 * that is thirty seconds old fails the transaction after the prompt has already
 * been approved.
 */
export async function withdrawVaultCollateral(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  collateralSymbol: string,
): Promise<bigint> {
  const { predictionProgram, collateralMint } = adapter.deployment
  const escrow = vaultCollateralAddress(predictionProgram, vaultAddress(predictionProgram, wallet.owner))
  const info = await adapter.connection.getAccountInfo(escrow)
  if (!info) return 0n
  const atoms = unpackAccount(escrow, info, TOKEN_PROGRAM_ID).amount
  if (atoms <= 0n) return 0n
  const destination = getAssociatedTokenAddressSync(collateralMint, wallet.owner)
  // A trader who has never held this collateral in their own wallet has no
  // account for it to land in, and the withdrawal would fail on the last hop.
  const tx = new Transaction()
    .add(createAssociatedTokenAccountIdempotentInstruction(wallet.owner, destination, wallet.owner, collateralMint))
    .add(moveVaultCollateral(predictionProgram, wallet.owner, destination, atoms, 'withdraw'))
  await wallet.send(tx, TRADE_STEPS.withdrawVault(collateralSymbol))
  return atoms
}

export type ClaimOutcome = {
  /** Shares taken off each book's seat, indexed by outcome. */
  withdrawn: [bigint, bigint]
  /** Shares moved from the wallet claim account into the position. */
  imported: [bigint, bigint]
  /** The redeem was signed and confirmed. */
  redeemed: boolean
  /** Collateral atoms that actually reached the wallet. Zero means the vault
   *  held nothing when the withdrawal ran, which is not the same as a paid
   *  claim and must not latch the button. */
  paid: bigint
}

/**
 * A settled payout, from wherever the shares sit to the trader's own wallet.
 *
 * This used to be two buttons in a side panel with nothing connecting them, and
 * the second one paid into the shared prediction vault and said so in a line of
 * text under itself. A trader who read that line still had no way to reach the
 * money: the signature that moves a vault balance lives on a different control
 * in a different part of the page. Every step is in one run here for that
 * reason — the last one is the only one that changes the balance being watched.
 *
 * Two corrections to the old panel are folded in:
 *
 * - prepare() is hoisted and runs PER OUTCOME. It derives the claim account
 *   from one binding's mint, and the old panel called it once for the outcome
 *   the trader clicked while the loop below then sent transactions for both
 *   sides. A trader holding shares on the other side got a failure after having
 *   already approved earlier prompts.
 * - The claim account is read directly instead of re-running holdings(), which
 *   the old panel did unconditionally even when it had just sent nothing. One
 *   request instead of four, per side.
 */
export async function claimProfilePayout(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  binding: ManifestBinding,
  collateralSymbol: string,
): Promise<ClaimOutcome> {
  const other: 0 | 1 = binding.outcome === 0 ? 1 : 0
  const bindings: [ManifestBinding, ManifestBinding] =
    binding.outcome === 0
      ? [binding, await adapter.binding(binding.question, other)]
      : [await adapter.binding(binding.question, other), binding]

  const custody = await Promise.all(bindings.map(b => adapter.holdings(wallet.owner, b)))

  // Belt and braces. The dialog blocks on this before the first prompt, from the
  // polled row; this covers the thirty-second window in which an ask was placed
  // between that poll and this click.
  if (custody.some(h => h.venueReservedClaims > 0n))
    throw new Error('Cancel open sell orders for this question before claiming.')

  const sides = ([0, 1] as const).filter(
    outcome => custody[outcome]!.venueAvailableClaims > 0n || custody[outcome]!.walletClaims > 0n,
  )

  for (const outcome of sides) await wallet.prepare(bindings[outcome])

  const withdrawn: [bigint, bigint] = [0n, 0n]
  for (const outcome of sides) {
    const atoms = custody[outcome]!.venueAvailableClaims
    if (atoms <= 0n) continue
    await wallet.send(
      await adapter.moveTokens(wallet.owner, bindings[outcome], 'claims', atoms, 'withdraw'),
      TRADE_STEPS.withdrawClaims(outcome),
    )
    withdrawn[outcome] = atoms
  }

  const imported: [bigint, bigint] = [0n, 0n]
  for (const outcome of sides) {
    const b = bindings[outcome]
    const account = getAssociatedTokenAddressSync(b.mint, wallet.owner)
    const info = await adapter.connection.getAccountInfo(account)
    const atoms = info ? unpackAccount(account, info, TOKEN_PROGRAM_ID).amount : 0n
    if (atoms <= 0n) continue
    await wallet.claims(b, atoms, 'import', TRADE_STEPS.importClaims(outcome))
    imported[outcome] = atoms
  }

  await wallet.collateral(binding, 'redeem', undefined, TRADE_STEPS.redeem)

  return {
    withdrawn,
    imported,
    redeemed: true,
    paid: await withdrawVaultCollateral(adapter, wallet, collateralSymbol),
  }
}
