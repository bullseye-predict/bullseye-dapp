import { createPublicClient, http, parseAbiItem } from 'viem'
import type { PrivateKeyAccount } from 'viem/accounts'
import type { Keypair } from '@solana/web3.js'
import { EvmChainGateway } from '../../packages/adapters/evm/gateway'
import { SolanaChainGateway, parseSolanaConfig } from '../../packages/adapters/solana/gateway'
import { parseEvmConfig } from '../../packages/adapters/config'
import { EvmSettlementTransport } from '../../packages/adapters/evm/transport'
import { SolanaSettlementTransport } from '../../packages/adapters/solana/transport'
import { EvmChainPortfolio } from '../../packages/adapters/evm/portfolio'
import { SolanaChainPortfolio } from '../../packages/adapters/solana/portfolio'
import { effectiveMarket, integer, invariant, marketKey, record, textField } from '../../packages/prediction-core/validation'
import { encodeStored } from '../../packages/prediction-core/serialization'
import type { Market, VenueId } from '../../packages/prediction-core/types'
import type { PredictionDatabase } from '../api/storage/database'
import { SqliteMatcherStore } from '../api/storage/matcher-store'
import { MatchingEngine } from '../matcher/matching-engine'
import type { MatcherStore } from '../matcher/store'
import { pendingSettlement, type MarketScope, type SettlementReceipt } from '../matcher/settlement'
import { ChainSubmissionJournal } from './journal'
import { createChainPortfolio, type ChainPortfolioReader } from './portfolio'
import { parseSignedMatchResult, verifyResult, type ChainConfig } from './results'

export interface ChainWorkerSettings {
  discoveryStartBlock?: bigint
  discoveryBatchSize?: number
  confirmations?: number
  maxGas?: bigint
  maxGasPriceWei?: bigint
  computeUnitLimit?: number
  priorityFeeMicroLamports?: number
  maxBlockAgeMs?: number
  relayerKeyEnv?: string
  oracleKeyEnv?: string
}
export type ChainRuntimeConfig = ChainConfig & { worker?: ChainWorkerSettings }
export interface ChainSigners { evm?: PrivateKeyAccount; solana?: Keypair; oracle?: Keypair }
export const chainRuntimeKey = (venue: VenueId, chainId: string) => JSON.stringify([venue, chainId])

export function parseChainRuntimeConfig(input: unknown): ChainRuntimeConfig {
  const value = record(input)
  const config = value.family === 'SOLANA' ? parseSolanaConfig(input) : parseEvmConfig(input)
  if (value.worker === undefined) return config
  const raw = record(value.worker)
  const settings: ChainWorkerSettings = {}
  const amount = (name: string, allowZero = false) => {
    invariant(typeof raw[name] === 'string' && /^(0|[1-9][0-9]*)$/.test(raw[name] as string), 'INVALID_CONFIG', `${name} must be a decimal integer string.`)
    const value = BigInt(raw[name] as string)
    invariant(allowZero ? value >= 0n : value > 0n, 'INVALID_CONFIG', `Invalid ${name}.`)
    return value
  }
  if (raw.discoveryStartBlock !== undefined) settings.discoveryStartBlock = amount('discoveryStartBlock', true)
  if (raw.maxGas !== undefined) settings.maxGas = amount('maxGas')
  if (raw.maxGasPriceWei !== undefined) settings.maxGasPriceWei = amount('maxGasPriceWei')
  if (raw.discoveryBatchSize !== undefined) settings.discoveryBatchSize = integer(raw.discoveryBatchSize, 'discoveryBatchSize', 1, 5000)
  if (raw.confirmations !== undefined) settings.confirmations = integer(raw.confirmations, 'confirmations', 1, 10000)
  if (raw.computeUnitLimit !== undefined) settings.computeUnitLimit = integer(raw.computeUnitLimit, 'computeUnitLimit', 1, 1_400_000)
  if (raw.priorityFeeMicroLamports !== undefined) settings.priorityFeeMicroLamports = integer(raw.priorityFeeMicroLamports, 'priorityFeeMicroLamports', 0, 1_000_000_000)
  if (raw.maxBlockAgeMs !== undefined) settings.maxBlockAgeMs = integer(raw.maxBlockAgeMs, 'maxBlockAgeMs', 1000, 600_000)
  for (const name of ['relayerKeyEnv', 'oracleKeyEnv'] as const) if (raw[name] !== undefined) {
    const key = textField(raw[name], name, 128)
    invariant(/^[A-Z][A-Z0-9_]*$/.test(key), 'INVALID_CONFIG', 'Signing key settings must name environment variables.')
    settings[name] = key
  }
  return { ...config, worker: settings }
}

export interface ChainRuntimeOptions {
  database: PredictionDatabase
  configs: ChainRuntimeConfig[]
  store?: MatcherStore
  matcher?: MatchingEngine
  writesEnabled?: boolean
  signers?: Map<string, ChainSigners>
  now?: () => number
  onError?: (error: unknown, scope?: { venue: VenueId; chainId: string; marketId?: string }) => void | Promise<void>
}

export function createChainRuntime(options: ChainRuntimeOptions) {
  const now = options.now ?? Date.now
  const configs = new Map(options.configs.map(config => [chainRuntimeKey(config.venue, config.chainId), config]))
  invariant(configs.size === options.configs.length, 'DUPLICATE_VENUE', 'Venue/chain deployments must be unique.')
  const gateways = new Map(options.configs.map(config => [chainRuntimeKey(config.venue, config.chainId), config.family === 'EVM' ? new EvmChainGateway(config) : new SolanaChainGateway(config, now)]))
  const store = options.store ?? new SqliteMatcherStore(options.database)
  const matcher = options.matcher ?? new MatchingEngine({ store, verifier: { verify: async order => await gateways.get(chainRuntimeKey(order.venue, order.chainId))?.verifyOrder(order) ?? false }, now })
  const journal = new ChainSubmissionJournal(options.database, now)
  const transports = new Map<string, EvmSettlementTransport | SolanaSettlementTransport>()
  const readers = new Map<string, ChainPortfolioReader>()
  const enabled = new Set<string>()
  for (const config of options.configs) {
    const key = chainRuntimeKey(config.venue, config.chainId)
    const signers = options.signers?.get(key)
    const settings = config.worker ?? {}
    if (config.family === 'EVM') {
      transports.set(key, new EvmSettlementTransport(config, { journal, relayer: signers?.evm, writesEnabled: options.writesEnabled === true, ...settings }))
      readers.set(key, new EvmChainPortfolio(config, { ...settings, now }))
      if (options.writesEnabled && signers?.evm) enabled.add(key)
    } else {
      transports.set(key, new SolanaSettlementTransport(config, { journal, relayer: signers?.solana, oracle: signers?.oracle, writesEnabled: options.writesEnabled === true, ...settings }))
      readers.set(key, new SolanaChainPortfolio(config, { ...settings, now }))
      if (options.writesEnabled && signers?.solana) enabled.add(key)
    }
  }
  const portfolio = createChainPortfolio({ database: options.database, store, readers, now })
  const report = async (error: unknown, scope?: { venue: VenueId; chainId: string; marketId?: string }) => { if (options.onError) await options.onError(error, scope); else throw error }
  function marketForTrading(market: Market): Market {
    return journal.hasMarketResult(market.venue, market.chainId, market.id) && !['RESOLVED', 'VOIDED'].includes(market.status) ? { ...market, paused: true } : market
  }
  async function saveMarket(market: Market): Promise<void> {
    const scope = { venue: market.venue, chainId: market.chainId, marketId: market.id }
    // A result accepted from the configured authority stops new off-chain matching
    // immediately. Chain state remains authoritative for redemption/final outcome.
    const ended = journal.hasMarketResult(market.venue, market.chainId, market.id)
    const matchingMarket = marketForTrading(market)
    if (await store.read(scope)) await matcher.updateMarket(matchingMarket)
    else {
      try { await matcher.registerMarket(matchingMarket) } catch (error) { if (await store.read(scope)) await matcher.updateMarket(matchingMarket); else throw error }
    }
    if (ended) {
      const state = await store.read(scope)
      for (const order of state?.orders ?? []) if (['OPEN', 'PARTIALLY_FILLED'].includes(order.status) || state?.settlements.some(plan => plan.status === 'PLANNED' && (plan.buy.orderId === order.orderId || plan.sell.orderId === order.orderId))) await matcher.cancelOrder(scope, order.orderId, order.maker)
    }
    const prior = options.database.getMarket(market.venue, market.chainId, market.id, now())
    options.database.saveMarket(matchingMarket)
    if (encodeStored(prior) !== encodeStored(matchingMarket)) options.database.appendEvent(`markets:${marketKey(market.venue, market.chainId, market.id)}`, 'MARKET_UPDATED', matchingMarket, now())
  }
  async function discover(config: ChainRuntimeConfig): Promise<void> {
    if (config.family === 'SOLANA') return // Explicit metadata registry below supplies chain-bound labels.
    const client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 0 }) })
    invariant(String(await client.getChainId()) === config.chainId, 'WRONG_CHAIN', 'Discovery RPC belongs to another chain.')
    const head = await client.getBlockNumber({ cacheTime: 0 })
    const depth = BigInt((config.worker?.confirmations ?? 2) - 1)
    if (head < depth) return
    const confirmed = head - depth
    const start = config.worker?.discoveryStartBlock ?? 0n
    const cursorKey = JSON.stringify(['markets', config.venue, config.chainId, config.factoryAddress.toLowerCase()])
    const saved = journal.cursor(cursorKey)
    const checkpoint = saved ? JSON.parse(saved) as { next: string; hash: string } : undefined
    let from = checkpoint ? BigInt(checkpoint.next) : start
    if (checkpoint && from > 0n && from - 1n <= confirmed && (await client.getBlock({ blockNumber: from - 1n })).hash !== checkpoint.hash) from = from > 64n + start ? from - 64n : start
    if (from > confirmed) return
    const candidate = from + BigInt(config.worker?.discoveryBatchSize ?? 2000) - 1n
    const to = candidate < confirmed ? candidate : confirmed
    const logs = await client.getLogs({ address: config.factoryAddress, event: parseAbiItem('event MarketCreated(bytes32 indexed marketId,bytes32 indexed matchId)'), fromBlock: from, toBlock: to, strict: true })
    for (const log of logs) await saveMarket(effectiveMarket(await gateways.get(chainRuntimeKey(config.venue, config.chainId))!.getMarket(log.args.marketId), now()))
    journal.setCursor(cursorKey, JSON.stringify({ next: (to + 1n).toString(), hash: (await client.getBlock({ blockNumber: to })).hash }))
  }
  async function refresh(config: ChainRuntimeConfig): Promise<MarketScope[]> {
    const ids = new Set(options.database.listMarkets(config.venue, config.chainId, now()).map(market => market.id))
    if (config.family === 'SOLANA') Object.keys(config.markets).forEach(id => ids.add(id))
    const scopes: MarketScope[] = []
    for (const id of ids) {
      const scope = { venue: config.venue, chainId: config.chainId, marketId: id }
      try {
        await saveMarket(effectiveMarket(await gateways.get(chainRuntimeKey(config.venue, config.chainId))!.getMarket(id), now()))
        scopes.push(scope)
      } catch (error) { await report(error, scope) }
    }
    return scopes
  }
  async function acceptResult(input: unknown): Promise<{ id: string; status: 'QUEUED' | 'CONFIRMED' | 'FAILED'; receipt?: SettlementReceipt }> {
    const result = parseSignedMatchResult(input)
    const config = configs.get(chainRuntimeKey(result.venue, result.chainId))
    invariant(config, 'UNSUPPORTED_VENUE', 'Result venue has no configured chain transport.')
    const existing = journal.result(result)
    if (existing) return { id: existing.id, status: existing.receipt?.status === 'CONFIRMED' ? 'CONFIRMED' : existing.receipt?.status === 'FAILED' ? 'FAILED' : 'QUEUED', receipt: existing.receipt }
    invariant(await verifyResult(result, config, now()), 'INVALID_RESULT_AUTHORITY', 'Result signature, market binding or deadline is invalid.')
    const id = journal.enqueueResult(result)
    const market = await gateways.get(chainRuntimeKey(result.venue, result.chainId))!.getMarket(result.marketId)
    await saveMarket(effectiveMarket(market, now()))
    return { id, status: 'QUEUED' }
  }
  let ticking: Promise<void> | undefined
  async function tickOnce(): Promise<void> {
    const fresh: MarketScope[] = []
    for (const config of options.configs) {
      try { await discover(config); fresh.push(...await refresh(config)) } catch (error) { await report(error, config) }
    }
    const resultScopes = new Set<string>()
    for (const job of journal.pendingResults()) {
      const result = job.result
      resultScopes.add(marketKey(result.venue, result.chainId, result.marketId))
      const key = chainRuntimeKey(result.venue, result.chainId)
      if (!enabled.has(key)) continue
      try {
        const receipt = await transports.get(key)!.submitResult(job.id, result)
        journal.finishResult(job.id, receipt)
        if (receipt.status === 'CONFIRMED') {
          await saveMarket(effectiveMarket(await gateways.get(key)!.getMarket(result.marketId), now()))
          options.database.appendEvent(`markets:${marketKey(result.venue, result.chainId, result.marketId)}`, 'RESULT_CONFIRMED', { result, receipt }, now())
        }
      } catch (error) { await report(error, { ...result, marketId: result.marketId }) }
    }
    for (const scope of fresh) {
      const key = chainRuntimeKey(scope.venue, scope.chainId)
      if (!enabled.has(key)) continue
      const transport = transports.get(key)!
      try {
        let failed = false
        const ending = resultScopes.has(marketKey(scope.venue, scope.chainId, scope.marketId))
        for (const plan of (await matcher.getSettlements(scope)).filter(plan => pendingSettlement(plan.status))) {
          if (ending && plan.status === 'PLANNED') continue
          const result = plan.status === 'PLANNED' ? await matcher.settle(scope, plan.id, transport) : await matcher.reconcile(scope, plan.id, transport)
          if (result.status === 'FAILED') failed = true
        }
        if (failed || ending) continue
        for (let count = 0; count < 10; count++) {
          const plan = await matcher.planNext(scope)
          if (!plan) break
          if ((await matcher.settle(scope, plan.id, transport)).status === 'FAILED') break
        }
      } catch (error) { await report(error, scope) }
    }
  }
  const worker = {
    async tick(): Promise<void> {
      if (!ticking) ticking = tickOnce().finally(() => { ticking = undefined })
      return ticking
    },
    async run(signal: AbortSignal, intervalMs = 1000): Promise<void> {
      invariant(Number.isSafeInteger(intervalMs) && intervalMs >= 100 && intervalMs <= 60_000, 'INVALID_CONFIG', 'Worker interval must be 100–60000 milliseconds.')
      while (!signal.aborted) {
        await worker.tick()
        if (signal.aborted) break
        await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, intervalMs)
          signal.addEventListener('abort', done, { once: true })
          if (signal.aborted) done()
        })
      }
    },
  }
  return { worker, portfolio, acceptResult, marketForTrading, journal, matcher, gateways, transports }
}
