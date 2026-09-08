import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { PredictionDatabase } from './storage/database'
import { SqliteMatcherStore } from './storage/matcher-store'
import { MatchingEngine } from '../matcher/matching-engine'
import { EvmChainGateway } from '../../packages/adapters/evm/gateway'
import { SolanaChainGateway, parseSolanaConfig } from '../../packages/adapters/solana/gateway'
import { parseEvmConfig } from '../../packages/adapters/config'
import { RequestAuthenticator } from './auth/requests'
import { TelemetryBridge } from '../../packages/telemetry/bridge'
import { createPredictionApi, gatewayKey } from './server'
import { marketKey, venueId, textField, integer, record } from '../../packages/prediction-core/validation'
import { stringify } from '../../packages/prediction-core/serialization'
import { publicVenueConfig } from './public-config'
import { createChainRuntime, parseChainRuntimeConfig } from '../chain-worker/runtime'
import { DurableHermesControl } from '../hermes-worker/control'
import { createHermesVaultReader, loadHermesRuntimeConfig } from '../hermes-worker/runtime'

/** Host-only environment access; secrets and RPC configuration never enter React props. */
export function startPredictionApi(environment: Record<string, string | undefined> = process.env) {
  const path = environment.PREDICTION_DATABASE_PATH ?? '.data/prediction.sqlite'
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const database = new PredictionDatabase(path)
  const store = new SqliteMatcherStore(database)
  const configFile = environment.PREDICTION_VENUES_FILE
  const raw: unknown = configFile ? JSON.parse(readFileSync(configFile, 'utf8')) : []
  if (!Array.isArray(raw)) throw new Error('PREDICTION_VENUES_FILE must contain an array of explicit venue configurations.')
  const gateways = raw.map(value => record(value).family === 'SOLANA' ? new SolanaChainGateway(parseSolanaConfig(value)) : new EvmChainGateway(parseEvmConfig(value)))
  const gatewayMap = new Map(gateways.map(gateway => [gatewayKey(gateway.config.venue, gateway.config.chainId), gateway]))
  if (gatewayMap.size !== gateways.length) throw new Error('Duplicate venue/chain configuration.')
  const matcher = new MatchingEngine({ store, verifier: { verify: async order => await gatewayMap.get(gatewayKey(order.venue, order.chainId))?.verifyOrder(order) ?? false } })
  const port = integer(Number(environment.PREDICTION_PORT ?? 8788), 'PREDICTION_PORT', 0, 65535)
  const hostname = environment.PREDICTION_HOST ?? '127.0.0.1'
  const audience = environment.PREDICTION_AUTH_AUDIENCE ?? `http://${hostname}:${port}`
  const authenticator = new RequestAuthenticator(database, { verify: async (proof, message, request) => await gatewayMap.get(gatewayKey(proof.venue, proof.chainId))?.verifyRequest(proof.account, message, proof.signature, request) ?? false }, audience)
  const telemetry = environment.PREDICTION_TELEMETRY_SECRET ? new TelemetryBridge(database, environment.PREDICTION_TELEMETRY_SECRET) : undefined
  const chain = raw.length ? createChainRuntime({ database, configs: raw.map(parseChainRuntimeConfig), store, matcher, writesEnabled: false }) : undefined
  const hermesConfig = loadHermesRuntimeConfig(environment)
  if (hermesConfig && hermesConfig.audience !== audience) throw new Error('Hermes and API request audiences must match.')
  const hermes = hermesConfig ? new DurableHermesControl(database, hermesConfig.accounts, {
    readVaultLimits: createHermesVaultReader(gateways.map(gateway => gateway.config)),
  }) : undefined
  const allowedOrigins = (environment.PREDICTION_ALLOWED_ORIGINS ?? 'http://localhost:4321,http://127.0.0.1:4321').split(',').map(value => value.trim()).filter(Boolean).map(value => new URL(value).origin)
  const handler = createPredictionApi({ database, matcher, matcherStore: store, gateways, authenticator, telemetry, controlToken: environment.PREDICTION_CONTROL_TOKEN,
    publicConfig: { audience, venues: raw.map(publicVenueConfig) }, allowedOrigins, enforceFunding: true, requireOrderProof: true,
    portfolio: chain?.portfolio, acceptResult: chain?.acceptResult, marketForTrading: chain?.marketForTrading, hermes,
  })

  const server = Bun.serve<{ topic: string; sequence: number }>({
    hostname, port, maxRequestBodySize: 64 * 1024,
    fetch(request, server) {
      const url = new URL(request.url)
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const origin = request.headers.get('origin')
        if (origin && !allowedOrigins.includes(origin)) return new Response('Origin denied', { status: 403 })
        try {
          const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
          let topic: string
          if (parts.length === 2 && parts[0] === 'matches') topic = `matches:${textField(parts[1], 'matchId')}`
          else if (parts.length === 2 && parts[0] === 'markets') topic = `markets:${marketKey(venueId(url.searchParams.get('venue')), textField(url.searchParams.get('chainId'), 'chainId'), textField(parts[1], 'marketId'))}`
          else return new Response('Unknown feed', { status: 404 })
          const sequence = integer(Number(url.searchParams.get('after') ?? 0), 'after')
          if (server.upgrade(request, { data: { topic, sequence } })) return
        } catch { return new Response('Invalid subscription', { status: 400 }) }
        return new Response('Upgrade failed', { status: 400 })
      }
      return handler(request)
    },
    websocket: {
      maxPayloadLength: 1024,
      backpressureLimit: 128 * 1024,
      closeOnBackpressureLimit: true,
      open(socket) { sockets.add(socket) },
      message(socket) { socket.close(1008, 'This is a read-only market feed.') },
      close(socket) { sockets.delete(socket) },
    },
  })
  const sockets = new Set<Bun.ServerWebSocket<{ topic: string; sequence: number }>>()
  const timer = setInterval(() => {
    for (const socket of sockets) {
      for (const event of database.eventsAfter(socket.data.topic, socket.data.sequence)) {
        const sent = socket.send(stringify(event))
        if (sent === 0) break
        socket.data.sequence = event.sequence
        if (sent === -1) break
      }
    }
  }, 250)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    for (const socket of sockets) socket.close(1001, 'Server stopping')
    server.stop(true)
    database.close()
  }
  return { server, stop, database, matcher }
}

if (import.meta.main) {
  const app = startPredictionApi()
  console.log(`SOLZ prediction API listening at ${app.server.url}`)
  process.once('SIGINT', app.stop)
  process.once('SIGTERM', app.stop)
}
