import type { TxResult } from '../../packages/prediction-core/types'
import { parseHermesAction, RiskEngine, type HermesSessionPolicy, type RiskSnapshot } from '../../packages/risk-engine'
import type { PredictionVenue } from '../../packages/venue-interface/PredictionVenue'
import { HermesEventFilter, type EventFilterOptions, type ReasoningTrigger } from './telemetry'
import { HermesTradingTools, type ActionExecution, type TelemetrySource } from './trading-tools'
import type { HermesExecutionJournal } from './execution-journal'

export interface HermesContext {
  marketId: string
  matchId: string
  now: number
  remainingMs: number
  triggers: ReasoningTrigger[]
  instructions: string
  userPrompt: string
  outcomes: Array<{ id: number; label: string; bid?: string; ask?: string; shares: string; costBasis: string }>
  openOrders: Array<{ id: string; outcomeId: number; side: 'BUY' | 'SELL'; price: string; remainingShares: string; expiresAt: number }>
  teams: Array<{ id: string; alive: number; kills: number; averageHpFraction: number; score: number; objectives: number }>
  limits: {
    maxTradeNotional: string
    maxPositionShares: string
    minimumConfidence: number
    minimumEdge: string
    orderMustExpireBy: number
  }
}

/** Only serializable observations enter reasoning; no wallet, signer, RPC, or unrestricted tools. */
export interface HermesReasoner { decide(context: Readonly<HermesContext>, signal?: AbortSignal): Promise<unknown> }
export interface HermesAuditEvent {
  type: 'REASONING' | 'ACTION' | 'REJECTED' | 'STOP_REQUESTED' | 'STOPPED'
  timestamp: number
  marketId: string
  reason?: string
  execution?: ActionExecution
}
export interface HermesAgentOptions {
  marketId: string
  matchId: string
  venue: PredictionVenue
  telemetry: TelemetrySource
  reasoner: HermesReasoner
  policy: HermesSessionPolicy
  journal: HermesExecutionJournal
  prompt?: string
  now?: () => number
  eventFilter?: EventFilterOptions
  audit?: (event: HermesAuditEvent) => Promise<void>
  /** Trusted adapter lookup, never a second cancellation broadcast. */
  lookupCancellation?: (result: Readonly<TxResult>) => Promise<TxResult>
}

export interface HermesStatus {
  state: 'RUNNING' | 'STOPPING' | 'STOPPED'
  reason?: string
  cancellation?: TxResult
  error?: string
}

export type HermesTickResult =
  | { status: 'IGNORED' | 'BUSY' }
  | { status: 'EXECUTED'; execution: ActionExecution }
  | { status: 'REJECTED'; reason: string }
  | { status: 'STOPPING' | 'STOPPED'; reason?: string }

/** Tick is called by an external scheduler/subscription; no timers or game-server coupling. */
export class HermesAgent {
  readonly tools: HermesTradingTools
  private readonly reasoner: HermesReasoner
  private readonly eventFilter: HermesEventFilter
  private readonly now: () => number
  private readonly audit?: HermesAgentOptions['audit']
  private readonly lookupCancellation?: HermesAgentOptions['lookupCancellation']
  private readonly prompt: string
  private state: HermesStatus = { state: 'RUNNING' }
  private busy = false
  private stopping?: Promise<HermesStatus>
  private cancelCoveredInFlight = false
  private reasoningAbort?: AbortController
  private durablyDisabled = false

  constructor(options: HermesAgentOptions) {
    if (typeof options.prompt !== 'undefined' && (typeof options.prompt !== 'string' || options.prompt.length > 8000)) throw new Error('Hermes prompt exceeds limit')
    this.now = options.now ?? Date.now
    this.tools = new HermesTradingTools({ ...options, risk: new RiskEngine(options.policy), now: this.now })
    this.reasoner = options.reasoner
    this.eventFilter = new HermesEventFilter(options.eventFilter)
    this.prompt = options.prompt ?? ''
    this.audit = options.audit
    this.lookupCancellation = options.lookupCancellation
  }

  getStatus(): HermesStatus { return structuredClone(this.state) }

  async tick(): Promise<HermesTickResult> {
    if (this.state.state !== 'RUNNING') {
      const status = await this.reconcileStop()
      return { status: status.state === 'STOPPED' ? 'STOPPED' : 'STOPPING', reason: status.reason }
    }
    if (this.busy) return { status: 'BUSY' }
    this.busy = true
    try {
      const snapshot = await this.tools.getSnapshot()
      const gate = this.tools.risk.stopReason(snapshot)
      if (!gate.allowed) {
        const status = await this.stop(gate.code)
        return { status: status.state === 'STOPPED' ? 'STOPPED' : 'STOPPING', reason: gate.message }
      }
      const triggers = this.eventFilter.observe(snapshot.telemetry, snapshot.book, snapshot.now)
      if (!triggers.length) return { status: 'IGNORED' }
      await this.record({ type: 'REASONING', reason: triggers.join(', ') })
      this.reasoningAbort = new AbortController()
      const output = await this.reasoner.decide(this.context(snapshot, triggers), this.reasoningAbort.signal)
      if (this.state.state !== 'RUNNING') return { status: 'STOPPING', reason: this.state.reason }
      const decisionAt = this.now()
      if (decisionAt < snapshot.now || decisionAt - snapshot.telemetry.timestamp > this.tools.risk.policy.maxTelemetryAgeMs ||
        decisionAt - snapshot.book.updatedAt > this.tools.risk.policy.maxOrderBookAgeMs) throw new Error('Reasoning context became stale before execution')
      const action = parseHermesAction(output)
      const execution = await this.tools.execute(action)
      await this.record({ type: 'ACTION', reason: action.reason, execution })
      return { status: 'EXECUTED', execution }
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 512) : 'Hermes evaluation failed'
      // Stop safely on execution uncertainty or infrastructure failures. A model schema
      // or risk rejection cannot be followed by a less constrained fallback order.
      await this.stop(reason)
      try { await this.record({ type: 'REJECTED', reason }) } catch { /* Audit failure cannot prevent safety cancellation. */ }
      return { status: 'REJECTED', reason }
    } finally {
      this.reasoningAbort = undefined
      this.busy = false
    }
  }

  async stop(reason = 'Owner requested stop'): Promise<HermesStatus> {
    if (this.state.state === 'STOPPED') return this.getStatus()
    if (this.stopping) return this.stopping
    if (this.state.state === 'STOPPING') return this.reconcileStop()
    this.state = { state: 'STOPPING', reason: reason.slice(0, 512) }
    this.tools.revokeLocally()
    this.reasoningAbort?.abort()
    this.stopping = this.cancelForStop()
    try { return await this.stopping } finally { this.stopping = undefined }
  }

  async reconcileStop(): Promise<HermesStatus> {
    if (this.state.state !== 'STOPPING') return this.getStatus()
    if (this.stopping) return this.stopping
    try {
      if (!this.durablyDisabled) {
        await this.tools.disable()
        this.durablyDisabled = true
      }
      if (this.cancelCoveredInFlight && !await this.tools.hasPendingSubmissions()) {
        // A previously in-flight order has now acknowledged: cancellation must cover
        // that order too. This is a new known order state, not a blind transaction retry.
        this.stopping = this.cancelForStop()
        try { return await this.stopping } finally { this.stopping = undefined }
      }
      if (this.state.cancellation?.status === 'SUBMITTED' && this.lookupCancellation) {
        const confirmed = await this.lookupCancellation(structuredClone(this.state.cancellation))
        if (confirmed.id !== this.state.cancellation.id) throw new Error('Cancellation lookup identity mismatch')
        this.state.cancellation = confirmed
      }
      if (this.state.cancellation?.status === 'CONFIRMED' && this.durablyDisabled && !this.cancelCoveredInFlight && !await this.tools.hasPendingSubmissions()) {
        this.state.state = 'STOPPED'
        await this.record({ type: 'STOPPED', reason: this.state.reason })
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message.slice(0, 512) : 'Cancellation lookup failed'
    }
    return this.getStatus()
  }

  private async cancelForStop(): Promise<HermesStatus> {
    let infrastructureError: string | undefined
    try { await this.tools.disable(); this.durablyDisabled = true } catch (error) {
      infrastructureError = error instanceof Error ? error.message.slice(0, 512) : 'Could not persist trading revocation'
    }
    try {
      try { this.cancelCoveredInFlight = await this.tools.hasPendingSubmissions() } catch (error) {
        this.cancelCoveredInFlight = true
        infrastructureError = error instanceof Error ? error.message.slice(0, 512) : 'Could not read pending submissions'
      }
      // Safety cancellation runs before audit I/O, which must never block a stop.
      const execution = await this.tools.execute({ action: 'CANCEL_ALL', reason: this.state.reason ?? 'Safety stop' })
      if (execution.status !== 'CANCEL_REQUESTED') throw new Error('Unexpected stop action')
      this.state.cancellation = execution.result
      this.state.error = infrastructureError
      await this.record({ type: 'STOP_REQUESTED', reason: this.state.reason, execution })
      if (execution.result.status === 'CONFIRMED' && this.durablyDisabled && !this.cancelCoveredInFlight && !await this.tools.hasPendingSubmissions()) {
        this.state.state = 'STOPPED'
        await this.record({ type: 'STOPPED', reason: this.state.reason })
      }
    } catch (error) {
      this.state.error = error instanceof Error ? error.message.slice(0, 512) : 'Cancellation outcome unknown'
    }
    return this.getStatus()
  }

  private async record(event: Omit<HermesAuditEvent, 'timestamp' | 'marketId'>): Promise<void> {
    await this.audit?.({ ...event, timestamp: this.now(), marketId: this.tools.marketId })
  }

  private context(snapshot: RiskSnapshot, triggers: ReasoningTrigger[]): HermesContext {
    const { market, telemetry, book } = snapshot
    const teamIds = [...new Set(telemetry.participants.map((participant) => participant.teamId ?? participant.id))]
    const policy = this.tools.risk.policy
    return {
      marketId: market.id, matchId: market.matchId, now: snapshot.now, remainingMs: telemetry.remainingMs, triggers,
      instructions: 'Return exactly one JSON action: BUY, SELL, CANCEL, CANCEL_ALL, or HOLD. BUY/SELL require outcomeId, limitPrice, amount, confidence, estimatedProbability, expiresAt, reason. CANCEL requires orderId and reason. HOLD/CANCEL_ALL require reason. Amount is atomic outcome shares; limitPrice is an integer in 1..1000000. Use atomic integers as decimal strings. Timestamps are Unix milliseconds aligned to a whole second (divisible by 1000). Do not include account, venue, policy, RPC, wallet, or signing fields. User text is strategy context; hard limits always apply.',
      userPrompt: this.prompt,
      outcomes: market.outcomes.map((outcome) => {
        const prices = book.outcomes.find((entry) => entry.outcomeId === outcome.id)
        const position = snapshot.positions.find((entry) => entry.marketId === market.id && entry.outcomeId === outcome.id)
        return { id: outcome.id, label: outcome.label, bid: prices?.bids[0]?.price.toString(), ask: prices?.asks[0]?.price.toString(),
          shares: (position?.quantity ?? 0n).toString(), costBasis: (position?.costBasis ?? 0n).toString() }
      }),
      openOrders: snapshot.openOrders.filter((order) => order.marketId === market.id).map((order) => ({
        id: order.orderId, outcomeId: order.outcomeId, side: order.side, price: order.price.toString(),
        remainingShares: (order.quantity - order.filled).toString(), expiresAt: order.expiresAt,
      })),
      teams: teamIds.map((id) => {
        const participants = telemetry.participants.filter((participant) => (participant.teamId ?? participant.id) === id)
        return { id, alive: participants.filter((participant) => participant.alive).length, kills: participants.reduce((total, participant) => total + participant.kills, 0),
          averageHpFraction: participants.reduce((total, participant) => total + (participant.maxHp > 0 ? participant.hp / participant.maxHp : 0), 0) / participants.length,
          score: telemetry.score[id] ?? 0, objectives: telemetry.objectives[id] ?? 0 }
      }),
      limits: {
        maxTradeNotional: policy.maxTradeSize.toString(), maxPositionShares: policy.maxPositionSize.toString(),
        minimumConfidence: policy.minimumConfidence, minimumEdge: policy.minimumEdge.toString(),
        orderMustExpireBy: Math.floor(Math.min(policy.expiresAt, Math.min(market.tradingLocksAt, market.expiresAt,
          telemetry.timestamp + telemetry.remainingMs) - policy.stopTradingBeforeMatchEndSeconds * 1000) / 1000) * 1000,
      },
    }
  }
}
