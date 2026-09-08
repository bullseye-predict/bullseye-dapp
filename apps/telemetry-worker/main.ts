import { mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseEvmConfig } from '../../packages/adapters/config'
import { parseSolanaConfig } from '../../packages/adapters/solana/gateway'
import { invariant, record } from '../../packages/prediction-core/validation'
import { PredictionPublisher } from '../../packages/telemetry/publisher'
import { parseSignedMatchResult, verifyResult } from '../chain-worker/results'
import { ColyseusSpectatorTransport } from './colyseus'
import { parseTelemetryWorkerConfig } from './config'
import { TelemetryWorkerStore } from './store'
import { TelemetryObserverWorker } from './worker'

/** Run with bun run apps/telemetry-worker/main.ts; all server secrets stay in this process. */
export function startTelemetryWorker(environment: Record<string, string | undefined> = process.env) {
  invariant(environment.PREDICTION_TELEMETRY_WORKER_FILE, 'INVALID_CONFIG', 'PREDICTION_TELEMETRY_WORKER_FILE is required.')
  const config = parseTelemetryWorkerConfig(JSON.parse(readFileSync(environment.PREDICTION_TELEMETRY_WORKER_FILE, 'utf8')))
  const secret = environment.PREDICTION_TELEMETRY_SECRET ?? ''
  const resultEnabled = config.rooms.some(room => room.resultMarkets.length)
  invariant(!resultEnabled || (environment.PREDICTION_CONTROL_TOKEN && environment.PREDICTION_CONTROL_TOKEN.length >= 32 && environment.PREDICTION_CONTROL_TOKEN !== secret && environment.PREDICTION_VENUES_FILE), 'INVALID_CONFIG', 'Results require a distinct PREDICTION_CONTROL_TOKEN and PREDICTION_VENUES_FILE.')
  const raw: unknown = resultEnabled ? JSON.parse(readFileSync(environment.PREDICTION_VENUES_FILE!, 'utf8')) : []
  invariant(Array.isArray(raw), 'INVALID_CONFIG', 'Venue configuration must be an array.')
  const configs = raw.map(input => record(input).family === 'SOLANA' ? parseSolanaConfig(input) : parseEvmConfig(input))
  invariant(new Set(configs.map(value => JSON.stringify([value.venue, value.chainId]))).size === configs.length, 'INVALID_CONFIG', 'Duplicate result verification configuration.')
  for (const room of config.rooms) for (const market of room.resultMarkets) invariant(configs.some(value => value.venue === market.venue && value.chainId === market.chainId), 'INVALID_CONFIG', 'Every allowed result market needs a chain verifier.')
  const publisher = new PredictionPublisher({ predictionApiUrl: config.predictionApiUrl, telemetrySecret: secret, resultSinkUrl: config.resultSinkUrl, controlToken: environment.PREDICTION_CONTROL_TOKEN, timeoutMs: config.connectTimeoutMs })
  if (config.statePath !== ':memory:') mkdirSync(dirname(config.statePath), { recursive: true })
  const store = new TelemetryWorkerStore(config.statePath)
  const worker = new TelemetryObserverWorker(config, { store, publisher, transport: new ColyseusSpectatorTransport(config.colyseusUrl, config.connectTimeoutMs),
    parseResult: parseSignedMatchResult,
    verifyResult: async result => { const chain = configs.find(value => value.venue === result.venue && value.chainId === result.chainId); return chain ? verifyResult(result, chain) : false },
    log: (event, details) => console.info(JSON.stringify({ service: 'telemetry-worker', event, ...details })),
  })
  worker.start()
  let stopping: Promise<void> | undefined
  return { worker, store, stop: () => stopping ??= worker.stop().finally(() => store.close()) }
}
if (import.meta.main) {
  const runtime = startTelemetryWorker()
  const stop = () => { void runtime.stop().catch(() => { process.exitCode = 1 }) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
