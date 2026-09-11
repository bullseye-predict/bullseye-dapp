import type { MatchTelemetry, Order, OrderResult, PlaceOrderInput, TxResult } from '../../packages/prediction-core/types'
import type { PredictionVenue } from '../../packages/venue-interface/PredictionVenue'
import { parseHermesAction, RiskEngine, type HermesAction, type RiskSnapshot } from '../../packages/risk-engine'
import { emptyExecutionState, type ExecutionJournalState, type ExecutionScope, type HermesExecutionJournal, type PendingExecution } from './execution-journal'

export interface TelemetrySource { getLiveMatch(matchId: string): Promise<MatchTelemetry> }
export interface TradingToolsOptions {
  venue: PredictionVenue
  marketId: string
  matchId: string
  telemetry: TelemetrySource
  risk: RiskEngine
  journal: HermesExecutionJournal
  now?: () => number
}

export type ActionExecution =
  | { action: 'HOLD'; status: 'HELD' }
  | { action: 'BUY' | 'SELL'; status: 'EXECUTED'; executionId: string; result: OrderResult }
  | { action: 'CANCEL' | 'CANCEL_ALL'; status: 'CANCEL_REQUESTED'; result: TxResult }

export class RiskRejectedError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RiskRejectedError' }
}

/** Account/market identity is bound by the host and cannot be supplied by model output. */
export class HermesTradingTools {
  readonly risk: RiskEngine
  readonly marketId: string
  readonly matchId: string
  readonly scope: Readonly<ExecutionScope>
  private readonly venue: PredictionVenue
  private readonly telemetry: TelemetrySource
  private readonly journal: HermesExecutionJournal
  private readonly now: () => number
  private enabled = true

  constructor(options: TradingToolsOptions) {
    if (!options.marketId || !options.matchId || !options.venue.account) throw new Error('Hermes requires a bound market and account')
    this.venue = options.venue
    this.marketId = options.marketId
    this.matchId = options.matchId
    this.telemetry = options.telemetry
    this.risk = options.risk
    this.journal = options.journal
    this.now = options.now ?? Date.now
    this.scope = Object.freeze({ account: options.venue.account, venue: options.venue.venue, chainId: options.venue.chainId })
  }

  async getLiveMatch() { return this.telemetry.getLiveMatch(this.matchId) }
  async getMarket() { return this.venue.getMarket(this.marketId) }
  async getOrderBook() { return this.venue.getOrderBook(this.marketId) }
  async getPositions() { return (await this.venue.getPositions(this.scope.account)).filter((position) => position.marketId === this.marketId) }
  async getOpenOrders() { return this.venue.getOpenOrders(this.scope.account, this.marketId) }
  async getBalance() { return this.venue.getBalance(this.scope.account) }

  async getSnapshot(): Promise<RiskSnapshot> {
    return (await this.loadSnapshot()).snapshot
  }

  async hasPendingSubmissions(): Promise<boolean> {
    const state = await this.journal.read(this.scope)
    return state?.entries.some((entry) => entry.status === 'SUBMITTING' || entry.status === 'UNKNOWN') ?? false
  }

  /** Synchronous revocation discards any in-flight reasoning response before execution. */
  revokeLocally(): void { this.enabled = false }

  async disable(): Promise<void> {
    this.revokeLocally()
    await this.journal.transaction(this.scope, (existing) => {
      const state = existing ?? emptyExecutionState()
      state.enabled = false
      state.revision += 1
      return { state, result: undefined }
    })
  }

  async execute(output: unknown): Promise<ActionExecution> {
    const action = parseHermesAction(output)
    this.assertVenueScope()
    if (action.action === 'CANCEL_ALL') {
      return { action: 'CANCEL_ALL', status: 'CANCEL_REQUESTED', result: this.cancellationResult(await this.venue.cancelAllOrders(this.marketId)) }
    }
    if (action.action === 'CANCEL') return this.cancelScoped(action)
    if (!this.enabled) throw new RiskRejectedError('AGENT_STOPPED', 'Agent trading is disabled')
    const { snapshot, journalState } = await this.loadSnapshot()
    if (!journalState.enabled) throw new RiskRejectedError('AGENT_STOPPED', 'Agent trading is disabled')
    if (journalState.entries.some((entry) => entry.status === 'UNKNOWN' || entry.status === 'SUBMITTING')) {
      throw new RiskRejectedError('PENDING_EXECUTION', 'An unconfirmed execution requires reconciliation before more orders')
    }
    const decision = this.risk.evaluate(action, snapshot)
    if (!decision.allowed) throw new RiskRejectedError(decision.code, decision.message)
    if (action.action === 'HOLD') return { action: 'HOLD', status: 'HELD' }
    const input: PlaceOrderInput = {
      marketId: this.marketId, outcomeId: action.outcomeId, side: action.action,
      price: action.limitPrice, quantity: action.amount, expiresAt: action.expiresAt,
    }
    const entry = await this.journal.transaction(this.scope, (existing) => {
      const state = existing ?? emptyExecutionState()
      if (!this.enabled || !state.enabled) throw new RiskRejectedError('AGENT_STOPPED', 'Agent trading is disabled')
      if (state.revision !== journalState.revision) throw new RiskRejectedError('EXECUTION_RACE', 'Account state changed; a fresh evaluation is required')
      const pending: PendingExecution = {
        id: JSON.stringify([this.scope.venue, this.scope.chainId, this.scope.account, state.nextSequence++]),
        input, createdAt: this.now(), status: 'SUBMITTING',
      }
      state.entries.push(pending)
      state.revision += 1
      return { state, result: pending }
    })
    // Revocation during a persistent journal write must still stop the broadcast.
    if (!this.enabled) {
      await this.journal.transaction(this.scope, (existing) => {
        const state = existing ?? emptyExecutionState()
        state.entries = state.entries.filter((item) => item.id !== entry.id)
        state.revision += 1
        return { state, result: undefined }
      })
      throw new RiskRejectedError('AGENT_STOPPED', 'Agent stopped before order submission')
    }
    try {
      this.assertVenueScope()
      const result = await this.venue.placeOrder(input)
      if (!result.orderId || !['OPEN', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED'].includes(result.status)) throw new Error('Invalid venue order acknowledgement')
      await this.updateExecution(entry.id, 'ACCEPTED', result.orderId)
      return { action: action.action, status: 'EXECUTED', executionId: entry.id, result }
    } catch (error) {
      await this.updateExecution(entry.id, 'UNKNOWN')
      throw error
    }
  }

  private async cancelScoped(action: Extract<HermesAction, { action: 'CANCEL' }>): Promise<ActionExecution> {
    const openOrders = await this.venue.getOpenOrders(this.scope.account, this.marketId)
    const order = openOrders.find((entry) => entry.orderId === action.orderId)
    const normalized = (account: string) => this.scope.venue === 'SOLANA' ? account : account.toLowerCase()
    if (!order || order.marketId !== this.marketId || order.venue !== this.scope.venue || order.chainId !== this.scope.chainId ||
      normalized(order.maker) !== normalized(this.scope.account)) throw new RiskRejectedError('ORDER_SCOPE', 'Cancellation is outside the bound account/market')
    this.assertVenueScope()
    return { action: 'CANCEL', status: 'CANCEL_REQUESTED', result: this.cancellationResult(await this.venue.cancelOrder(action.orderId)) }
  }

  private assertVenueScope(): void {
    if (this.venue.account !== this.scope.account || this.venue.venue !== this.scope.venue || this.venue.chainId !== this.scope.chainId) {
      throw new RiskRejectedError('VENUE_SCOPE', 'Venue identity changed after the agent was bound')
    }
  }

  private cancellationResult(result: TxResult): TxResult {
    if (!result || typeof result.id !== 'string' || !result.id || result.id.length > 512 ||
      !['SUBMITTED', 'CONFIRMED'].includes(result.status) ||
      (result.txHash !== undefined && (typeof result.txHash !== 'string' || !result.txHash))) throw new Error('Invalid cancellation acknowledgement')
    return { ...result }
  }

  private async loadSnapshot(): Promise<{ snapshot: RiskSnapshot; journalState: ExecutionJournalState }> {
    const journalState = await this.journal.read(this.scope) ?? emptyExecutionState()
    const [market, telemetry, book, positions, remoteOrders, balance] = await Promise.all([
      this.venue.getMarket(this.marketId), this.telemetry.getLiveMatch(this.matchId), this.venue.getOrderBook(this.marketId),
      this.venue.getPositions(this.scope.account), this.venue.getOpenOrders(this.scope.account), this.venue.getBalance(this.scope.account),
    ])
    if (market.id !== this.marketId || market.matchId !== this.matchId || market.venue !== this.scope.venue || market.chainId !== this.scope.chainId ||
      this.venue.account !== this.scope.account || this.venue.venue !== this.scope.venue || this.venue.chainId !== this.scope.chainId) {
      throw new RiskRejectedError('VENUE_SCOPE', 'Venue identity changed or returned an unrelated market')
    }
    // Pending executions remain conservatively reserved until an indexed final
    // outcome is supplied; disappearance from an eventually consistent API is unsafe.
    const outstandingOrderIds = new Set(journalState.entries.flatMap((entry) => entry.orderId ? [entry.orderId] : []))
    const openOrders = remoteOrders.filter((order) => !outstandingOrderIds.has(order.orderId))
    for (const entry of journalState.entries) {
      const shadow: Order = {
        ...this.scope, maker: this.scope.account, marketId: entry.input.marketId,
        orderId: entry.orderId ?? entry.id, outcomeId: entry.input.outcomeId, side: entry.input.side,
        price: entry.input.price, quantity: entry.input.quantity, expiresAt: entry.input.expiresAt,
        nonce: 0n, signature: '', filled: 0n, status: 'OPEN', createdAt: entry.createdAt, sequence: 0,
      }
      openOrders.push(shadow)
    }
    return { snapshot: { account: this.scope.account, market, telemetry, book, positions, openOrders, balance, now: this.now() }, journalState }
  }

  private async updateExecution(id: string, status: PendingExecution['status'], orderId?: string): Promise<void> {
    await this.journal.transaction(this.scope, (existing) => {
      const state = existing ?? emptyExecutionState()
      const entry = state.entries.find((item) => item.id === id)
      if (!entry) throw new Error('Execution reservation missing')
      entry.status = status
      if (orderId) entry.orderId = orderId
      state.revision += 1
      return { state, result: undefined }
    })
  }
}
