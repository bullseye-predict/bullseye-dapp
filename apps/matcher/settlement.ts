import type { SignedOrder, VenueId } from '../../packages/prediction-core/types'

export interface MarketScope {
  venue: VenueId
  chainId: string
  marketId: string
}

export type SettlementStatus = 'PLANNED' | 'SUBMITTING' | 'PENDING' | 'AMBIGUOUS' | 'CONFIRMED' | 'FAILED'

export interface PlannedSettlement extends MarketScope {
  id: string
  buy: SignedOrder
  sell: SignedOrder
  price: bigint
  quantity: bigint
  collateral: bigint
  status: SettlementStatus
  createdAt: number
  updatedAt: number
  txHash?: string
  failure?: string
  /** Present only for an atomically reserved off-chain market execution child. */
  executionId?: string
  /** Distinguishes authenticated off-chain cancellation from a reverted chain fill. */
  cancelledBeforeSubmission?: boolean
}

/** A confirmed receipt must be checked for the exact plan by the chain adapter. */
export type SettlementReceipt =
  | { status: 'CONFIRMED'; txHash: string; confirmedAt: number }
  | { status: 'PENDING'; txHash: string }
  | { status: 'FAILED'; reason: string; txHash?: string }
  | { status: 'UNKNOWN'; txHash?: string }

/**
 * The transport owns RPC, transaction construction and restricted settlement signing.
 * submit's plan.id is the durable idempotency key. lookup must recover broadcasts by
 * that key after process failure, including when no tx hash reached this process.
 * FAILED is safe only when the transport can prove the transaction cannot execute.
 */
export interface SettlementTransport {
  submit(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt>
  lookup(plan: Readonly<PlannedSettlement>): Promise<SettlementReceipt>
}

export const pendingSettlement = (status: SettlementStatus): boolean =>
  status === 'PLANNED' || status === 'SUBMITTING' || status === 'PENDING' || status === 'AMBIGUOUS'

export const marketScopeKey = (scope: MarketScope): string =>
  JSON.stringify([scope.venue, scope.chainId, scope.marketId])
