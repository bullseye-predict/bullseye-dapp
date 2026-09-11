import { quoteBinaryStakeOverBook, quoteBinarySellOverBook, quoteBinaryOrderOverBook, type BinaryOrderBook, type BinarySide, type OnchainOrder, type OrderFill } from '@somnia-chain/markets-sdk'

export type OrderInput = { side: BinarySide; outcomePrice: bigint; quantity: bigint; orderType: 0 | 2 | 3 }
export type OrderProgress = { stage: 'approval' | 'approval-confirmed' | 'order'; hash?: `0x${string}` }
export type OrderExecution = { hash: `0x${string}`; filled: bigint; resting: bigint; cancelled: bigint; collateral: bigint; side: BinarySide }

export function executionSummary(input: OrderInput, hash: `0x${string}`, fills: Pick<OrderFill, 'quantityFilled' | 'fillPrice'>[], decimals: number): OrderExecution {
  const scale = 10n ** BigInt(decimals)
  const filled = fills.reduce((sum, fill) => sum + fill.quantityFilled, 0n)
  const remainder = input.quantity > filled ? input.quantity - filled : 0n
  const collateral = fills.reduce((sum, fill) => sum + fill.quantityFilled * (input.side.endsWith('NO') ? scale - fill.fillPrice : fill.fillPrice) / scale, 0n)
  return { hash, side: input.side, filled, collateral, resting: input.orderType === 2 ? 0n : remainder, cancelled: input.orderType === 2 ? remainder : 0n }
}

/** Both YES buys and NO sells are bids in the shared YES-price book. */
export function selfMatchingOrders(orders: OnchainOrder[], input: OrderInput, decimals: number, now: number) {
  const yesPrice = input.side.endsWith('NO') ? 10n ** BigInt(decimals) - input.outcomePrice : input.outcomePrice
  const bid = input.side === 'BUY_YES' || input.side === 'SELL_NO'
  return orders.filter(order => order.quantityRemaining > 0n && order.expireTimestampNs > BigInt(now) * 1_000_000n && order.isBid !== bid && (bid ? order.price <= yesPrice : order.price >= yesPrice))
}

/** Quote against available depth with zero extra slippage; never exceed the entered budget. */
export function marketOrderQuote(book: BinaryOrderBook, side: BinarySide, amount: bigint, decimals: number, grid: { tickSize: bigint; lotSize: bigint; minQuantity: bigint }) {
  const scale = 10n ** BigInt(decimals)
  const params = { ...grid, slippageBps: 0n, slippageMinTicks: 0n }
  if (side === 'BUY_YES' || side === 'BUY_NO') {
    const quote = quoteBinaryStakeOverBook(book, side, amount, scale, params)
    if (!quote) return null
    const estimate = quoteBinaryOrderOverBook(book, side, quote.quantity, scale)
    return { input: { side, outcomePrice: quote.limitPrice, quantity: quote.quantity, orderType: 2 as const }, filled: estimate.filledQuantity, cost: estimate.cost, avgPrice: estimate.avgPrice, maxCost: quote.escrow }
  }
  const quote = quoteBinarySellOverBook(book, side, amount, scale, params)
  if (!quote) return null
  return { input: { side, outcomePrice: quote.limitPrice, quantity: quote.quantity, orderType: 2 as const }, filled: quote.fillableQuantity, cost: quote.estProceeds, avgPrice: quote.fillableQuantity ? quote.estProceeds * scale / quote.fillableQuantity : 0n, maxCost: 0n }
}
