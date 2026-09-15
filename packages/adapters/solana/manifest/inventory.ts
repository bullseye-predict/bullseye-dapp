/**
 * Where a trader's outcome shares actually sit, and what has to move before they
 * can back a sell order.
 *
 * Manifest only matches against shares deposited in the book seat. The same
 * wallet can hold the same outcome in three other places at once, and a ticket
 * that shows the total while requiring the seat balance tells a trader they own
 * shares and then refuses to sell them:
 *
 *   venueAvailableClaims  seat        — ready to sell
 *   walletClaims          SPL account — one deposit away
 *   internalClaims        position PDA — one export, then a deposit
 *   venueReservedClaims   seat        — already committed to a resting ask
 *
 * Complete-set buys land in the position PDA, so on this venue `internalClaims`
 * is where a freshly bought outcome normally is: the common case needs two
 * transactions before the sell itself, not zero.
 */
export type ClaimCustody = {
  venueAvailableClaims: bigint
  venueReservedClaims: bigint
  walletClaims: bigint
  internalClaims: bigint
}

export type SellInventoryPlan = {
  /** Already on the seat; needs no transaction. */
  ready: bigint
  /** Move from the position PDA to the wallet's claim account. */
  exportAtoms: bigint
  /** Move from the wallet's claim account to the seat. Includes anything exported. */
  depositAtoms: bigint
  /** Shares the trader does not hold anywhere. Non-zero means the order cannot be backed. */
  shortfall: bigint
  /** Everything this wallet could sell after the moves above. */
  sellable: bigint
}

/**
 * The cheapest ordering of movements that backs `quantity` shares.
 *
 * Reserved claims are excluded on purpose: they are escrow for an ask that is
 * already resting, and spending them twice would oversell. Cancel that order
 * first to free them.
 */
export function planSellInventory(custody: ClaimCustody, quantity: bigint): SellInventoryPlan {
  if (quantity <= 0n) throw new RangeError('Sell quantity must be positive')
  const sellable = custody.venueAvailableClaims + custody.walletClaims + custody.internalClaims
  const ready = custody.venueAvailableClaims < quantity ? custody.venueAvailableClaims : quantity
  let outstanding = quantity - ready
  const fromWallet = custody.walletClaims < outstanding ? custody.walletClaims : outstanding
  outstanding -= fromWallet
  const exportAtoms = custody.internalClaims < outstanding ? custody.internalClaims : outstanding
  outstanding -= exportAtoms
  return { ready, exportAtoms, depositAtoms: fromWallet + exportAtoms, shortfall: outstanding, sellable }
}

type Level = { price: bigint; quantity: bigint }
const SCALE = 1_000_000n

/**
 * What a sell of `quantity` can match against the selected outcome's own bids,
 * down to `limit`. Mirrors nextBinaryBuy: a sell limit is a floor, so it fills
 * at the best bid rather than at the limit, and `price` is the worst level
 * consumed so a single order covers the whole walk.
 *
 * Deliberately direct-only. Selling YES through the NO book means buying NO and
 * merging a complete set, which is a different transaction shape with its own
 * collateral requirement; quoting it here would advertise a route this path
 * cannot execute.
 */
export function nextSell(bids: readonly Level[], quantity: bigint, limit: bigint) {
  if (quantity <= 0n) return null
  const ladder = bids
    .filter(row => row.quantity > 0n && row.price > 0n && row.price < SCALE && row.price >= limit)
    .slice()
    .sort((a, b) => a.price > b.price ? -1 : a.price < b.price ? 1 : 0)
  let filled = 0n, worst = 0n
  for (const row of ladder) {
    const take = row.quantity < quantity - filled ? row.quantity : quantity - filled
    filled += take
    worst = row.price
    if (filled === quantity) break
  }
  return filled ? { quantity: filled, price: worst, estimatedProceeds: filled * worst / SCALE } : null
}

export type OwnedLevel = Level & { own: boolean }

/**
 * The sell quote against everyone else's bids, plus the trader's own bid that
 * would swallow it.
 *
 * Manifest fills a crossing order against the trader's own resting bid rather
 * than skipping it, so an offer priced at or below that bid executes at the
 * maker's price instead of resting. The guard then rejects the whole
 * transaction, because the fee it charges on that unexpected volume exceeds the
 * maxFeeAtoms quoted for an offer nobody expected to fill.
 *
 * `crossing` is the highest own bid at or above the price this order would
 * actually be submitted at — the one to cancel. It is measured against that
 * submitted price, not the limit the trader typed: an IOC priced at the worst
 * external level still consumes every better bid on the way down, own ones
 * included.
 */
export function quoteSell(resting: readonly OwnedLevel[], quantity: bigint, limit: bigint) {
  const match = nextSell(resting.filter(row => !row.own), quantity, limit)
  const submitted = match ? match.price : limit
  const crossing = resting
    .filter(row => row.own && row.quantity > 0n && row.price >= submitted)
    .reduce<bigint | undefined>((best, row) => best === undefined || row.price > best ? row.price : best, undefined)
  return { match, crossing }
}
