import type { ReservedSolanaQuestion } from '../home/solanaQuestionMarkets'
import { isClosedPosition, marketLifecycle, positionState, type PositionState } from './model'
import type { ManifestOutcomeHolding, ManifestPortfolio, ManifestQuestionHolding, ManifestRestingOrder } from './solanaPortfolio'

/** How a question is named on screen. The live catalogue supplies it while the
 *  question is open; a question the trader still holds after its event rolled
 *  out of the catalogue is named by its own on-chain address instead of being
 *  dropped from the portfolio. */
export type SolanaIdentity = {
  marketId: string
  label: string
  outcomeLabels: [string, string]
  /** Present only while the catalogue still lists the question. */
  eventId?: string
  questionId?: string
  scheduledStartAt?: string
  listed: boolean
}

const shortId = (marketId: string) => `${marketId.slice(0, 4)}…${marketId.slice(-4)}`

export function solanaIdentity(marketId: string, question?: ReservedSolanaQuestion): SolanaIdentity {
  if (!question) return { marketId, label: `Question ${shortId(marketId)}`, outcomeLabels: ['YES', 'NO'], listed: false }
  const [yes = 'YES', no = 'NO'] = question.outcomes
  return { marketId, label: question.label, outcomeLabels: [yes, no], eventId: question.eventId, questionId: question.questionId, scheduledStartAt: question.scheduledStartAt, listed: true }
}

/** Where a row's shares sit, in the order a trader has to move them to exit. */
export type SolanaCustody = { wallet: bigint; seat: bigint; reserved: bigint; vault: bigint }

export type SolanaPositionRow = {
  id: string
  identity: SolanaIdentity
  holding: ManifestQuestionHolding
  outcome: 0 | 1
  /** Every share this trader controls for the outcome, across all three custodians. */
  quantity: bigint
  custody: SolanaCustody
  state: PositionState
  lifecycle: string
  bestBid?: bigint
  bestAsk?: bigint
  /** Marked at the best bid, which is what the shares could actually be sold into. */
  value?: bigint
  /** Collateral sitting unused on this book's venue seat. */
  seatCollateral: bigint
  quoteVolume: bigint
}

export type SolanaOrderRow = {
  id: string
  identity: SolanaIdentity
  holding: ManifestQuestionHolding
  outcome: 0 | 1
  order: ManifestRestingOrder
  lifecycle: string
  /** Trading has closed, so the order can no longer fill and only releases escrow. */
  expired: boolean
}

const lifecycleOf = (holding: ManifestQuestionHolding, now: number) =>
  holding.opened
    ? marketLifecycle({ isResolved: holding.status === 3, isVoided: holding.status === 4, winningOutcome: holding.winningOutcome }, now, holding.locksAt)
    : 'Not opened on chain'

export const solanaPositionState = (holding: ManifestQuestionHolding, outcome: 0 | 1, quantity: bigint, now: number): PositionState =>
  positionState({ isResolved: holding.status === 3, isVoided: holding.status === 4, winningOutcome: holding.winningOutcome, status: holding.status }, outcome, quantity, now, holding.startsAt, holding.locksAt)

/** Shares marked at the price they could be sold into right now. */
export const markToBid = (quantity: bigint, bestBid: bigint | undefined, decimals: number) =>
  bestBid === undefined ? undefined : quantity * bestBid / 10n ** BigInt(decimals)

const custodyOf = (outcome: ManifestOutcomeHolding): SolanaCustody => ({ wallet: outcome.walletShares, seat: outcome.seatShares, reserved: outcome.reservedShares, vault: outcome.vaultShares })
const identities = (questions: readonly ReservedSolanaQuestion[]) => new Map(questions.map(question => [question.marketId, question]))

/**
 * One row per outcome this trader has any stake in.
 *
 * A row is kept for an outcome the trader has fully exited — matched volume on
 * the seat proves the position existed — so a closed trade is not silently
 * dropped the way an unheld outcome is.
 */
export function solanaPositionRows(portfolio: ManifestPortfolio, questions: readonly ReservedSolanaQuestion[], decimals: number): SolanaPositionRow[] {
  const byMarket = identities(questions)
  return portfolio.questions.flatMap(holding => {
    const identity = solanaIdentity(holding.marketId, byMarket.get(holding.marketId))
    const lifecycle = lifecycleOf(holding, portfolio.now)
    return ([0, 1] as const).flatMap<SolanaPositionRow>(outcome => {
      const side = holding.outcomes[outcome]
      const quantity = side.totalShares
      if (quantity === 0n && side.seatCollateral === 0n && side.quoteVolume === 0n) return []
      return [{
        id: `${holding.marketId}:${outcome}`, identity, holding, outcome, quantity,
        custody: custodyOf(side),
        state: solanaPositionState(holding, outcome, quantity, portfolio.now),
        lifecycle, bestBid: side.bestBid, bestAsk: side.bestAsk,
        value: markToBid(quantity, side.bestBid, decimals),
        seatCollateral: side.seatCollateral, quoteVolume: side.quoteVolume,
      }]
    })
  })
}

/** One row per resting order, because each is cancelled on its own. */
export function solanaOrderRows(portfolio: ManifestPortfolio, questions: readonly ReservedSolanaQuestion[]): SolanaOrderRow[] {
  const byMarket = identities(questions)
  return portfolio.questions.flatMap(holding => {
    const identity = solanaIdentity(holding.marketId, byMarket.get(holding.marketId))
    const lifecycle = lifecycleOf(holding, portfolio.now)
    const expired = portfolio.now >= holding.locksAt || holding.status >= 2
    return ([0, 1] as const).flatMap(outcome => holding.outcomes[outcome].orders.map(order => ({
      id: `${holding.marketId}:${outcome}:${order.sequence}`, identity, holding, outcome: outcome as 0 | 1, order, lifecycle, expired,
    })))
  })
}

/** Collateral the trader can still act on, split by who is holding it. */
export function solanaCollateral(portfolio: ManifestPortfolio) {
  let seat = 0n, reserved = 0n
  for (const holding of portfolio.questions) for (const outcome of holding.outcomes) {
    seat += outcome.seatCollateral
    reserved += outcome.reservedCollateral
  }
  return { wallet: portfolio.walletCollateral, vault: portfolio.vaultCollateral, seat, reserved, total: portfolio.walletCollateral + portfolio.vaultCollateral + seat + reserved }
}

export const activeSolanaRows = (rows: readonly SolanaPositionRow[]) => rows.filter(row => !isClosedPosition(row.state))
export const closedSolanaRows = (rows: readonly SolanaPositionRow[]) => rows.filter(row => isClosedPosition(row.state))
export const claimableSolanaRows = (rows: readonly SolanaPositionRow[]) => rows.filter(row => row.state.startsWith('Claim'))

/** The events the filter lists, newest first, from whatever is listed. */
export function solanaEvents(rows: readonly { identity: SolanaIdentity }[], questions: readonly ReservedSolanaQuestion[]) {
  const listed = new Map<string, number>()
  for (const question of questions) listed.set(question.eventId, Date.parse(question.scheduledStartAt) || 0)
  for (const row of rows) if (row.identity.eventId && !listed.has(row.identity.eventId)) listed.set(row.identity.eventId, Date.parse(row.identity.scheduledStartAt ?? '') || 0)
  return [...listed.entries()].sort((left, right) => right[1] - left[1]).map(([eventId, startedAt]) => ({ eventId, startedAt }))
}

export const solanaRowKickoff = (identity: SolanaIdentity) => Date.parse(identity.scheduledStartAt ?? '') || 0
export const solanaRowMatches = (identity: SolanaIdentity, eventFilter: string, search: string) =>
  (!eventFilter || identity.eventId === eventFilter)
  && `${identity.label} ${identity.eventId ?? ''} ${identity.marketId}`.toLowerCase().includes(search.toLowerCase())

/** One line of the Active tab. A resting order is active — it is escrow the
 *  trader can still act on — but its shares are not a second holding: a resting
 *  ask's quantity is already inside its position's `quantity` (solanaPortfolio
 *  sums `reservedShares` into `totalShares`), and a resting bid owns no shares
 *  at all. `grouped` records whether the position it qualifies is the row above. */
export type SolanaActiveRow =
  | { kind: 'position'; key: string; row: SolanaPositionRow }
  | { kind: 'order'; key: string; row: SolanaOrderRow; grouped: boolean }

export function mergeSolanaActive(positions: readonly SolanaPositionRow[], orders: readonly SolanaOrderRow[]): SolanaActiveRow[] {
  const pending = new Map<string, SolanaOrderRow[]>()
  for (const order of orders) {
    const key = `${order.identity.marketId}:${order.outcome}`
    pending.set(key, [...(pending.get(key) ?? []), order])
  }
  const merged: SolanaActiveRow[] = []
  for (const row of positions) {
    merged.push({ kind: 'position', key: row.id, row })
    for (const order of pending.get(row.id) ?? []) merged.push({ kind: 'order', key: order.id, row: order, grouped: true })
    pending.delete(row.id)
  }
  // A trader whose only stake is a resting bid has no position row at all, so
  // this pass is what keeps their escrowed collateral on the page rather than
  // showing them an empty portfolio.
  for (const list of pending.values()) for (const order of list) merged.push({ kind: 'order', key: order.id, row: order, grouped: false })
  return merged
}

/** Positions marked at the best bid. Orders are never added: an ask's shares are
 *  already counted in its position and a bid's shares are not owned yet. A book
 *  with no bid is not worth zero, so one unpriced row withholds the whole total
 *  rather than under-reporting it. */
export function markedValue(rows: readonly SolanaPositionRow[]) {
  let total = 0n, unpriced = 0
  for (const row of rows) {
    if (row.quantity === 0n) continue
    if (row.value === undefined) unpriced++
    else total += row.value
  }
  return { total: unpriced ? undefined : total, unpriced, priced: rows.filter(row => row.quantity > 0n).length - unpriced }
}
