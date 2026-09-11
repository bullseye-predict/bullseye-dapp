import { expect, test } from 'bun:test'
import ganache from 'ganache'
import { BrowserProvider, Contract, ContractFactory, MaxUint256, Wallet, id } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { compile } from '../scripts/compile.mjs'
import { PredictionDatabase } from '../../../apps/api/storage/database'
import { SqliteMatcherStore } from '../../../apps/api/storage/matcher-store'
import { createPredictionApi } from '../../../apps/api/server'
import { RequestAuthenticator } from '../../../apps/api/auth/requests'
import { chainRuntimeKey, createChainRuntime } from '../../../apps/chain-worker/runtime'
import { evmOrderId, orderTypedData } from '../../../packages/adapters/evm/orders'
import { resultTypedData } from '../../../packages/adapters/evm/results'
import { proofHeaders, requestAuthMessage } from '../../../packages/sdk/auth'
import { stringify } from '../../../packages/prediction-core/serialization'
import type { SignedMatchResult, SignedOrder } from '../../../packages/prediction-core/types'
import type { ChainRuntimeConfig } from '../../../apps/chain-worker/runtime'

test('real EVM: authenticated API orders, durable worker recovery, current positions, authority result and owner redemption', async () => {
  const artifacts = compile({ write: false, test: true })
  const server = ganache.server({ chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 6 }, logging: { quiet: true } })
  await server.listen(0, '127.0.0.1')
  const provider = new BrowserProvider(server.provider, undefined, { cacheTimeout: -1, pollingInterval: 10 })
  const database = new PredictionDatabase()
  try {
    // Ganache generates these test-only identities; no environment key is read.
    const secrets = Object.values(server.provider.getInitialAccounts()).map(account => account.secretKey)
    const wallets = secrets.map(secret => new Wallet(secret))
    const signers = await Promise.all(wallets.map(wallet => provider.getSigner(wallet.address)))
    const deploy = async (name: string, args: unknown[] = []) => {
      const contract = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, signers[0]).deploy(...args)
      await contract.waitForDeployment()
      return contract
    }
    const mined = async (promise: Promise<any>) => (await promise).wait()
    const factory = await deploy('PredictionMarketFactory', [wallets[0].address, 16])
    const settlement = new Contract(await factory.settlement(), artifacts.PredictionMarket.abi, signers[0])
    const token = new Contract(await settlement.outcomeToken(), artifacts.OutcomeToken.abi, signers[0])
    const collateral = await deploy('TestCollateral')
    const oracle = await deploy('ResultOracle', [wallets[0].address, wallets[4].address, settlement.target])
    await mined(factory.setAllowedCollateral(collateral.target, true))
    await mined(factory.setAllowedOracle(oracle.target, true))
    const timestamp = BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp)
    const matchId = id('worker integration match')
    await mined(factory.createMarket(matchId, collateral.target, ['Red', 'Blue', 'Green'], timestamp + 1000n, timestamp + 2000n, oracle.target))
    const marketId = await factory.marketForMatch(matchId)
    for (const index of [1, 2]) {
      await mined(collateral.mint(wallets[index].address, 100_000_000n))
      await mined(collateral.connect(signers[index]).approve(settlement.target, MaxUint256))
      await mined(token.connect(signers[index]).setApprovalForAll(settlement.target, true))
    }
    await mined(settlement.connect(signers[1]).split(marketId, 12_000_000n))
    await mined(settlement.connect(signers[1]).merge(marketId, 2_000_000n))
    const config: ChainRuntimeConfig = { family: 'EVM', venue: 'EVM', chainId: '31337', rpcUrl: `http://127.0.0.1:${server.address().port}`, settlementAddress: settlement.target, factoryAddress: factory.target, oracleAddress: oracle.target, collateralToken: collateral.target, collateralDecimals: 6, worker: { confirmations: 1, discoveryStartBlock: 0n } }
    const store = new SqliteMatcherStore(database)
    const runtimeOptions = { database, configs: [config], store, writesEnabled: true, signers: new Map([[chainRuntimeKey('EVM', '31337'), { evm: privateKeyToAccount(secrets[0]) }]]) }
    let runtime = createChainRuntime(runtimeOptions)
    await runtime.worker.tick()
    expect(database.listMarkets('EVM', '31337')).toHaveLength(1)
    const gateway = runtime.gateways.get(chainRuntimeKey('EVM', '31337'))!
    const audience = 'http://prediction.test'
    const authenticator = new RequestAuthenticator(database, { verify: (proof, message, request) => gateway.verifyRequest(proof.account, message, proof.signature, request) }, audience)
    const api = createPredictionApi({ database, matcher: runtime.matcher, matcherStore: store, gateways: [gateway], authenticator, portfolio: runtime.portfolio, requireOrderProof: true, enforceFunding: true, acceptResult: runtime.acceptResult, marketForTrading: runtime.marketForTrading, controlToken: 'local-test-control-with-at-least-32-characters' })
    const makeOrder = async (index: number, side: 'BUY' | 'SELL', quantity: bigint): Promise<SignedOrder> => {
      const order: SignedOrder = { venue: 'EVM', chainId: '31337', orderId: '', maker: wallets[index].address, marketId, outcomeId: 0, side, quantity, price: side === 'BUY' ? 600_000n : 400_000n, nonce: 100n, expiresAt: Number(timestamp + 900n) * 1000, signature: '' }
      order.orderId = evmOrderId(order, config.settlementAddress)
      const typed = orderTypedData(order, config.settlementAddress)
      order.signature = await wallets[index].signTypedData(typed.domain, typed.types, typed.message)
      return order
    }
    const submit = async (order: SignedOrder, index: number) => {
      const path = '/orders?venue=EVM&chainId=31337'
      const body = stringify(order)
      const proof = { venue: 'EVM' as const, chainId: '31337', account: order.maker, nonce: crypto.randomUUID(), expiresAt: Date.now() + 30000, signature: '' }
      proof.signature = await wallets[index].signMessage(await requestAuthMessage(audience, 'POST', path, body, proof))
      const response = await api(new Request(audience + path, { method: 'POST', headers: proofHeaders(proof), body }))
      expect(response.status).toBe(202)
    }
    const sell = await makeOrder(1, 'SELL', 10_000_000n)
    const buy = await makeOrder(2, 'BUY', 4_000_000n)
    await submit(sell, 1)
    await submit(buy, 2)
    expect((await runtime.portfolio.getPositions('EVM', '31337', sell.maker)).find(row => row.outcomeId === 0)?.reservedQuantity).toBe(10_000_000n)
    const transport = runtime.transports.get(chainRuntimeKey('EVM', '31337'))!
    const submitTransaction = transport.submit.bind(transport)
    transport.submit = async plan => {
      await submitTransaction(plan)
      throw new Error('Simulated process/reply loss after chain broadcast and before matcher confirmation')
    }
    await runtime.worker.tick()
    const scope = { venue: 'EVM' as const, chainId: '31337', marketId }
    expect((await store.read(scope))?.fills).toHaveLength(0)
    expect(await token.balanceOf(buy.maker, await token.tokenId(marketId, 0))).toBe(4_000_000n)
    const submissions = database.sql.query<{ payload: string }, []>('SELECT payload FROM chain_submissions').all()
    expect(submissions).toHaveLength(1)
    expect(submissions[0]!.payload).toContain('"raw":"0x')
    const originalNonce = await provider.getTransactionCount(wallets[0].address)
    runtime = createChainRuntime(runtimeOptions)
    await runtime.worker.tick()
    expect((await store.read(scope))?.fills).toHaveLength(1)
    expect((await runtime.matcher.getSettlements(scope))[0]?.status).toBe('CONFIRMED')
    expect(await provider.getTransactionCount(wallets[0].address)).toBe(originalNonce)
    const positions = await runtime.portfolio.getPositions('EVM', '31337', buy.maker)
    expect(positions[0]?.quantity).toBe(4_000_000n)
    expect(positions[0]?.costBasis).toBe(1_600_000n)
    expect(positions[0]?.realizedPnl).toBe(0n)
    expect(positions[0]?.accountingComplete).toBe(true)
    expect(positions[0]?.provenance?.source).toBe('ONCHAIN')
    expect((await collateral.balanceOf(buy.maker))).toBe(98_400_000n)
    expect((await runtime.portfolio.getPositions('EVM', '31337', sell.maker)).find(row => row.outcomeId === 0)?.reservedQuantity).toBe(6_000_000n)
    const sellerPosition = (await runtime.portfolio.getPositions('EVM', '31337', sell.maker)).find(row => row.outcomeId === 0)!
    expect(sellerPosition.costBasis).toBe(2_000_001n)
    expect(sellerPosition.realizedPnl).toBe(266_668n)
    await mined(token.connect(signers[1]).safeTransferFrom(sell.maker, wallets[3].address, await token.tokenId(marketId, 2), 100_000n, '0x'))
    const unknown = await runtime.portfolio.getPositions('EVM', '31337', wallets[3].address)
    expect(unknown[0]?.quantity).toBe(100_000n)
    expect(unknown[0]?.accountingComplete).toBe(false)
    expect(unknown[0]?.costBasis).toBeNull()
    const result: SignedMatchResult = { venue: 'EVM', chainId: '31337', matchId, marketId, winningOutcomeId: 0, voided: false, stateHash: id('final SOLZ telemetry state'), matchEndedAt: Math.floor(Date.now() / 1000) * 1000, expiresAt: Number(timestamp + 1900n) * 1000, signature: '' }
    const typed = resultTypedData(result, config.oracleAddress)
    result.signature = await wallets[4].signTypedData(typed.domain, typed.types, typed.message)
    const wrong = await api(new Request(audience + '/internal/results', { method: 'POST', headers: { authorization: 'Bearer local-test-control-with-at-least-32-characters' }, body: stringify({ ...result, winningOutcomeId: 1 }) }))
    expect(wrong.status).toBe(400)
    const response = await api(new Request(audience + '/internal/results', { method: 'POST', headers: { authorization: 'Bearer local-test-control-with-at-least-32-characters' }, body: stringify(result) }))
    expect(response.status).toBe(202)
    expect(database.getMarket('EVM', '31337', marketId)?.paused).toBe(true)
    expect((await store.read(scope))?.orders.find(order => order.orderId === sell.orderId)?.status).toBe('CANCELLED')
    const rejectedQuote = await api(new Request(`${audience}/markets/${marketId}/quote?venue=EVM&chainId=31337`, { method: 'POST', body: stringify({ account: buy.maker, outcomeId: 0, side: 'BUY', quantity: 1_000_000n, slippageBps: 100 }) }))
    expect(rejectedQuote.ok).toBe(false)
    expect((await store.read(scope))?.market.paused).toBe(true)
    await runtime.worker.tick()
    expect((await settlement.getMarket(marketId)).status).toBe(3n)
    expect((await runtime.acceptResult(result)).status).toBe('CONFIRMED')
    const before = await collateral.balanceOf(buy.maker)
    await mined(settlement.connect(signers[2]).redeem(marketId))
    expect(await collateral.balanceOf(buy.maker)).toBe(before + 4_000_000n)
    const redeemed = await runtime.portfolio.getPositions('EVM', '31337', buy.maker)
    expect(redeemed).toHaveLength(1)
    expect(redeemed[0]?.quantity).toBe(0n)
    expect(redeemed[0]?.costBasis).toBe(0n)
    expect(redeemed[0]?.realizedPnl).toBe(2_400_000n)
    expect(redeemed[0]?.accountingComplete).toBe(true)
    await mined(settlement.connect(signers[3]).redeem(marketId))
    const unknownLoss = await runtime.portfolio.getPositions('EVM', '31337', wallets[3].address)
    expect(unknownLoss).toHaveLength(1)
    expect(unknownLoss[0]?.quantity).toBe(0n)
    expect(unknownLoss[0]?.realizedPnl).toBeNull()
    expect((await runtime.matcher.getSettlements(scope)).filter(plan => plan.status === 'CONFIRMED')).toHaveLength(1)
  } finally { database.close(); provider.destroy(); await server.close() }
}, 180000)
