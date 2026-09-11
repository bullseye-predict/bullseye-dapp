import { PRICE_SCALE, type Order, type SignedOrder } from '../../packages/prediction-core/types'
import { MAX_EXECUTION_CHILDREN, MAX_EXECUTION_MATCHES, type ExecutionPartialReason, type MarketExecution, type MarketExecutionChild, type MarketExecutionQuote, type MarketQuoteRequest } from '../../packages/prediction-core/execution'
import { activeOrders, availableQuantity, executableQuantity, quoteCeil } from './orderbook'
import { pendingSettlement, type PlannedSettlement } from './settlement'
import type { MatcherState } from './store'

export interface MarketExecutionRecord extends MarketExecution {
  /** Internal revocation flag; cancellation never changes a signed child payload. */
  cancelRequested: boolean
}

export const executionAccountKey = (venue: SignedOrder['venue'], account: string): string => venue === 'SOLANA' ? account : account.toLowerCase()

function min(left: bigint, right: bigint): bigint { return left < right ? left : right }
function max(left: bigint, right: bigint): bigint { return left > right ? left : right }

/** Walk actual maker orders rather than aggregated levels: per-fill rounding matters. */
export function quoteExecutionDepth(
  state: MatcherState,
  request: MarketQuoteRequest,
  timing: { id: string; now: number; expiresAt: number; orderExpiresAt: number },
): Omit<MarketExecutionQuote, 'childrenHash' | 'quoteHash'> {
  const market = state.market
  const opposing = activeOrders(state, request.outcomeId, request.side === 'BUY' ? 'SELL' : 'BUY', timing.now)
    .filter((order) => executionAccountKey(order.venue, order.maker) !== executionAccountKey(market.venue, request.account))
  const bestPrice = opposing[0]?.price ?? null
  const limitPrice = bestPrice === null ? null : request.side === 'BUY'
    ? min(PRICE_SCALE, bestPrice * BigInt(10_000 + request.slippageBps) / 10_000n)
    : max(1n, (bestPrice * BigInt(10_000 - request.slippageBps) + 9999n) / 10_000n)
  const children: MarketExecutionChild[] = []
  const partialReasons: ExecutionPartialReason[] = []
  let remainder = request.quantity
  let matches = 0
  for (const maker of opposing) {
    if (remainder === 0n) break
    if (limitPrice === null || (request.side === 'BUY' ? maker.price > limitPrice : maker.price < limitPrice)) {
      partialReasons.push('SLIPPAGE_LIMIT')
      break
    }
    const previous = children.at(-1)
    if (previous?.price !== maker.price && children.length >= MAX_EXECUTION_CHILDREN) {
      partialReasons.push('CHILD_LIMIT')
      break
    }
    // Child prices equal the quoted price level. SELL contracts execute at their
    // signed price, so separate children preserve actual bid-depth proceeds.
    const quantity = executableQuantity(min(remainder, availableQuantity(state, maker)), maker.price, maker.price)
    if (!quantity) { partialReasons.push('ROUNDING_DUST'); continue }
    if (matches >= MAX_EXECUTION_MATCHES) { partialReasons.push('MATCH_LIMIT'); break }
    matches += 1
    const collateral = quoteCeil(quantity, maker.price)
    if (previous?.price === maker.price) {
      previous.quantity += quantity
      previous.collateral += collateral
      previous.order.quantity += quantity
    } else {
      children.push({
        index: children.length, price: maker.price, quantity, collateral,
        order: {
          venue: market.venue, chainId: market.chainId, marketId: market.id, maker: request.account,
          outcomeId: request.outcomeId, side: request.side, price: maker.price, quantity, expiresAt: timing.orderExpiresAt,
        },
      })
    }
    remainder -= quantity
  }
  if (remainder > 0n) {
    if (!opposing.length) partialReasons.push('NO_LIQUIDITY')
    else if (!partialReasons.some((reason) => reason === 'SLIPPAGE_LIMIT' || reason === 'CHILD_LIMIT' || reason === 'MATCH_LIMIT')) partialReasons.push('INSUFFICIENT_DEPTH')
  }
  const executable = request.quantity - remainder
  const collateral = children.reduce((sum, child) => sum + child.collateral, 0n)
  return {
    id: timing.id, venue: market.venue, chainId: market.chainId, marketId: market.id,
    account: request.account, outcomeId: request.outcomeId, side: request.side, slippageBps: request.slippageBps,
    requestedQuantity: request.quantity, executableQuantity: executable, unfilledQuantity: remainder,
    estimatedCollateral: collateral, averagePrice: executable > 0n ? collateral * PRICE_SCALE / executable : null,
    bestPrice, limitPrice, createdAt: timing.now, expiresAt: timing.expiresAt, orderExpiresAt: timing.orderExpiresAt,
    children, partialReasons: remainder > 0n ? [...new Set(partialReasons)] : [], executionGuarantee: 'OFFCHAIN_IOC_ONLY',
  }
}

export function executionChildMatches(order: SignedOrder, child: MarketExecutionChild): boolean {
  const expected = child.order
  return order.venue === expected.venue && order.chainId === expected.chainId && order.marketId === expected.marketId &&
    executionAccountKey(order.venue, order.maker) === executionAccountKey(expected.venue, expected.maker) &&
    order.outcomeId === expected.outcomeId && order.side === expected.side && order.price === expected.price &&
    order.quantity === expected.quantity && order.expiresAt === expected.expiresAt
}

/** Cancelled IOC child remainders never enter activeOrders; only these pre-reserved plans may settle. */
export function executionChildMaySettle(state: MatcherState, order: Order, plan: PlannedSettlement, now: number): boolean {
  if (!plan.executionId || order.status !== 'CANCELLED' || order.expiresAt <= now) return false
  const execution = state.executions?.find((entry) => entry.id === plan.executionId)
  return !!execution && !execution.cancelRequested && execution.orderIds.includes(order.orderId) && execution.settlementIds.includes(plan.id)
}

export function executionView(record: MarketExecutionRecord): MarketExecution {
  const { cancelRequested: _, ...view } = record
  return structuredClone(view)
}

/** Recompute progress exclusively from confirmed and pending settlement records. */
export function refreshExecutions(state: MatcherState, now: number): void {
  for (const execution of state.executions ?? []) {
    const plans = state.settlements.filter((plan) => plan.executionId === execution.id)
    const pending = plans.filter((plan) => pendingSettlement(plan.status))
    const confirmed = plans.filter((plan) => plan.status === 'CONFIRMED')
    const failed = plans.filter((plan) => plan.status === 'FAILED' && !plan.cancelledBeforeSubmission)
    const cancelled = plans.filter((plan) => plan.cancelledBeforeSubmission)
    const pendingQuantity = pending.reduce((sum, plan) => sum + plan.quantity, 0n)
    const filledQuantity = confirmed.reduce((sum, plan) => sum + plan.quantity, 0n)
    const cancelledQuantity = execution.requestedQuantity - pendingQuantity - filledQuantity
    if (cancelledQuantity < 0n) throw new Error('Market execution conservation violation')
    const confirmedCollateral = confirmed.reduce((sum, plan) => sum + plan.collateral, 0n)
    const status: MarketExecution['status'] = pending.length
      ? pending.some((plan) => plan.status !== 'PLANNED') ? 'PENDING' : 'RESERVED'
      : filledQuantity === execution.requestedQuantity ? 'FILLED'
      : filledQuantity > 0n ? 'PARTIALLY_FILLED'
      : failed.length && !execution.cancelRequested ? 'FAILED' : 'CANCELLED'
    const partialReasons = [...execution.partialReasons]
    if ((execution.cancelRequested || cancelled.length) && cancelledQuantity > 0n) partialReasons.push('CANCELLED')
    if (failed.length && !execution.cancelRequested) {
      partialReasons.push('SETTLEMENT_FAILED')
      if (execution.orderIds.some((id) => state.orders.find((order) => order.orderId === id)!.expiresAt <= now)) partialReasons.push('ORDER_EXPIRED')
    }
    const reasons = [...new Set(partialReasons)]
    if (execution.status !== status || execution.pendingQuantity !== pendingQuantity || execution.filledQuantity !== filledQuantity ||
      execution.cancelledQuantity !== cancelledQuantity || execution.confirmedCollateral !== confirmedCollateral ||
      reasons.length !== execution.partialReasons.length) execution.updatedAt = now
    Object.assign(execution, { status, pendingQuantity, filledQuantity, cancelledQuantity, confirmedCollateral, partialReasons: reasons })
  }
}
