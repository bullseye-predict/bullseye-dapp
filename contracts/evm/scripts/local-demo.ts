import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import ganache from 'ganache'
import { BrowserProvider, Contract, ContractFactory, MaxUint256, Wallet, id } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { compile } from './compile.mjs'
import { startPredictionApi } from '../../../apps/api/main'
import { SqliteMatcherStore } from '../../../apps/api/storage/matcher-store'
import { createChainRuntime, chainRuntimeKey } from '../../../apps/chain-worker/runtime'
import { createEvmOrderSigner } from '../../../packages/adapters/evm/EvmPredictionVenue'
import { PredictionTradingClient } from '../../../packages/sdk/PredictionTradingClient'
import { stringify } from '../../../packages/prediction-core/serialization'

// This launcher owns only a new loopback Ganache chain. It never reads wallet keys.
if (!process.argv.includes('--local-demo')) throw new Error('Use --local-demo to start an isolated test-funds chain.')
const chainId = 31337
const server = ganache.server({ chain: { chainId, hardfork: 'shanghai' }, wallet: { totalAccounts: 6 }, logging: { quiet: true } })
await server.listen(Number(process.env.PREDICTION_LOCAL_RPC_PORT ?? 8545), '127.0.0.1')
const provider = new BrowserProvider(server.provider, undefined, { cacheTimeout: -1, pollingInterval: 20 })
let api: ReturnType<typeof startPredictionApi> | undefined
let workerDone: Promise<void> | undefined
const controller = new AbortController()
let stopping = false
const stop = async () => {
  if (stopping) return
  stopping = true; controller.abort()
  await workerDone?.catch(() => {})
  api?.stop(); provider.destroy(); await server.close()
}
process.once('SIGINT', () => void stop())
process.once('SIGTERM', () => void stop())

try {
  const artifacts = compile({ write: false, test: true })
  const keys = Object.values(server.provider.getInitialAccounts()).map(value => value.secretKey)
  const accounts = keys.map(key => privateKeyToAccount(key))
  const wallets = keys.map(key => new Wallet(key))
  const signers = await Promise.all(wallets.map(wallet => provider.getSigner(wallet.address)))
  const deploy = async (name: string, args: unknown[] = []) => {
    const contract = await new ContractFactory(artifacts[name].abi, artifacts[name].bytecode, signers[0]).deploy(...args)
    await contract.waitForDeployment(); return contract
  }
  const mined = async (transaction: Promise<any>) => (await transaction).wait()
  const factory = await deploy('PredictionMarketFactory', [wallets[0].address, 16])
  const settlement = new Contract(await factory.settlement(), artifacts.PredictionMarket.abi, signers[0])
  const token = new Contract(await settlement.outcomeToken(), artifacts.OutcomeToken.abi, signers[0])
  const collateral = await deploy('TestCollateral')
  const oracle = await deploy('ResultOracle', [wallets[0].address, wallets[4].address, settlement.target])
  await mined(factory.setAllowedCollateral(collateral.target, true)); await mined(factory.setAllowedOracle(oracle.target, true))
  const timestamp = BigInt((await provider.send('eth_getBlockByNumber', ['latest', false])).timestamp)
  const matchId = id(`SOLZ isolated local test ${timestamp}`)
  await mined(factory.createMarket(matchId, collateral.target, ['Red team', 'Blue team', 'Green team'], timestamp + 86_400n, timestamp + 172_800n, oracle.target))
  const marketId = await factory.marketForMatch(matchId)
  for (const index of [1, 2]) {
    await mined(collateral.mint(wallets[index].address, 1_000_000_000n))
    await mined(collateral.connect(signers[index]).approve(settlement.target, MaxUint256))
    await mined(token.connect(signers[index]).setApprovalForAll(settlement.target, true))
    await mined(settlement.connect(signers[index]).split(marketId, 200_000_000n))
  }
  const rpcUrl = `http://127.0.0.1:${server.address().port}`
  const config = { family: 'EVM' as const, venue: 'EVM' as const, chainId: String(chainId), label: 'Local EVM · test funds', rpcUrl, publicRpcUrl: rpcUrl, settlementAddress: settlement.target, factoryAddress: factory.target, oracleAddress: oracle.target, collateralToken: collateral.target, collateralDecimals: 6, collateralSymbol: 'TEST', worker: { confirmations: 1, discoveryStartBlock: 0n } }
  mkdirSync(resolve('.data'), { recursive: true })
  const directory = mkdtempSync(resolve('.data/prediction-local-'))
  const configPath = join(directory, 'venues.json')
  writeFileSync(configPath, stringify([config]), { mode: 0o600 })
  const port = Number(process.env.PREDICTION_LOCAL_API_PORT ?? 8788)
  const baseUrl = `http://127.0.0.1:${port}`
  api = startPredictionApi({ PREDICTION_HOST: '127.0.0.1', PREDICTION_PORT: String(port), PREDICTION_AUTH_AUDIENCE: baseUrl, PREDICTION_DATABASE_PATH: join(directory, 'prediction.sqlite'), PREDICTION_VENUES_FILE: configPath, PREDICTION_ALLOWED_ORIGINS: 'http://127.0.0.1:4321,http://localhost:4321' })
  const runtime = createChainRuntime({ database: api.database, configs: [config], store: new SqliteMatcherStore(api.database), matcher: api.matcher, writesEnabled: true, signers: new Map([[chainRuntimeKey('EVM', String(chainId)), { evm: accounts[0] }]]) })
  await runtime.worker.tick()
  let nonce = 1n
  const client = (index: number) => new PredictionTradingClient({ baseUrl, audience: baseUrl, venue: 'EVM', chainId: String(chainId), account: accounts[index].address,
    signOrder: createEvmOrderSigner(config, accounts[index].address, { nextNonce: async () => nonce++, signTypedData: value => accounts[index].signTypedData(value) }), signRequest: message => accounts[index].signMessage({ message }), redeem: async () => { throw new Error('Use the owner wallet to redeem.') },
  })
  const seller = client(1), buyer = client(2)
  const expiresAt = Number(timestamp + 80_000n) * 1000
  await seller.placeOrder({ marketId, outcomeId: 0, side: 'SELL', price: 440_000n, quantity: 2_000_000n, expiresAt })
  await buyer.placeOrder({ marketId, outcomeId: 0, side: 'BUY', price: 450_000n, quantity: 2_000_000n, expiresAt })
  await runtime.worker.tick(); await runtime.worker.tick()
  for (let outcomeId = 0; outcomeId < 3; outcomeId++) {
    const midpoint = [440_000n, 330_000n, 220_000n][outcomeId]
    for (let level = 1; level <= 4; level++) {
      await seller.placeOrder({ marketId, outcomeId, side: 'SELL', price: midpoint + BigInt(level) * 10_000n, quantity: BigInt(level + 2) * 1_000_000n, expiresAt })
      await buyer.placeOrder({ marketId, outcomeId, side: 'BUY', price: midpoint - BigInt(level) * 10_000n, quantity: BigInt(level + 2) * 1_000_000n, expiresAt })
    }
  }
  workerDone = runtime.worker.run(controller.signal)
  console.log(`Isolated local prediction stack ready. API: ${baseUrl}. RPC: ${rpcUrl}. Chain: ${chainId}.`)
  console.log(`Public deployment config: ${configPath}. No real tokens or user wallet keys are used.`)
  console.log(`Start the frontend with PUBLIC_PREDICTION_API_URL=${baseUrl} bun run dev, then open /live.`)
  await workerDone
} catch (error) {
  console.error('Local prediction stack failed:', error instanceof Error ? error.message : 'unknown error')
  process.exitCode = 1
} finally { await stop() }
