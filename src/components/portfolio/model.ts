export type PositionState = 'Trading' | 'Awaiting result' | 'Claim winnings' | 'Claim refund' | 'Lost' | 'Closed' | 'Orders'
export function positionState(market: { isResolved: boolean; isVoided: boolean; winningOutcome: number; status: number }, outcome: 0 | 1, quantity: bigint, now: number, starts: number, locks: number): PositionState {
  if (quantity === 0n) return 'Closed'
  if (market.isVoided) return 'Claim refund'
  if (market.isResolved) return market.winningOutcome === outcome ? 'Claim winnings' : 'Lost'
  return market.status === 1 && now >= starts && now < locks ? 'Trading' : 'Awaiting result'
}
export const isClosedPosition = (state: PositionState) => state === 'Lost' || state === 'Closed'

export function marketLifecycle(market: { isResolved: boolean; isVoided: boolean; winningOutcome: number }, now: number, locks: number) {
  if (market.isVoided) return 'Voided'
  if (market.isResolved) return `Resolved · ${market.winningOutcome === 0 ? 'YES' : 'NO'} won`
  return now >= locks ? 'Trading ended · awaiting oracle' : 'Trading open'
}
