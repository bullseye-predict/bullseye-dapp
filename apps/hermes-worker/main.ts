import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PredictionDatabase } from '../api/storage/database'
import { DurableHermesControl } from './control'
import { createHermesAccountServices, createHermesTelemetrySource, createHermesVaultReader, HermesRuntime, HttpHermesReasoner, loadHermesRuntimeConfig, loadHermesVenueConfigs } from './runtime'

/** Separate process host. No worker or API may infer keys, accounts, or deployments. */
export function startHermesWorker(environment: Record<string, string | undefined> = process.env) {
  const config = loadHermesRuntimeConfig(environment)
  if (!config) throw new Error('PREDICTION_HERMES_FILE is required to run Hermes')
  const venues = loadHermesVenueConfigs(environment)
  const path = environment.PREDICTION_DATABASE_PATH ?? '.data/prediction.sqlite'
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const token = config.reasoner.tokenEnv ? environment[config.reasoner.tokenEnv] : undefined
  if (config.reasoner.tokenEnv && !token) throw new Error('Configured Hermes reasoner token is unavailable')
  const database = new PredictionDatabase(path)
  const control = new DurableHermesControl(database, config.accounts, { readVaultLimits: createHermesVaultReader(venues) })
  const runtime = new HermesRuntime({ database, control, pollIntervalMs: config.pollIntervalMs,
    reasoner: new HttpHermesReasoner({ url: config.reasoner.url, token, timeoutMs: config.reasoner.timeoutMs }), telemetry: createHermesTelemetrySource(config.apiBaseUrl),
    createServices: createHermesAccountServices({ config, venues, database, control, environment }),
  })
  const abort = new AbortController()
  let closed = false
  const done = runtime.run(abort.signal).finally(() => { if (!closed) { closed = true; database.close() } })
  const stop = async () => { abort.abort(); await done }
  return { runtime, control, database, done, stop }
}

if (import.meta.main) {
  const worker = startHermesWorker()
  process.once('SIGINT', () => { void worker.stop() })
  process.once('SIGTERM', () => { void worker.stop() })
  await worker.done
}
