import type { ManifestAdapter } from '../../../packages/adapters/solana/manifest/adapter'
import type { ManifestBrowserWallet } from '../../../packages/adapters/solana/manifest/browser'
import type { ManifestBinding } from '../../../packages/adapters/solana/manifest/wire'
/** Recheck the exact owner/order immediately before constructing cancellation. */
export async function cancelProfileOrder(
  adapter: ManifestAdapter,
  wallet: ManifestBrowserWallet,
  binding: ManifestBinding,
  sequence: string,
) {
  const book = await adapter.readBook(binding)
  const exists = [...book.bids(), ...book.asks()].some(
    (order) =>
      order.trader.equals(wallet.owner) &&
      order.sequenceNumber.toString() === sequence,
  )
  if (!exists) return { status: 'already-closed' as const }
  const signature = await wallet.send(
    await adapter.cancel(wallet.owner, binding, [BigInt(sequence)]),
    'Cancel selected order',
  )
  return { status: 'confirmed' as const, signature }
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
