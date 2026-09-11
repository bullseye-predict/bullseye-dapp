import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { decodeAbiParameters, encodeAbiParameters, recoverTypedDataAddress } from 'viem'
import { DurableHermesControl, HermesControlError, type HermesConfiguredAccount, type HermesVaultLimits } from '../../apps/hermes-worker/control'
import { createHermesAccountServices, HermesRuntime, HttpHermesReasoner, parseHermesRuntimeConfig, type HermesAccountServices } from '../../apps/hermes-worker/runtime'
import { PredictionDatabase } from '../../apps/api/storage/database'
import { SqliteHermesJournal } from '../../apps/api/storage/hermes-journal'
import { SqliteMatcherStore } from '../../apps/api/storage/matcher-store'
import { MatchingEngine } from '../../apps/matcher'
import { emptyExecutionState, executionScopeKey } from '../../apps/hermes-worker/execution-journal'
import { encodeStored, stringify } from '../../packages/prediction-core/serialization'
import { parseSignedOrder } from '../../packages/prediction-core/validation'
import { ORDER_TYPES, evmOrderId } from '../../packages/adapters/evm/orders'
import { encodeVaultRequestSignature, vaultRequestMessage, verifyVaultRequest, type VaultRequestClient } from '../../packages/adapters/evm/vault-requests'
import type { HermesContext } from '../../apps/hermes-worker/agent'
import type { PredictionVenue } from '../../packages/venue-interface/PredictionVenue'
import type { SignedOrder } from '../../packages/prediction-core/types'
import { NOW, balance, book, market, policy, signedOrder, telemetry, tradeAction } from './fixtures'

const owner = `0x${'11'.repeat(20)}`
const vault = `0x${'22'.repeat(20)}`
const key = `0x${'01'.repeat(32)}` as const
const operator = privateKeyToAccount(key)
const configAccount = (): HermesConfiguredAccount => ({ venue: 'EVM', chainId: '31337', account: vault, owner, operator: operator.address, sessionKeyEnv: 'HERMES_SESSION_TEST', caps: policy() })
const limits = (): HermesVaultLimits => ({ ...configAccount(), epoch: '7', enabled: true, expiresAt: NOW + 4_000_000, maxCapital: 100_000_000n, maxOrderSize: 10_000_000n, maxExposure: 50_000_000n, spentCapital: 0n, exposure: 0n, marketAllowed: true })
const settings = () => ({ apiBaseUrl: 'http://127.0.0.1:8788', audience: 'http://127.0.0.1:8788', reasoner: { url: 'https://reasoner.example/decide', tokenEnv: 'REASONER_TOKEN' }, accounts: [configAccount()] })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { resolve, promise } }

describe('durable Hermes authorization and configuration', () => {
  test('strict configuration allows environment references only and immutable bounded policy', async () => {
    const db = new PredictionDatabase()
    try {
      const config = parseHermesRuntimeConfig(settings())
      expect(config.reasoner.timeoutMs).toBe(10_000)
      expect(() => parseHermesRuntimeConfig({ ...settings(), privateKey: key })).toThrow('Unsupported')
      expect(() => parseHermesRuntimeConfig({ ...settings(), reasoner: { url: 'http://insecure.example', token: 'secret' } })).toThrow()
      expect(() => parseHermesRuntimeConfig({ ...settings(), accounts: [{ ...configAccount(), sessionKeyEnv: key }] })).toThrow('environment')
      const control = new DurableHermesControl(db, config.accounts, { readVaultLimits: async () => limits(), now: () => NOW })
      await expect(control.start(operator.address, 'EVM', '31337', { marketId: 'market-1' })).rejects.toThrow('authorized vault')
      await expect(control.start(owner, 'EVM', '31337', { marketId: 'market-1', policy: { totalCapital: '100000001' } })).rejects.toThrow('exceeds')
      await expect(control.start(owner, 'EVM', '31337', { marketId: 'market-1', policy: { minimumConfidence: 0 } })).rejects.toThrow('weakens')
      await expect(control.start(owner, 'EVM', '31337', { marketId: 'market-1', operator: owner })).rejects.toThrow('Unsupported')
      const started = await control.start(owner, 'EVM', '31337', { marketId: 'market-1', prompt: 'Private strategy', policy: { minimumConfidence: 0.95 } })
      expect(started.state).toBe('START_REQUESTED')
      expect(started.policy?.minimumConfidence).toBe(0.95)
      expect(control.accounts[0]?.caps.minimumConfidence).toBe(0.7)
      const publicStatus = await control.sanitizedStatus(owner, 'EVM', '31337')
      expect(Object.keys(publicStatus).sort()).toEqual(['marketId', 'state', 'updatedAt'])
      expect(stringify(publicStatus)).not.toContain('Private strategy')
      expect(stringify(await control.status(owner, 'EVM', '31337'))).not.toContain('sessionKeyEnv')
      expect(await control.sanitizedStatus('someone', 'EVM', '31337')).toEqual({ state: 'DISABLED', reasonCode: 'CONFIGURE_VAULT' })
      await control.stop(owner, 'EVM', '31337')
      expect((await new SqliteHermesJournal(db).read(configAccount()))?.enabled).toBe(false)
      expect(db.sql.query('SELECT * FROM hermes_commands').all()).toHaveLength(2)
    } finally { db.close() }
  })
  test('chain policy change and an owner stop fence in-flight start authorization', async () => {
    const db = new PredictionDatabase(); const checked = deferred<HermesVaultLimits>()
    try {
      const control = new DurableHermesControl(db, [configAccount()], { readVaultLimits: () => checked.promise, now: () => NOW })
      const start = control.start(owner, 'EVM', '31337', { marketId: 'market-1' })
      await control.stop(owner, 'EVM', '31337')
      checked.resolve(limits())
      await expect(start).rejects.toThrow('changed')
      const changed = new DurableHermesControl(db, [configAccount()], { readVaultLimits: async () => ({ ...limits(), maxOrderSize: 1n }), now: () => NOW })
      await expect(changed.start(owner, 'EVM', '31337', { marketId: 'market-1' })).rejects.toThrow('on-chain')
    } finally { db.close() }
  })
  test('SQLite restart preserves pending requests and expired leases force cancellation before resuming', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'solz-hermes-runtime-')); const path = join(directory, 'state.sqlite')
    let db = new PredictionDatabase(path); let time = NOW
    try {
      let control = new DurableHermesControl(db, [configAccount()], { readVaultLimits: async () => limits(), now: () => time })
      await control.start(owner, 'EVM', '31337', { marketId: 'market-1' })
      db.close(); db = new PredictionDatabase(path)
      control = new DurableHermesControl(db, [configAccount()], { readVaultLimits: async () => limits(), now: () => time })
      expect((await control.status(owner, 'EVM', '31337')).state).toBe('START_REQUESTED')
      expect(control.claim(configAccount(), 'first', 100)).toBe(true)
      expect(control.claim(configAccount(), 'other', 100)).toBe(false)
      control.enableJournal(configAccount(), 'first')
      control.updateWorker(configAccount(), 'first', state => { state.state = 'RUNNING' })
      const nonce = control.nextNonce(configAccount(), 'first')
      expect(control.nextNonce(configAccount(), 'first')).toBe(nonce + 1n)
      time += 101
      expect(() => control.assertLease(configAccount(), 'first', true)).toThrow('no longer')
      expect(control.claim(configAccount(), 'other')).toBe(true)
      expect(control.read(configAccount()).reasonCode).toBe('WORKER_RESTART')
      expect(control.read(configAccount()).state).toBe('STOPPING')
      expect(() => control.nextNonce(configAccount(), 'first')).toThrow('no longer')
      expect(() => control.nextNonce(configAccount(), 'other')).toThrow('disabled')
      expect((await new SqliteHermesJournal(db).read(configAccount()))?.enabled).toBe(false)
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})

async function runtimeFixture(reasoner = { decide: async (_context: Readonly<HermesContext>, _signal?: AbortSignal): Promise<unknown> => ({ action: 'HOLD', reason: 'Observe' }) }) {
  const db = new PredictionDatabase(); const journal = new SqliteHermesJournal(db)
  const control = new DurableHermesControl(db, [configAccount()], { readVaultLimits: async () => limits(), now: () => NOW })
  const matcher = new MatchingEngine({ store: new SqliteMatcherStore(db), verifier: { verify: async () => true }, now: () => NOW })
  await matcher.registerMarket(market())
  let placements = 0; let cancellations = 0; let accounting = true; let terminal = false
  const venue: PredictionVenue = { venue: 'EVM', chainId: '31337', account: vault,
    listMarkets: async () => [market()], getMarket: async () => market(), getOrderBook: async () => book(),
    getPositions: async () => { if (!accounting) throw new HermesControlError('ACCOUNTING_UNAVAILABLE', 'Missing cost/PnL'); return [] },
    getOpenOrders: async () => [], getBalance: async () => balance({ account: vault }),
    placeOrder: async () => { placements++; return { orderId: 'placed', status: 'OPEN' } }, cancelOrder: async () => { cancellations++; return { id: 'cancel', status: 'SUBMITTED' } },
    cancelAllOrders: async () => { cancellations++; return { id: 'cancel-all', status: 'SUBMITTED' } }, redeem: async () => { throw new Error('Never redeem') },
  }
  const services: HermesAccountServices = { venue, readOrderFinality: async () => ({ terminal, filled: 0n, blockNumber: 1n }) }
  const runtime = new HermesRuntime({ database: db, control, reasoner, telemetry: { getLiveMatch: async () => telemetry() }, createServices: async () => services, now: () => NOW })
  return { db, control, journal, matcher, runtime, counts: () => ({ placements, cancellations }), setAccounting: (value: boolean) => { accounting = value }, setTerminal: (value: boolean) => { terminal = value }, cleanup: async () => { await runtime.stop(); db.close() } }
}

describe('Hermes live process coordination', () => {
  test('owner stop interrupts pending reasoning and prevents the returned trade', async () => {
    const entered = deferred<void>(); let aborted = false
    const f = await runtimeFixture({ decide: (_context, signal) => { entered.resolve(); return new Promise(resolve => { signal?.addEventListener('abort', () => { aborted = true; resolve(tradeAction()) }, { once: true }) }) } })
    try {
      await f.control.start(owner, 'EVM', '31337', { marketId: 'market-1' })
      await f.runtime.poll(); await entered.promise
      await f.control.stop(owner, 'EVM', '31337')
      await f.runtime.poll(); await f.runtime.idle(); await f.runtime.poll()
      expect(aborted).toBe(true)
      expect(f.counts().placements).toBe(0)
      expect(f.counts().cancellations).toBeGreaterThanOrEqual(1)
      expect((await f.control.status(owner, 'EVM', '31337')).state).toBe('STOPPED')
      expect((await f.journal.read(configAccount()))?.enabled).toBe(false)
    } finally { await f.cleanup() }
  })
  test('unknown accounting becomes a visible blocker without requesting a model trade', async () => {
    let decisions = 0
    const f = await runtimeFixture({ decide: async () => { decisions++; return tradeAction() } })
    try {
      f.setAccounting(false)
      await f.control.start(owner, 'EVM', '31337', { marketId: 'market-1' })
      await f.runtime.poll(); await f.runtime.poll()
      expect(decisions).toBe(0)
      expect(f.counts().placements).toBe(0)
      expect(await f.control.sanitizedStatus(owner, 'EVM', '31337')).toMatchObject({ state: 'BLOCKED', reasonCode: 'ACCOUNTING_UNAVAILABLE' })
    } finally { await f.cleanup() }
  })
  test('unknown signed submission stays reserved until finalized expiry; no retry on restart', async () => {
    const f = await runtimeFixture()
    try {
      await f.control.start(owner, 'EVM', '31337', { marketId: 'market-1' })
      await f.runtime.poll(); await f.runtime.idle()
      const signed = signedOrder({ maker: vault })
      await f.journal.transaction(configAccount(), state => ({ state: { ...(state ?? emptyExecutionState()), entries: [{ id: 'unknown-intent', status: 'UNKNOWN', orderId: signed.orderId, input: { marketId: signed.marketId, outcomeId: signed.outcomeId, side: signed.side, price: signed.price, quantity: signed.quantity, expiresAt: signed.expiresAt }, createdAt: NOW }] }, result: undefined }))
      f.db.sql.query('INSERT INTO hermes_signed_orders VALUES (?, ?, ?)').run(executionScopeKey(configAccount()), signed.orderId, encodeStored(signed))
      await f.control.stop(owner, 'EVM', '31337')
      await f.runtime.poll()
      expect((await f.journal.read(configAccount()))?.entries).toHaveLength(1)
      expect((await f.control.status(owner, 'EVM', '31337')).state).toBe('STOPPING')
      expect(f.counts().placements).toBe(0)
      f.setTerminal(true)
      await f.runtime.poll()
      expect((await f.journal.read(configAccount()))?.entries).toHaveLength(0)
      expect((await f.control.status(owner, 'EVM', '31337')).state).toBe('STOPPED')
    } finally { await f.cleanup() }
  })
})

const context = (): HermesContext => ({ marketId: 'market-1', matchId: 'match-1', now: NOW, remainingMs: 120_000, triggers: ['INITIAL'], instructions: 'Only structured actions', userPrompt: 'Observe objectives', outcomes: [], openOrders: [], teams: [], limits: { maxTradeNotional: '100', maxPositionShares: '200', minimumConfidence: 0.9, minimumEdge: '50000', orderMustExpireBy: NOW + 100_000 } })
describe('generic HTTPS reasoning and session authentication', () => {
  test('reasoner sees only context and malformed output has no execution fallback', async () => {
    let body = ''; let authorization: string | null = null
    const reasoner = new HttpHermesReasoner({ url: 'https://reasoner.example/decide', token: 'provider-secret', now: () => NOW, fetch: (async (_url, input) => {
      body = String(input?.body); authorization = new Headers(input?.headers).get('authorization')
      expect(input?.redirect).toBe('error')
      return Response.json({ action: 'HOLD', reason: 'Wait' })
    }) as typeof fetch })
    expect(await reasoner.decide(context())).toEqual({ action: 'HOLD', reason: 'Wait' })
    expect<string | null>(authorization).toBe('Bearer provider-secret')
    expect(body).not.toContain('provider-secret')
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(Object.keys(context()).sort())
    expect(JSON.parse(body).limits.orderMustExpireBy).toBe(NOW + 30_000)
    expect(() => new HttpHermesReasoner({ url: 'http://plain.example' })).toThrow()
    await expect(new HttpHermesReasoner({ url: 'https://reasoner.example', fetch: (async () => Response.json({ ...tradeAction(), amount: '10', limitPrice: '500000', walletKey: 'steal' })) as unknown as typeof fetch }).decide(context())).rejects.toThrow()
    await expect(new HttpHermesReasoner({ url: 'https://reasoner.example', fetch: (async () => new Response(' '.repeat(65_537))) as unknown as typeof fetch }).decide(context())).rejects.toThrow('exceeds')
  })
  test('EVM session proof permits order placement and cancellation only, never Hermes controls', async () => {
    const epoch = 7n; const message = 'Exact authenticated HTTP request'
    const signature = encodeVaultRequestSignature(epoch, await operator.signMessage({ message: vaultRequestMessage(message, epoch) }))
    const settlement = `0x${'33'.repeat(20)}` as const; const collateral = `0x${'44'.repeat(20)}` as const
    const client = { getBlockNumber: async () => 3n, getBytecode: async () => '0x6000', verifyMessage: async () => false,
      readContract: async ({ functionName }: { functionName: string }) => ({ owner, settlement, collateral, policyNonce: epoch, policy: [operator.address, 100n, 10n, 100n, 10_000n, true] })[functionName as 'owner'],
    } as unknown as VaultRequestClient
    expect(await verifyVaultRequest(client, { settlementAddress: settlement, collateralToken: collateral }, vault, message, signature, { method: 'POST', pathname: '/orders' }, NOW)).toBe(true)
    expect(await verifyVaultRequest(client, { settlementAddress: settlement, collateralToken: collateral }, vault, message, signature, { method: 'DELETE', pathname: '/orders/123' }, NOW)).toBe(true)
    for (const pathname of ['/hermes/start', '/hermes/config', '/executions', '/vault/withdraw', '/markets/m/redeem']) expect(await verifyVaultRequest(client, { settlementAddress: settlement, collateralToken: collateral }, vault, message, signature, { method: 'POST', pathname }, NOW)).toBe(false)
  })
  test('real EVM session signer produces the vault EIP712 envelope and authenticates /orders', async () => {
    const db = new PredictionDatabase(); const control = new DurableHermesControl(db, [configAccount()], { readVaultLimits: async () => limits(), now: () => NOW })
    const rpc = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) { const input = await request.json(); return Response.json({ jsonrpc: '2.0', id: input.id, result: encodeAbiParameters([{ type: 'uint256' }], [input.method === 'eth_call' ? 7n : 31337n]) }) } })
    const settlement = `0x${'33'.repeat(20)}` as const; const collateral = `0x${'44'.repeat(20)}` as const; const marketId = `0x${'55'.repeat(32)}`
    const journal = new SqliteHermesJournal(db); let admitted: SignedOrder | undefined; let proofSignature: string | null = null
    const configuration = parseHermesRuntimeConfig(settings())
    const runtime = new HermesRuntime({ database: db, control, reasoner: { decide: async () => ({ action: 'HOLD', reason: 'hold' }) }, telemetry: { getLiveMatch: async () => telemetry() }, createServices: async () => { throw new Error('not used') }, now: () => NOW })
    try {
      await control.start(owner, 'EVM', '31337', { marketId })
      control.claim(configAccount(), 'signer-test'); control.enableJournal(configAccount(), 'signer-test'); control.updateWorker(configAccount(), 'signer-test', state => { state.state = 'RUNNING' })
      const services = await createHermesAccountServices({ config: configuration, venues: [{ family: 'EVM', venue: 'EVM', chainId: '31337', rpcUrl: rpc.url.toString(), settlementAddress: settlement, factoryAddress: settlement, oracleAddress: settlement, collateralToken: collateral, collateralDecimals: 6 }], database: db, control, environment: { HERMES_SESSION_TEST: key }, now: () => NOW,
        fetch: (async (url, input) => {
          if (new URL(String(url)).pathname.startsWith('/markets/')) return new Response(stringify(market({ id: marketId, marketAddress: settlement, collateralToken: collateral })))
          admitted = parseSignedOrder(JSON.parse(String(input?.body)))
          proofSignature = new Headers(input?.headers).get('x-solz-signature')
          return Response.json({ orderId: admitted.orderId, status: 'OPEN' })
        }) as typeof fetch,
      })(configAccount(), 'signer-test')
      const input = { marketId, outcomeId: 0, side: 'BUY' as const, price: 500_000n, quantity: 20n, expiresAt: NOW + 10_000 }
      await journal.transaction(configAccount(), state => ({ state: { ...(state ?? emptyExecutionState()), entries: [{ id: 'trade-1', input, createdAt: NOW, status: 'SUBMITTING' }] }, result: undefined }))
      await services.venue.placeOrder(input)
      expect(admitted).toBeDefined()
      const [typedOrder, epoch, signature] = decodeAbiParameters([{ type: 'tuple', components: ORDER_TYPES.Order }, { type: 'uint256' }, { type: 'bytes' }], admitted!.signature as `0x${string}`)
      expect(typedOrder.maker.toLowerCase()).toBe(vault)
      expect(epoch).toBe(7n)
      expect(admitted!.orderId).toBe(evmOrderId(admitted!, settlement))
      expect((await recoverTypedDataAddress({ domain: { name: 'SOLZ Agent Vault', version: '1', chainId: 31337, verifyingContract: vault as `0x${string}` }, types: { AgentOrder: [{ name: 'orderHash', type: 'bytes32' }, { name: 'policyNonce', type: 'uint256' }] }, primaryType: 'AgentOrder', message: { orderHash: admitted!.orderId as `0x${string}`, policyNonce: epoch }, signature })).toLowerCase()).toBe(operator.address.toLowerCase())
      expect(proofSignature).toBeTruthy()
      expect((await journal.read(configAccount()))?.entries[0]?.orderId).toBe(admitted!.orderId)
      await control.stop(owner, 'EVM', '31337')
      await expect(services.venue.placeOrder(input)).rejects.toThrow('disabled')
    } finally { await runtime.stop(); rpc.stop(true); db.close() }
  })
})
