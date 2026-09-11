import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { Keypair } from '@solana/web3.js'
import { privateKeyToAccount } from 'viem/accounts'
import { PredictionDatabase } from '../api/storage/database'
import { integer, invariant } from '../../packages/prediction-core/validation'
import { chainRuntimeKey, createChainRuntime, parseChainRuntimeConfig, type ChainSigners } from './runtime'

/** Host-only key access. Without the explicit write switch, named key variables are never read. */
export function startChainWorker(environment: Record<string, string | undefined> = process.env) {
  const path = environment.PREDICTION_DATABASE_PATH ?? '.data/prediction.sqlite'
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const raw: unknown = environment.PREDICTION_VENUES_FILE ? JSON.parse(readFileSync(environment.PREDICTION_VENUES_FILE, 'utf8')) : []
  invariant(Array.isArray(raw), 'INVALID_CONFIG', 'Venue configuration file must contain an array.')
  const configs = raw.map(parseChainRuntimeConfig)
  const writesEnabled = environment.PREDICTION_CHAIN_WRITES === '1'
  const signers = new Map<string, ChainSigners>()
  if (writesEnabled) for (const config of configs) {
    const settings = config.worker
    if (!settings?.relayerKeyEnv) continue
    const value = environment[settings.relayerKeyEnv]
    invariant(value, 'MISSING_RELAYER', 'An explicitly named relayer secret is missing.')
    if (config.family === 'EVM') {
      invariant(/^0x[0-9a-fA-F]{64}$/.test(value), 'INVALID_RELAYER', 'EVM relayer secret must be a 32-byte hex private key.')
      signers.set(chainRuntimeKey(config.venue, config.chainId), { evm: privateKeyToAccount(value as `0x${string}`) })
    } else {
      const decode = (encoded: string): Keypair => {
        const bytes: unknown = JSON.parse(encoded)
        invariant(Array.isArray(bytes) && bytes.length === 64 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'INVALID_RELAYER', 'Solana secret must be a JSON array of 64 bytes.')
        return Keypair.fromSecretKey(Uint8Array.from(bytes))
      }
      const oracleValue = settings.oracleKeyEnv ? environment[settings.oracleKeyEnv] : undefined
      invariant(!settings.oracleKeyEnv || oracleValue, 'MISSING_ORACLE', 'An explicitly named oracle secret is missing.')
      const oracle = oracleValue ? decode(oracleValue) : undefined
      invariant(!oracle || oracle.publicKey.toBase58() === config.oracleAuthority, 'WRONG_ORACLE', 'Oracle transaction signer does not match the deployment.')
      signers.set(chainRuntimeKey(config.venue, config.chainId), { solana: decode(value), oracle })
    }
  }
  const database = new PredictionDatabase(path)
  const runtime = createChainRuntime({ database, configs, writesEnabled, signers, onError: (_error, scope) => {
    // RPC exceptions can contain credentials in URLs; never print their raw text.
    console.error('Chain worker operation failed; reservations retained where transaction status is uncertain.', scope ? { venue: scope.venue, chainId: scope.chainId, marketId: scope.marketId } : {})
  } })
  const controller = new AbortController()
  const interval = integer(Number(environment.PREDICTION_CHAIN_INTERVAL_MS ?? 1000), 'PREDICTION_CHAIN_INTERVAL_MS', 100, 60_000)
  const completed = runtime.worker.run(controller.signal, interval).finally(() => database.close())
  const stop = () => controller.abort()
  return { ...runtime, completed, stop, writesEnabled, venueCount: configs.length }
}

if (import.meta.main) {
  const app = startChainWorker()
  console.log(`SOLZ chain worker started for ${app.venueCount} venue(s); transaction writes ${app.writesEnabled ? 'explicitly enabled for configured signers' : 'disabled'}.`)
  process.once('SIGINT', app.stop)
  process.once('SIGTERM', app.stop)
  await app.completed
}
