import type { PredictionDatabase } from '../api/storage/database'
import { decodeStored, encodeStored } from '../../packages/prediction-core/serialization'
import { atomic, record, textField } from '../../packages/prediction-core/validation'
import type { TxResult, VenueId } from '../../packages/prediction-core/types'
import { RiskEngine, type HermesSessionPolicy } from '../../packages/risk-engine'
import { emptyExecutionState, executionScopeKey, type ExecutionJournalState, type ExecutionScope } from './execution-journal'

export interface HermesConfiguredAccount extends ExecutionScope {
  owner: string
  operator: string
  sessionKeyEnv: string
  caps: HermesSessionPolicy
}
export interface HermesVaultLimits extends ExecutionScope {
  owner: string
  operator: string
  epoch: string
  enabled: boolean
  expiresAt: number
  maxCapital: bigint
  maxOrderSize: bigint
  maxExposure: bigint
  spentCapital: bigint
  exposure: bigint
  marketAllowed: boolean
}
export type ReadHermesVaultLimits = (account: Readonly<HermesConfiguredAccount>, marketId: string) => Promise<HermesVaultLimits>
export type HermesRuntimeState = 'DISABLED' | 'START_REQUESTED' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'BLOCKED'
export interface HermesControlStatus extends ExecutionScope {
  state: HermesRuntimeState
  desired: 'RUNNING' | 'STOPPED'
  marketId?: string
  policy?: HermesSessionPolicy
  prompt?: string
  revision: number
  updatedAt: number
  reasonCode?: string
  cancellation?: TxResult
}
export interface HermesPublicStatus { state: HermesRuntimeState; marketId?: string; updatedAt?: number; reasonCode?: string }
export interface HermesSessionRecord extends HermesControlStatus {
  epoch?: string
  safeToStart: boolean
  leaseToken?: string
  leaseUntil?: number
}
export class HermesControlError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'HermesControlError' }
}
const moneyFields = ['totalCapital', 'maxTradeSize', 'maxPositionSize', 'maxLossPerMatch', 'maxLossPerPosition', 'minimumEdge', 'maxSlippage'] as const
const numberFields = ['maxOpenOrders', 'minimumConfidence', 'stopTradingBeforeMatchEndSeconds', 'maxTelemetryAgeMs', 'maxOrderBookAgeMs', 'expiresAt'] as const
const upperFields = ['totalCapital', 'maxTradeSize', 'maxPositionSize', 'maxLossPerMatch', 'maxLossPerPosition', 'maxSlippage', 'maxOpenOrders', 'maxTelemetryAgeMs', 'maxOrderBookAgeMs', 'expiresAt'] as const
const lowerFields = ['minimumConfidence', 'minimumEdge', 'stopTradingBeforeMatchEndSeconds'] as const
const same = (venue: VenueId, a: string, b: string) => venue === 'SOLANA' ? a === b : a.toLowerCase() === b.toLowerCase()

export function parseHermesPolicy(value: unknown, base?: HermesSessionPolicy): HermesSessionPolicy {
  const input = record(value)
  const fields = [...moneyFields, ...numberFields]
  if (Object.keys(input).some(key => !fields.includes(key as typeof fields[number]))) throw new HermesControlError('INVALID_POLICY', 'Unknown Hermes policy field.')
  const policy = { ...base } as HermesSessionPolicy
  for (const key of moneyFields) if (input[key] !== undefined) policy[key] = atomic(input[key], key)
  for (const key of numberFields) if (input[key] !== undefined) {
    if (typeof input[key] !== 'number') throw new HermesControlError('INVALID_POLICY', `Invalid policy ${key}.`)
    policy[key] = input[key]
  }
  return { ...new RiskEngine(policy).policy }
}

/** Configured caps are immutable authority; API strategy text cannot modify them. */
export function assertHermesPolicyBounds(account: Readonly<HermesConfiguredAccount>, policy: HermesSessionPolicy, limits: HermesVaultLimits, now: number): void {
  new RiskEngine(policy)
  if (limits.venue !== account.venue || limits.chainId !== account.chainId || !same(account.venue, limits.account, account.account) ||
    !same(account.venue, limits.owner, account.owner) || !same(account.venue, limits.operator, account.operator) ||
    !limits.enabled || !limits.marketAllowed || limits.expiresAt <= now || policy.expiresAt <= now) {
    throw new HermesControlError('CONFIGURE_VAULT', 'Configure an active vault session for this account and market first.')
  }
  for (const key of upperFields) if (policy[key] > account.caps[key]) throw new HermesControlError('POLICY_CAP', `Policy ${key} exceeds configured authorization.`)
  for (const key of lowerFields) if (policy[key] < account.caps[key]) throw new HermesControlError('POLICY_CAP', `Policy ${key} weakens configured authorization.`)
  if (policy.totalCapital > limits.maxCapital || policy.maxTradeSize > limits.maxOrderSize || policy.maxPositionSize > limits.maxExposure ||
    policy.expiresAt > limits.expiresAt || limits.spentCapital > policy.totalCapital || limits.exposure > limits.maxExposure) {
    throw new HermesControlError('SESSION_POLICY_CHANGED', 'Policy exceeds the current on-chain vault session.')
  }
}

/**
 * API entry points accept an already verified owner HTTP proof. They never accept a
 * model identity. This local SQLite inbox is shared with the separate worker host.
 */
export class DurableHermesControl {
  readonly accounts: ReadonlyArray<Readonly<HermesConfiguredAccount>>
  private readonly now: () => number
  constructor(readonly database: PredictionDatabase, accounts: HermesConfiguredAccount[], private readonly options: { readVaultLimits: ReadHermesVaultLimits; now?: () => number }) {
    this.now = options.now ?? Date.now
    this.accounts = Object.freeze(accounts.map(account => Object.freeze({ ...account, caps: Object.freeze(parseHermesPolicy(account.caps)) })))
    if (new Set(this.accounts.map(executionScopeKey)).size !== accounts.length) throw new Error('Duplicate Hermes account configuration')
    database.sql.run(`CREATE TABLE IF NOT EXISTS hermes_sessions (scope TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS hermes_commands (id INTEGER PRIMARY KEY AUTOINCREMENT, scope TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, applied_at INTEGER);
      CREATE TABLE IF NOT EXISTS hermes_signing_nonces (scope TEXT PRIMARY KEY, next_nonce TEXT NOT NULL);`)
  }

  configured(account: string, venue: VenueId, chainId: string, vaultAccount?: string): Readonly<HermesConfiguredAccount> {
    const candidates = this.accounts.filter(entry => entry.venue === venue && entry.chainId === chainId &&
      (same(venue, entry.account, account) || same(venue, entry.owner, account)) && (!vaultAccount || same(venue, entry.account, vaultAccount)))
    if (candidates.length !== 1) throw new HermesControlError('CONFIGURE_VAULT', 'Configure one authorized vault for this owner and venue first.')
    return candidates[0]!
  }

  async start(account: string, venue: VenueId, chainId: string, input: unknown): Promise<HermesControlStatus> {
    const data = this.parseInput(input)
    const config = this.configured(account, venue, chainId, data.vaultAccount)
    const previous = this.read(config)
    if (!previous.safeToStart || ['RUNNING', 'START_REQUESTED', 'STOPPING'].includes(previous.state)) throw new HermesControlError('PENDING_RECONCILIATION', 'Stop and reconcile the current session before starting again.')
    const marketId = data.marketId ?? previous.marketId
    if (!marketId) throw new HermesControlError('INVALID_MARKET', 'A market is required to start Hermes.')
    const policy = parseHermesPolicy(data.policy ?? {}, previous.policy ?? config.caps)
    const limits = await this.options.readVaultLimits(config, marketId)
    assertHermesPolicyBounds(config, policy, limits, this.now())
    return this.database.transaction(() => {
      const state = this.read(config)
      if (state.revision !== previous.revision) throw new HermesControlError('CONTROL_RACE', 'Session changed while authorization was being checked.')
      const journal = this.journal(config)
      if (journal.entries.length) throw new HermesControlError('PENDING_RECONCILIATION', 'Execution accounting must be reconciled before restarting.')
      const next: HermesSessionRecord = { ...state, marketId, policy, prompt: data.prompt ?? previous.prompt ?? '', epoch: limits.epoch,
        desired: 'RUNNING', state: 'START_REQUESTED', reasonCode: undefined, cancellation: undefined, safeToStart: false, revision: state.revision + 1, updatedAt: this.now() }
      this.write(next); this.enqueue(next, 'START'); this.disableJournal(config)
      return this.view(next)
    })
  }

  async configure(account: string, venue: VenueId, chainId: string, input: unknown): Promise<HermesControlStatus> {
    const data = this.parseInput(input)
    const config = this.configured(account, venue, chainId, data.vaultAccount)
    const previous = this.read(config)
    if (!previous.safeToStart || ['RUNNING', 'START_REQUESTED', 'STOPPING'].includes(previous.state)) throw new HermesControlError('PENDING_RECONCILIATION', 'Stop and reconcile Hermes before changing its configuration.')
    const marketId = data.marketId ?? previous.marketId
    if (!marketId) throw new HermesControlError('INVALID_MARKET', 'A market is required to configure Hermes.')
    const policy = parseHermesPolicy(data.policy ?? {}, previous.policy ?? config.caps)
    const limits = await this.options.readVaultLimits(config, marketId)
    assertHermesPolicyBounds(config, policy, limits, this.now())
    return this.database.transaction(() => {
      const state = this.read(config)
      if (state.revision !== previous.revision) throw new HermesControlError('CONTROL_RACE', 'Session changed while authorization was being checked.')
      const next: HermesSessionRecord = { ...state, marketId, policy, prompt: data.prompt ?? previous.prompt ?? '', epoch: limits.epoch,
        desired: 'STOPPED', state: 'STOPPED', reasonCode: undefined, revision: state.revision + 1, updatedAt: this.now() }
      this.write(next); this.enqueue(next, 'CONFIG'); this.disableJournal(config)
      return this.view(next)
    })
  }

  async stop(account: string, venue: VenueId, chainId: string): Promise<HermesControlStatus> {
    const config = this.configured(account, venue, chainId)
    return this.database.transaction(() => {
      const state = this.read(config)
      this.disableJournal(config)
      const next: HermesSessionRecord = { ...state, desired: 'STOPPED', state: state.safeToStart && this.journal(config).entries.length === 0 ? 'STOPPED' : 'STOPPING',
        reasonCode: 'OWNER_STOP', revision: state.revision + 1, updatedAt: this.now() }
      this.write(next); this.enqueue(next, 'STOP')
      return this.view(next)
    })
  }

  async status(account: string, venue: VenueId, chainId: string): Promise<HermesControlStatus> { return this.view(this.freshStatus(this.configured(account, venue, chainId))) }
  async sanitizedStatus(account: string, venue: VenueId, chainId: string): Promise<HermesPublicStatus> {
    try {
      const state = this.freshStatus(this.configured(account, venue, chainId))
      return { state: state.state, ...(state.marketId ? { marketId: state.marketId } : {}), updatedAt: state.updatedAt, ...(state.reasonCode ? { reasonCode: state.reasonCode } : {}) }
    } catch { return { state: 'DISABLED', reasonCode: 'CONFIGURE_VAULT' } }
  }

  read(scope: ExecutionScope): HermesSessionRecord {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM hermes_sessions WHERE scope = ?').get(executionScopeKey(scope))
    return row ? decodeStored(row.payload) : { account: scope.account, venue: scope.venue, chainId: scope.chainId, state: 'DISABLED', desired: 'STOPPED', safeToStart: true, revision: 0, updatedAt: this.now() }
  }
  async validateSession(scope: ExecutionScope): Promise<HermesVaultLimits> {
    const config = this.configured(scope.account, scope.venue, scope.chainId)
    const state = this.read(config)
    if (!state.marketId || !state.policy) throw new HermesControlError('CONFIGURE_VAULT', 'Hermes has no authorized market policy.')
    const limits = await this.options.readVaultLimits(config, state.marketId)
    assertHermesPolicyBounds(config, state.policy, limits, this.now())
    if (limits.epoch !== state.epoch) throw new HermesControlError('SESSION_POLICY_CHANGED', 'The owner changed the on-chain session epoch.')
    return limits
  }
  claim(scope: ExecutionScope, token: string, ttlMs = 15_000): boolean {
    return this.database.transaction(() => {
      const state = this.read(scope)
      if (state.leaseToken && state.leaseToken !== token && (state.leaseUntil ?? 0) > this.now()) return false
      if ((state.leaseToken !== token || (state.leaseUntil ?? 0) <= this.now()) && state.state === 'RUNNING') {
        state.desired = 'STOPPED'; state.state = 'STOPPING'; state.reasonCode = 'WORKER_RESTART'; state.revision++
        this.disableJournal(scope)
      }
      state.leaseToken = token; state.leaseUntil = this.now() + ttlMs
      this.write(state)
      return true
    })
  }
  assertLease(scope: ExecutionScope, token: string, trading = false): HermesSessionRecord {
    const state = this.read(scope)
    if (state.leaseToken !== token || (state.leaseUntil ?? 0) <= this.now()) throw new HermesControlError('WORKER_LEASE_LOST', 'Worker no longer owns this account.')
    if (trading && (state.state !== 'RUNNING' || state.desired !== 'RUNNING' || !this.journal(scope).enabled)) throw new HermesControlError('OWNER_STOP', 'Owner disabled trading.')
    return state
  }
  updateWorker(scope: ExecutionScope, token: string, mutate: (state: HermesSessionRecord) => void): HermesSessionRecord {
    return this.database.transaction(() => {
      const state = this.assertLease(scope, token)
      mutate(state); state.updatedAt = this.now(); this.write(state)
      this.database.sql.query('UPDATE hermes_commands SET applied_at = ? WHERE scope = ? AND revision <= ? AND applied_at IS NULL').run(this.now(), executionScopeKey(scope), state.revision)
      if (state.desired !== 'RUNNING') this.disableJournal(scope)
      return state
    })
  }
  enableJournal(scope: ExecutionScope, token: string): void {
    this.database.transaction(() => {
      const state = this.assertLease(scope, token)
      if (state.desired !== 'RUNNING' || state.state !== 'START_REQUESTED') throw new HermesControlError('OWNER_STOP', 'Start request was cancelled.')
      const journal = this.journal(scope)
      if (journal.entries.length) throw new HermesControlError('PENDING_RECONCILIATION', 'Existing execution reservations require reconciliation.')
      journal.enabled = true; journal.revision++; this.writeJournal(scope, journal)
    })
  }
  releaseLease(scope: ExecutionScope, token: string): void {
    this.database.transaction(() => { const state = this.read(scope); if (state.leaseToken === token) { state.leaseToken = undefined; state.leaseUntil = undefined; this.write(state) } })
  }
  nextNonce(scope: ExecutionScope, token: string, minimum = 0n): bigint {
    return this.database.transaction(() => {
      this.assertLease(scope, token, true)
      const key = executionScopeKey(scope)
      const row = this.database.sql.query<{ next_nonce: string }, [string]>('SELECT next_nonce FROM hermes_signing_nonces WHERE scope = ?').get(key)
      const candidate = row ? BigInt(row.next_nonce) : BigInt(this.now()) * 1000n
      const nonce = candidate > minimum ? candidate : minimum
      if (nonce < 0n || nonce >= (scope.venue === 'SOLANA' ? (1n << 64n) - 1n : (1n << 256n) - 1n)) throw new Error('Signing nonce exhausted')
      this.database.sql.query('INSERT INTO hermes_signing_nonces VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET next_nonce = excluded.next_nonce').run(key, (nonce + 1n).toString())
      return nonce
    })
  }
  private parseInput(value: unknown): { vaultAccount?: string; marketId?: string; policy?: unknown; prompt?: string } {
    const input = record(value)
    if (Object.keys(input).some(key => !['vaultAccount', 'marketId', 'policy', 'prompt'].includes(key))) throw new HermesControlError('INVALID_CONFIG', 'Unsupported Hermes configuration field.')
    return { ...(input.vaultAccount === undefined ? {} : { vaultAccount: textField(input.vaultAccount, 'vaultAccount') }),
      ...(input.marketId === undefined ? {} : { marketId: textField(input.marketId, 'marketId') }),
      ...(input.policy === undefined ? {} : { policy: input.policy }),
      ...(input.prompt === undefined ? {} : { prompt: typeof input.prompt === 'string' && input.prompt.length <= 8000 ? input.prompt : (() => { throw new Error('Invalid Hermes prompt') })() }) }
  }
  private view(state: HermesSessionRecord): HermesControlStatus {
    const { epoch: _epoch, safeToStart: _safe, leaseToken: _token, leaseUntil: _lease, ...publicState } = state
    return structuredClone(publicState)
  }
  private freshStatus(scope: ExecutionScope): HermesSessionRecord {
    return this.database.transaction(() => {
      const state = this.read(scope)
      if ((state.state === 'RUNNING' && (state.leaseUntil ?? 0) <= this.now()) ||
        (state.state === 'START_REQUESTED' && (state.leaseUntil ?? 0) <= this.now() && state.updatedAt + 30_000 <= this.now())) {
        state.desired = 'STOPPED'; state.state = 'STOPPING'; state.safeToStart = false; state.reasonCode = 'WORKER_OFFLINE'; state.revision++; state.updatedAt = this.now()
        this.disableJournal(scope); this.write(state); this.enqueue(state, 'STOP')
      }
      return state
    })
  }
  private write(state: HermesSessionRecord): void { this.database.sql.query('INSERT INTO hermes_sessions VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload').run(executionScopeKey(state), encodeStored(state)) }
  private enqueue(state: HermesSessionRecord, kind: string): void { this.database.sql.query('INSERT INTO hermes_commands(scope,revision,kind,created_at) VALUES (?,?,?,?)').run(executionScopeKey(state), state.revision, kind, this.now()) }
  private journal(scope: ExecutionScope): ExecutionJournalState {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM hermes_execution_journals WHERE scope = ?').get(executionScopeKey(scope))
    return row ? decodeStored(row.payload) : emptyExecutionState()
  }
  private disableJournal(scope: ExecutionScope): void { const state = this.journal(scope); state.enabled = false; state.revision++; this.writeJournal(scope, state) }
  private writeJournal(scope: ExecutionScope, state: ExecutionJournalState): void { this.database.sql.query('INSERT INTO hermes_execution_journals VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload').run(executionScopeKey(scope), encodeStored(state)) }
}
