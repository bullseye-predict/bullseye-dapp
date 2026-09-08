import { readFileSync } from 'node:fs'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { createPublicClient, encodeAbiParameters, http, isAddress, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { parseEvmConfig, type EvmVenueConfig } from '../../packages/adapters/config'
import { parseSolanaConfig, type SolanaGatewayConfig } from '../../packages/adapters/solana/gateway'
import { decodeConfig, decodeOrderState, decodeVault } from '../../packages/adapters/solana/accounts'
import { configAddress, orderStateAddress, vaultAddress } from '../../packages/adapters/solana/wire'
import { createSolanaOrderSigner, createSolanaRequestSigner, type SolanaVenueConfig } from '../../packages/adapters/solana/SolanaPredictionVenue'
import { evmOrderId, ORDER_TYPES, orderTypedData } from '../../packages/adapters/evm/orders'
import { encodeVaultRequestSignature, vaultRequestMessage } from '../../packages/adapters/evm/vault-requests'
import { HttpPredictionVenue } from '../../packages/sdk/HttpPredictionVenue'
import { parsePredictionResponse } from '../../packages/sdk/wire'
import type { PredictionVenue } from '../../packages/venue-interface/PredictionVenue'
import type { PortfolioPosition } from '../../packages/prediction-core/market-data'
import type { MatchTelemetry, PlaceOrderInput, SignedOrder, TxResult, VenueId } from '../../packages/prediction-core/types'
import { decodeStored, encodeStored, stringify } from '../../packages/prediction-core/serialization'
import { integer, record, textField, venueId } from '../../packages/prediction-core/validation'
import { parseHermesAction } from '../../packages/risk-engine'
import { PredictionDatabase } from '../api/storage/database'
import { SqliteHermesJournal } from '../api/storage/hermes-journal'
import { SqliteMatcherStore } from '../api/storage/matcher-store'
import { MatchingEngine } from '../matcher/matching-engine'
import { pendingSettlement } from '../matcher/settlement'
import { HermesAgent, type HermesContext, type HermesReasoner } from './agent'
import { DurableHermesControl, HermesControlError, parseHermesPolicy, type HermesConfiguredAccount, type ReadHermesVaultLimits } from './control'
import { executionScopeKey, releaseIndexedExecution, type ExecutionScope, type HermesExecutionJournal } from './execution-journal'
import type { TelemetrySource } from './trading-tools'

export interface HermesRuntimeConfig {
  apiBaseUrl: string
  audience: string
  reasoner: { url: string; tokenEnv?: string; timeoutMs: number }
  pollIntervalMs: number
  accounts: HermesConfiguredAccount[]
}
export type HermesVenueConfig = EvmVenueConfig | SolanaGatewayConfig
const scoped = (venue: VenueId, chainId: string) => JSON.stringify([venue, chainId])
const same = (venue: VenueId, a: string, b: string) => venue === 'SOLANA' ? a === b : a.toLowerCase() === b.toLowerCase()
const envReference = (input: unknown, name: string) => {
  const value = textField(input, name, 128)
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) throw new Error(`${name} must name an environment variable`)
  return value
}
function keys(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Unsupported Hermes configuration field')
}
function endpoint(input: unknown, name: string, httpsOnly = false): string {
  const url = new URL(textField(input, name, 2048))
  if (url.username || url.password || url.hash || !(httpsOnly ? ['https:'] : ['https:', 'http:']).includes(url.protocol)) throw new Error(`Invalid ${name}`)
  return url.toString()
}
export function parseHermesRuntimeConfig(input: unknown): HermesRuntimeConfig {
  const value = record(input)
  keys(value, ['apiBaseUrl', 'audience', 'reasoner', 'pollIntervalMs', 'accounts'])
  const reasoner = record(value.reasoner)
  keys(reasoner, ['url', 'tokenEnv', 'timeoutMs'])
  if (!Array.isArray(value.accounts) || value.accounts.length === 0 || value.accounts.length > 100) throw new Error('Hermes requires an explicit authorized account registry')
  const accounts = value.accounts.map(input => {
    const item = record(input)
    keys(item, ['venue', 'chainId', 'account', 'owner', 'operator', 'sessionKeyEnv', 'caps'])
    const venue = venueId(item.venue)
    if (venue === 'DREAMDEX') throw new Error('Hermes DreamDEX execution requires a separately configured driver')
    const address = (name: string) => {
      const value = textField(item[name], name)
      if (venue === 'SOLANA') return new PublicKey(value).toBase58()
      if (!isAddress(value) || /^0x0{40}$/i.test(value)) throw new Error(`Invalid Hermes ${name}`)
      return value
    }
    const account = address('account'); const owner = address('owner'); const operator = address('operator')
    if (same(venue, owner, operator) || same(venue, account, operator) || same(venue, account, owner)) throw new Error('Hermes requires a separate owner, session operator, and vault')
    const chainId = textField(item.chainId, 'chainId')
    if (venue !== 'SOLANA' && (!/^[1-9][0-9]*$/.test(chainId) || BigInt(chainId) > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('Invalid Hermes chain ID')
    return { venue, chainId, account, owner, operator, sessionKeyEnv: envReference(item.sessionKeyEnv, 'sessionKeyEnv'), caps: parseHermesPolicy(item.caps) }
  })
  if (new Set(accounts.map(executionScopeKey)).size !== accounts.length) throw new Error('Duplicate Hermes account configuration')
  return { apiBaseUrl: endpoint(value.apiBaseUrl, 'apiBaseUrl'), audience: textField(value.audience, 'audience', 2048),
    reasoner: { url: endpoint(reasoner.url, 'reasoner.url', true), ...(reasoner.tokenEnv === undefined ? {} : { tokenEnv: envReference(reasoner.tokenEnv, 'tokenEnv') }), timeoutMs: integer(reasoner.timeoutMs ?? 10_000, 'reasoner.timeoutMs', 100, 30_000) },
    pollIntervalMs: integer(value.pollIntervalMs ?? 1000, 'pollIntervalMs', 100, 10_000), accounts }
}
/** Read configuration references only. The API host never loads session signing keys. */
export function loadHermesRuntimeConfig(environment: Record<string, string | undefined> = process.env): HermesRuntimeConfig | undefined {
  return environment.PREDICTION_HERMES_FILE ? parseHermesRuntimeConfig(JSON.parse(readFileSync(environment.PREDICTION_HERMES_FILE, 'utf8'))) : undefined
}
export function loadHermesVenueConfigs(environment: Record<string, string | undefined>): HermesVenueConfig[] {
  if (!environment.PREDICTION_VENUES_FILE) throw new Error('Hermes requires PREDICTION_VENUES_FILE')
  const value: unknown = JSON.parse(readFileSync(environment.PREDICTION_VENUES_FILE, 'utf8'))
  if (!Array.isArray(value)) throw new Error('PREDICTION_VENUES_FILE must contain an array')
  return value.map(config => record(config).family === 'SOLANA' ? parseSolanaConfig(config) : parseEvmConfig(config))
}

async function boundedJson(response: Response, maxBytes = 65_536): Promise<unknown> {
  if (!response.ok) throw new Error(`Service returned HTTP ${response.status}`)
  if (!response.body) throw new Error('Service returned no JSON body')
  const reader = response.body.getReader()
  let bytes = 0; const parts: Uint8Array[] = []
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new Error('Service response exceeds limit')
      parts.push(chunk.value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const result = new Uint8Array(bytes); let offset = 0
  for (const part of parts) { result.set(part, offset); offset += part.length }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result))
}
/** HTTPS provider gets exactly a HermesContext, never runtime config, keys, or a tool handle. */
export class HttpHermesReasoner implements HermesReasoner {
  private readonly url: string
  constructor(private readonly options: { url: string; token?: string; timeoutMs?: number; fetch?: typeof fetch; now?: () => number }) {
    this.url = endpoint(options.url, 'reasoner.url', true)
    integer(options.timeoutMs ?? 10_000, 'reasoner timeout', 100, 30_000)
  }
  async decide(context: Readonly<HermesContext>, signal?: AbortSignal): Promise<unknown> {
    const copy = structuredClone(context)
    // Model limits are informative; the signer independently enforces this 30s expiry cap.
    copy.limits.orderMustExpireBy = Math.min(copy.limits.orderMustExpireBy, Math.floor(((this.options.now ?? Date.now)() + 30_000) / 1000) * 1000)
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 10_000)
    const response = await (this.options.fetch ?? fetch)(this.url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}) },
      body: stringify(copy), redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    return parseHermesAction(await boundedJson(response))
  }
}

const VAULT_ABI = parseAbi([
  'function owner() view returns (address)', 'function settlement() view returns (address)', 'function collateral() view returns (address)',
  'function policyNonce() view returns (uint256)', 'function policy() view returns (address operator,uint128 maxCapital,uint128 maxOrderSize,uint128 maxExposure,uint64 expiresAt,bool enabled)',
  'function spentCapital() view returns (uint256)', 'function grossExposure() view returns (uint256)', 'function allowedMarket(bytes32) view returns (bool)',
])
const SETTLEMENT_ABI = parseAbi(['function minimumNonce(address) view returns (uint256)', 'function filledQuantity(bytes32) view returns (uint128)', 'function cancelled(address,bytes32) view returns (bool)'])
const milliseconds = (seconds: bigint): number => {
  if (seconds < 0n || seconds > BigInt(Math.floor(Number.MAX_SAFE_INTEGER / 1000))) throw new Error('Invalid chain timestamp')
  return Number(seconds) * 1000
}
const evmClient = (config: EvmVenueConfig) => createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) })
function solanaClient(config: SolanaGatewayConfig): Connection {
  return new Connection(config.rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: ((url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10_000) })) as typeof fetch })
}
function solanaDeployment(config: SolanaGatewayConfig, connection: Connection, now: () => number): SolanaVenueConfig {
  return { programId: config.programId, chainId: config.chainId, networkDomain: Uint8Array.from(Buffer.from(config.networkDomain, 'hex')),
    readAccount: address => connection.getAccountInfo(address, 'confirmed'), now }
}

export function createHermesVaultReader(configs: HermesVenueConfig[], now: () => number = Date.now): ReadHermesVaultLimits {
  const deployments = new Map(configs.map(config => [scoped(config.venue, config.chainId), config]))
  if (deployments.size !== configs.length) throw new Error('Duplicate Hermes deployment')
  return async (account, marketId) => {
    const config = deployments.get(scoped(account.venue, account.chainId))
    if (!config) throw new HermesControlError('CONFIGURE_VAULT', 'This venue has no configured deployment.')
    if (config.family === 'SOLANA') {
      const connection = solanaClient(config)
      if (await connection.getGenesisHash() !== config.chainId) throw new Error('Wrong Solana network')
      const addresses = [configAddress(config.programId), new PublicKey(account.account)]
      const read = await connection.getMultipleAccountsInfoAndContext(addresses, { commitment: 'confirmed' })
      const [globalInfo, vaultInfo] = read.value
      if (!globalInfo || !vaultInfo) throw new HermesControlError('CONFIGURE_VAULT', 'Create and authorize the configured vault first.')
      const global = decodeConfig({ ...globalInfo, address: addresses[0]! }, config.programId)
      const state = decodeVault({ ...vaultInfo, address: addresses[1]! }, config.programId)
      if (Buffer.from(global.networkDomain).toString('hex') !== config.networkDomain || global.mint.toBase58() !== config.collateralToken || !global.mint.equals(state.mint) || global.oracle.toBase58() !== config.oracleAuthority ||
        !vaultAddress(config.programId, account.owner).equals(addresses[1]!)) throw new Error('Wrong Solana vault deployment')
      return { account: account.account, venue: account.venue, chainId: account.chainId, owner: state.owner.toBase58(), operator: state.agent.toBase58(), epoch: state.sessionEpoch.toString(), enabled: state.enabled && !global.paused,
        expiresAt: milliseconds(state.expirySeconds), maxCapital: state.maxCapital, maxOrderSize: state.maxOrderSize, maxExposure: state.maxExposure, spentCapital: state.spentCapital, exposure: state.exposure, marketAllowed: !!config.markets[marketId] }
    }
    const client = evmClient(config)
    if (await client.getChainId() !== Number(config.chainId)) throw new Error('Wrong EVM network')
    const block = await client.getBlock({ blockTag: 'latest' })
    if (milliseconds(block.timestamp) > now() + 5000 || now() - milliseconds(block.timestamp) > 60_000) throw new Error('Stale EVM vault state')
    const address = account.account as Address
    const at = { address, abi: VAULT_ABI, blockNumber: block.number }
    const [owner, settlement, collateral, epoch, policy, spentCapital, exposure, marketAllowed] = await Promise.all([
      client.readContract({ ...at, functionName: 'owner' }), client.readContract({ ...at, functionName: 'settlement' }), client.readContract({ ...at, functionName: 'collateral' }),
      client.readContract({ ...at, functionName: 'policyNonce' }), client.readContract({ ...at, functionName: 'policy' }), client.readContract({ ...at, functionName: 'spentCapital' }), client.readContract({ ...at, functionName: 'grossExposure' }),
      client.readContract({ ...at, functionName: 'allowedMarket', args: [marketId as Hex] }),
    ])
    if (!same(config.venue, settlement, config.settlementAddress) || !same(config.venue, collateral, config.collateralToken)) throw new Error('Wrong EVM vault deployment')
    return { account: account.account, venue: account.venue, chainId: account.chainId, owner, operator: policy[0], epoch: epoch.toString(), enabled: policy[5], expiresAt: milliseconds(policy[4]),
      maxCapital: policy[1], maxOrderSize: policy[2], maxExposure: policy[3], spentCapital, exposure, marketAllowed }
  }
}

export interface HermesOrderFinality { terminal: boolean; filled: bigint; blockNumber?: bigint; slot?: number }
export interface HermesAccountServices { venue: PredictionVenue; readOrderFinality(order: SignedOrder): Promise<HermesOrderFinality> }
export interface HermesRuntimeOptions {
  database: PredictionDatabase
  control: DurableHermesControl
  reasoner: HermesReasoner
  telemetry: TelemetrySource
  createServices(account: Readonly<HermesConfiguredAccount>, leaseToken: string): Promise<HermesAccountServices>
  pollIntervalMs?: number
  now?: () => number
}

/** Durable account lease plus journal fencing protects owner-stop and concurrent hosts. */
export class HermesRuntime {
  private readonly token = crypto.randomUUID()
  private readonly journal: HermesExecutionJournal
  private readonly matcher: MatchingEngine
  private readonly store: SqliteMatcherStore
  private readonly agents = new Map<string, HermesAgent>()
  private readonly services = new Map<string, HermesAccountServices>()
  private readonly ticks = new Map<string, Promise<void>>()
  private readonly busy = new Set<string>()
  private readonly now: () => number
  private stopped = false
  private readonly renew: ReturnType<typeof setInterval>
  constructor(private readonly options: HermesRuntimeOptions) {
    this.now = options.now ?? Date.now
    this.journal = new SqliteHermesJournal(options.database)
    this.store = new SqliteMatcherStore(options.database)
    this.matcher = new MatchingEngine({ store: this.store, verifier: { verify: async () => false }, now: this.now })
    options.database.sql.run('CREATE TABLE IF NOT EXISTS hermes_signed_orders (scope TEXT NOT NULL, order_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(scope,order_id));')
    this.renew = setInterval(() => {
      for (const account of options.control.accounts) if (options.control.read(account).leaseToken === this.token) {
        try { options.control.assertLease(account, this.token); options.control.claim(account, this.token) } catch { this.agents.get(executionScopeKey(account))?.tools.revokeLocally() }
      }
    }, 5000)
  }
  async poll(): Promise<void> { if (!this.stopped) await Promise.all(this.options.control.accounts.map(account => this.pollAccount(account))) }
  async idle(): Promise<void> { await Promise.all([...this.ticks.values()]) }
  async run(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted && !this.stopped) {
        await this.poll()
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, this.options.pollIntervalMs ?? 1000)
          signal.addEventListener('abort', done, { once: true }); if (signal.aborted) done()
        })
      }
    } finally { await this.stop() }
  }
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await Promise.all(this.options.control.accounts.map(async account => {
      try {
        this.options.control.assertLease(account, this.token)
        this.halt(account, 'WORKER_SHUTDOWN')
        await this.agents.get(executionScopeKey(account))?.stop('WORKER_SHUTDOWN')
      } catch { /* Another process owns this lease, or revocation remains durable. */ }
    }))
    await this.idle()
    clearInterval(this.renew)
    for (const account of this.options.control.accounts) this.options.control.releaseLease(account, this.token)
  }
  private halt(scope: ExecutionScope, reasonCode: string): void {
    this.agents.get(executionScopeKey(scope))?.tools.revokeLocally()
    this.options.control.updateWorker(scope, this.token, state => { state.desired = 'STOPPED'; state.state = 'STOPPING'; state.safeToStart = false; state.reasonCode = reasonCode })
  }
  private async pollAccount(account: Readonly<HermesConfiguredAccount>): Promise<void> {
    const key = executionScopeKey(account)
    if (this.busy.has(key)) return
    this.busy.add(key)
    try {
      if (!this.options.control.claim(account, this.token)) return
      let state = this.options.control.read(account)
      if (!state.marketId) return
      if (state.state === 'START_REQUESTED' || state.state === 'RUNNING' || state.state === 'STOPPING') {
        if (!this.services.has(key)) this.services.set(key, await this.options.createServices(account, this.token))
      }
      const service = this.services.get(key)
      if (!service) return
      if (!this.ticks.has(key)) await this.reconcileJournal(account, service)
      state = this.options.control.assertLease(account, this.token)
      if (state.state === 'START_REQUESTED' && state.desired === 'RUNNING') {
        await this.options.control.validateSession(account)
        const market = await service.venue.getMarket(state.marketId!)
        const agent = new HermesAgent({ marketId: market.id, matchId: market.matchId, venue: service.venue, telemetry: this.options.telemetry, reasoner: this.options.reasoner,
          policy: state.policy!, prompt: state.prompt, journal: this.journal, now: this.now, lookupCancellation: result => this.lookupCancellation(account, state.marketId!, service, result) })
        // Accounting availability and fresh risk inputs are required before the journal is enabled.
        const snapshot = await agent.tools.getSnapshot()
        const gate = agent.tools.risk.stopReason(snapshot)
        if (!gate.allowed) throw new HermesControlError(gate.code, gate.message)
        this.options.control.enableJournal(account, this.token)
        this.options.control.updateWorker(account, this.token, current => {
          if (current.desired !== 'RUNNING') throw new HermesControlError('OWNER_STOP', 'Start was cancelled.')
          current.state = 'RUNNING'
        })
        this.agents.set(key, agent)
      }
      state = this.options.control.assertLease(account, this.token)
      if (state.desired !== 'RUNNING' || state.state === 'STOPPING') { await this.reconcileStop(account, service); return }
      const agent = this.agents.get(key)
      if (!agent) { this.halt(account, 'WORKER_RESTART'); return }
      if (!this.ticks.has(key)) {
        const tick = (async () => {
          try {
            await this.options.control.validateSession(account)
            this.options.control.assertLease(account, this.token, true)
            await agent.tick()
            if (agent.getStatus().state !== 'RUNNING') this.halt(account, reasonCode(agent.getStatus().reason))
          } catch (error) { this.halt(account, reasonCode(error)); await agent.stop(reasonCode(error)) }
        })().catch(() => { agent.tools.revokeLocally() }).finally(() => this.ticks.delete(key))
        this.ticks.set(key, tick)
      }
    } catch (error) {
      try { this.halt(account, reasonCode(error)); await this.agents.get(key)?.stop(reasonCode(error)) } catch { /* Lease loss must not revive signing. */ }
    } finally { this.busy.delete(key) }
  }
  private async reconcileStop(account: Readonly<HermesConfiguredAccount>, service: HermesAccountServices): Promise<void> {
    const state = this.options.control.assertLease(account, this.token)
    if (!state.marketId) return
    // The durable owner stop authorizes closing this local queue even if the session
    // key is expired/revoked. No new chain transaction or signature is produced here.
    await this.matcher.cancelAllOrders({ ...account, marketId: state.marketId }, account.account)
    const agent = this.agents.get(executionScopeKey(account))
    if (agent) await agent.stop(state.reasonCode ?? 'OWNER_STOP')
    const cancellation = await this.lookupCancellation(account, state.marketId, service, { id: state.cancellation?.id ?? `hermes-stop:${executionScopeKey(account)}:${state.revision}`, status: 'SUBMITTED' })
    const journal = await this.journal.read(account)
    const safe = cancellation.status === 'CONFIRMED' && !journal?.entries.length && !this.ticks.has(executionScopeKey(account))
    this.options.control.updateWorker(account, this.token, current => {
      current.cancellation = cancellation; current.safeToStart = safe
      current.state = safe ? ['OWNER_STOP', 'WORKER_SHUTDOWN'].includes(current.reasonCode ?? '') ? 'STOPPED' : 'BLOCKED' : 'STOPPING'
    })
    if (safe) this.agents.delete(executionScopeKey(account))
  }
  private async lookupCancellation(scope: ExecutionScope, marketId: string, service: HermesAccountServices, result: TxResult): Promise<TxResult> {
    const state = await this.store.read({ ...scope, marketId })
    if (!state) return result
    const ours = state.orders.filter(order => same(scope.venue, scope.account, order.maker))
    if (state.settlements.some(plan => pendingSettlement(plan.status) && (same(scope.venue, scope.account, plan.buy.maker) || same(scope.venue, scope.account, plan.sell.maker)))) return result
    if (ours.some(order => ['OPEN', 'PARTIALLY_FILLED'].includes(order.status) && order.expiresAt > this.now())) return result
    for (const order of ours) if (!(await service.readOrderFinality(order)).terminal) return result
    // CONFIRMED means the local cancellation is safe and all signatures are now
    // terminal on finalized chain state. It does not invent a cancellation txHash.
    return { id: result.id, status: 'CONFIRMED' }
  }
  private async reconcileJournal(scope: ExecutionScope, service: HermesAccountServices): Promise<void> {
    for (const entry of (await this.journal.read(scope))?.entries ?? []) {
      if (!entry.orderId) continue // Crash before signature identity was durably recorded: operator reconciliation required.
      const row = this.options.database.sql.query<{ payload: string }, [string, string]>('SELECT payload FROM hermes_signed_orders WHERE scope = ? AND order_id = ?').get(executionScopeKey(scope), entry.orderId)
      if (!row) continue
      const order = decodeStored<SignedOrder>(row.payload)
      const state = await this.store.read({ ...scope, marketId: order.marketId })
      if (state?.settlements.some(plan => pendingSettlement(plan.status) && [plan.buy.orderId, plan.sell.orderId].includes(order.orderId))) continue
      const finality = await service.readOrderFinality(order)
      if (!finality.terminal) continue
      if (finality.filled !== 0n) {
        // A known final order alone does not prove that its cost/PnL has reached the
        // portfolio. Require a complete finalized indexer snapshot at or after it.
        const positions = await service.venue.getPositions(scope.account) as PortfolioPosition[]
        const position = positions.find(value => value.marketId === order.marketId && value.outcomeId === order.outcomeId)
        const provenance = position?.provenance
        if (!position?.accountingComplete || provenance?.source !== 'INDEXER' || provenance.finality !== 'FINALIZED' ||
          (finality.blockNumber !== undefined && (provenance.blockNumber === undefined || BigInt(provenance.blockNumber) < finality.blockNumber)) ||
          (finality.slot !== undefined && (provenance.slot === undefined || provenance.slot < finality.slot))) throw new HermesControlError('ACCOUNTING_UNAVAILABLE', 'Final fills require complete indexed cost and realized PnL.')
      }
      await releaseIndexedExecution(this.journal, scope, entry.id)
    }
  }
}

function reasonCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : typeof error === 'string' ? error : ''
  if (/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code
  if (error instanceof Error && /accounting|cost|PnL/i.test(error.message)) return 'ACCOUNTING_UNAVAILABLE'
  return 'INFRASTRUCTURE_UNAVAILABLE'
}

/** Host adapter: session credentials are loaded here, never by control/API or reasoner. */
export function createHermesAccountServices(options: { config: HermesRuntimeConfig; venues: HermesVenueConfig[]; database: PredictionDatabase; control: DurableHermesControl; environment: Record<string, string | undefined>; now?: () => number; fetch?: typeof fetch }) {
  const now = options.now ?? Date.now
  const journal = new SqliteHermesJournal(options.database)
  const deployments = new Map(options.venues.map(config => [scoped(config.venue, config.chainId), config]))
  return async (account: Readonly<HermesConfiguredAccount>, token: string): Promise<HermesAccountServices> => {
    const config = deployments.get(scoped(account.venue, account.chainId))
    if (!config) throw new HermesControlError('CONFIGURE_VAULT', 'No configured deployment for Hermes.')
    const secret = options.environment[account.sessionKeyEnv]
    if (!secret) throw new HermesControlError('SIGNER_UNAVAILABLE', 'The configured session signer is unavailable.')
    const remember = async (order: SignedOrder): Promise<SignedOrder> => {
      options.control.assertLease(account, token, true)
      await journal.transaction(account, current => {
        if (!current?.enabled) throw new HermesControlError('OWNER_STOP', 'Owner disabled trading.')
        const entry = current.entries.find(item => item.status === 'SUBMITTING' && !item.orderId && encodeStored(item.input) === encodeStored({ marketId: order.marketId, outcomeId: order.outcomeId, side: order.side, price: order.price, quantity: order.quantity, expiresAt: order.expiresAt }))
        if (!entry) throw new Error('Signed order lacks a durable execution reservation')
        options.database.sql.query('INSERT INTO hermes_signed_orders VALUES (?, ?, ?)').run(executionScopeKey(account), order.orderId, encodeStored(order))
        entry.orderId = order.orderId; current.revision++
        return { state: current, result: undefined }
      })
      return order
    }
    const authorizeTrade = async (input: PlaceOrderInput) => {
      options.control.assertLease(account, token, true)
      await options.control.validateSession(account)
      if (input.expiresAt > now() + 30_000) throw new HermesControlError('ORDER_EXPIRY_LIMIT', 'Hermes orders must expire within thirty seconds.')
      options.control.assertLease(account, token, true)
    }
    const guardedRequest = (message: string) => {
      const parts = message.split('\n'); const method = parts[2]; const path = new URL(parts[3] ?? '', options.config.apiBaseUrl).pathname
      if (parts.length !== 10 || parts[0] !== 'SOLZ_PREDICTION_REQUEST_V1' || !((method === 'POST' && ['/orders', '/orders/cancel-all'].includes(path)) || (method === 'DELETE' && /^\/orders\/[^/]+$/.test(path)))) throw new Error('Session request is outside trading scope')
      options.control.assertLease(account, token, method === 'POST' && path === '/orders')
    }
    let signOrder: (input: PlaceOrderInput) => Promise<SignedOrder>
    let signRequest: (message: string) => Promise<string>
    let readOrderFinality: HermesAccountServices['readOrderFinality']
    if (config.family === 'EVM') {
      if (!/^0x[0-9a-fA-F]{64}$/.test(secret)) throw new Error('Invalid configured EVM session key')
      const signer = privateKeyToAccount(secret as Hex)
      if (!same(config.venue, signer.address, account.operator)) throw new Error('Configured session key does not match authorized operator')
      const client = evmClient(config)
      signOrder = async input => {
        await authorizeTrade(input)
        const minimum = await client.readContract({ address: config.settlementAddress, abi: SETTLEMENT_ABI, functionName: 'minimumNonce', args: [account.account as Address] })
        const order: SignedOrder = { ...input, venue: account.venue, chainId: account.chainId, maker: account.account, nonce: options.control.nextNonce(account, token, minimum), orderId: '', signature: '' }
        const epoch = BigInt(options.control.read(account).epoch!)
        order.orderId = evmOrderId(order, config.settlementAddress)
        const signature = await signer.signTypedData({ domain: { name: 'SOLZ Agent Vault', version: '1', chainId: Number(config.chainId), verifyingContract: account.account as Address },
          types: { AgentOrder: [{ name: 'orderHash', type: 'bytes32' }, { name: 'policyNonce', type: 'uint256' }] }, primaryType: 'AgentOrder', message: { orderHash: order.orderId as Hex, policyNonce: epoch } })
        order.signature = encodeAbiParameters([{ type: 'tuple', components: ORDER_TYPES.Order }, { type: 'uint256' }, { type: 'bytes' }], [orderTypedData(order, config.settlementAddress).message, epoch, signature])
        return remember(order)
      }
      signRequest = async message => {
        guardedRequest(message)
        const epoch = await client.readContract({ address: account.account as Address, abi: VAULT_ABI, functionName: 'policyNonce' })
        const signature = encodeVaultRequestSignature(epoch, await signer.signMessage({ message: vaultRequestMessage(message, epoch) }))
        guardedRequest(message)
        return signature
      }
      readOrderFinality = async order => {
        if (await client.getChainId() !== Number(config.chainId)) throw new Error('Wrong EVM network')
        const block = await client.getBlock({ blockTag: 'finalized' })
        const at = { address: config.settlementAddress, abi: SETTLEMENT_ABI, blockNumber: block.number }
        const [filled, cancelled, minimum] = await Promise.all([client.readContract({ ...at, functionName: 'filledQuantity', args: [order.orderId as Hex] }),
          client.readContract({ ...at, functionName: 'cancelled', args: [account.account as Address, order.orderId as Hex] }), client.readContract({ ...at, functionName: 'minimumNonce', args: [account.account as Address] })])
        return { terminal: filled >= order.quantity || cancelled || order.nonce < minimum || milliseconds(block.timestamp) >= order.expiresAt, filled, blockNumber: block.number }
      }
    } else {
      let bytes: Uint8Array
      try {
        const value: unknown = secret.startsWith('[') ? JSON.parse(secret) : [...Buffer.from(secret.replace(/^0x/, ''), 'hex')]
        if (!Array.isArray(value) || ![32, 64].includes(value.length) || value.some(byte => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error()
        bytes = Uint8Array.from(value)
      } catch { throw new Error('Invalid configured Solana session key') }
      const keypair = bytes.length === 64 ? Keypair.fromSecretKey(bytes) : Keypair.fromSeed(bytes)
      if (keypair.publicKey.toBase58() !== account.operator) throw new Error('Configured session key does not match authorized operator')
      const pkcs8 = Uint8Array.from([...Buffer.from('302e020100300506032b657004220420', 'hex'), ...keypair.secretKey.subarray(0, 32)])
      const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8.buffer, 'Ed25519', false, ['sign'])
      const signer = { publicKey: keypair.publicKey, signMessage: async (message: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', privateKey, Uint8Array.from(message).buffer)) }
      const connection = solanaClient(config)
      const deployment = solanaDeployment(config, connection, now)
      const sign = createSolanaOrderSigner(deployment, account.owner, signer, async () => {
        for (let attempt = 0; attempt < 100; attempt++) {
          const nonce = options.control.nextNonce(account, token)
          if (!await connection.getAccountInfo(orderStateAddress(config.programId, account.account, nonce), 'confirmed')) return nonce
        }
        throw new Error('Unable to allocate a fresh Solana order nonce')
      })
      signOrder = async input => { await authorizeTrade(input); return remember(await sign(input)) }
      const requestSigner = createSolanaRequestSigner(deployment, account.owner, signer)
      signRequest = async message => { guardedRequest(message); const signature = await requestSigner(message); guardedRequest(message); return signature }
      readOrderFinality = async order => {
        if (await connection.getGenesisHash() !== config.chainId) throw new Error('Wrong Solana network')
        const address = orderStateAddress(config.programId, account.account, order.nonce)
        const response = await connection.getAccountInfoAndContext(address, { commitment: 'finalized' })
        const blockTime = await connection.getBlockTime(response.context.slot)
        if (blockTime === null) throw new Error('Finalized Solana timestamp unavailable')
        const state = response.value ? decodeOrderState({ ...response.value, address }, config.programId) : undefined
        return { terminal: !!state?.cancelled || (state?.filled ?? 0n) >= order.quantity || blockTime * 1000 >= order.expiresAt, filled: state?.filled ?? 0n, slot: response.context.slot }
      }
    }
    const client = new HttpPredictionVenue({ baseUrl: options.config.apiBaseUrl, audience: options.config.audience, venue: account.venue, chainId: account.chainId, account: account.account, signOrder, signRequest,
      redeem: async () => { throw new Error('Hermes session does not expose redemption') }, now, fetch: options.fetch })
    const venue: PredictionVenue = {
      venue: client.venue, chainId: client.chainId, account: client.account,
      listMarkets: () => client.listMarkets(), getMarket: id => client.getMarket(id), getOrderBook: (id, outcome) => client.getOrderBook(id, outcome),
      getPositions: async owner => {
        const positions = await client.getPortfolioPositions(owner)
        // An empty holdings list does not prove zero realized loss. Automated risk
        // needs an explicit complete indexer snapshot, including closed positions.
        if (positions.length === 0 || positions.some(position => position.accountingComplete !== true || position.provenance?.source !== 'INDEXER' || position.provenance.finality !== 'FINALIZED' || typeof position.costBasis !== 'bigint' || typeof position.realizedPnl !== 'bigint')) throw new HermesControlError('ACCOUNTING_UNAVAILABLE', 'A complete indexed portfolio including realized PnL is required for Hermes.')
        return positions as Awaited<ReturnType<PredictionVenue['getPositions']>>
      },
      getOpenOrders: (owner, marketId) => client.getOpenOrders(owner, marketId), getBalance: owner => client.getBalance(owner),
      placeOrder: input => client.placeOrder(input), cancelOrder: id => client.cancelOrder(id), cancelAllOrders: id => client.cancelAllOrders(id), redeem: id => client.redeem(id),
    }
    return { venue, readOrderFinality }
  }
}

export function createHermesTelemetrySource(apiBaseUrl: string, fetcher: typeof fetch = fetch): TelemetrySource {
  const base = endpoint(apiBaseUrl, 'apiBaseUrl')
  return { async getLiveMatch(matchId: string): Promise<MatchTelemetry> {
    const response = await fetcher(new URL(`/matches/${encodeURIComponent(matchId)}/telemetry`, base), { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000) })
    return parsePredictionResponse<MatchTelemetry>(stringify(await boundedJson(response)))
  } }
}
