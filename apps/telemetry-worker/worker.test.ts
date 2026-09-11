import { expect, test } from 'bun:test'
import { encode } from '@colyseus/schema'
import { pack } from '@colyseus/msgpackr'
import type { ServerWebSocket } from 'bun'
import { TelemetryBridge, telemetrySignature } from '../../packages/telemetry/bridge'
import { PredictionPublisher } from '../../packages/telemetry/publisher'
import type { MatchTelemetry, SignedMatchResult } from '../../packages/prediction-core/types'
import { PredictionError } from '../../packages/prediction-core/validation'
import { ColyseusSpectatorTransport } from './colyseus'
import { TelemetryWorkerStore } from './store'
import { TelemetryObserverWorker, discoverBoundRooms } from './worker'
import { eventually, sourceSnapshot, workerConfig } from './fixtures'
import { parseSignedMatchResult } from '../chain-worker/results'
import { solanaResultDigest, verifySolanaResultAttestation } from '../../packages/adapters/solana/results'
import { PublicKey } from '@solana/web3.js'

const secret = 'telemetry-secret-for-fixtures-only-12345678'
const controlToken = 'control-token-distinct-for-fixtures-123456'
function frame(type: string, value: unknown) {
  const head = Buffer.alloc(512), iterator = { offset: 1 }
  head[0] = 13; encode.string(head, type, iterator)
  return Buffer.concat([head.subarray(0, iterator.offset), pack(value)])
}
function fixture(options: { loseFirstAck?: boolean; disconnectFirst?: boolean; withActivity?: boolean } = {}) {
  const received = new Map<string, MatchTelemetry>(), posts: string[] = [], results: string[] = []
  const joins: Record<string, unknown>[] = [], sockets = new Set<ServerWebSocket<{ joined: boolean }>>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const gameFrames: number[] = []
  let lost = false, disconnected = false
  const bridge = new TelemetryBridge({ telemetry: id => received.get(id), saveTelemetry(value) {
    const previous = received.get(value.matchId)
    if (previous && (value.sequence <= previous.sequence || value.timestamp < previous.timestamp)) return false
    received.set(value.matchId, value); return true
  } }, secret)
  const server = Bun.serve<{ joined: boolean }>({ hostname: '127.0.0.1', port: 0,
    async fetch(request, server) {
      const url = new URL(request.url)
      if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        if (server.upgrade(request, { data: { joined: false } })) return
        return new Response('upgrade failed', { status: 400 })
      }
      if (url.pathname === '/matchmake/joinById/room_a') {
        joins.push(await request.json() as Record<string, unknown>)
        return Response.json({ room: { roomId: 'room_a', processId: 'proc', name: 'fixture' }, sessionId: `session${joins.length}` })
      }
      if (url.pathname === '/activity') return Response.json({ tokens: [{ symbol: 'SOLZ', matches: [{ roomId: 'room_a', id: 'game_a', watchable: true }, { roomId: 'unbound_room', id: 'game_z', watchable: true }] }] })
      if (url.pathname === '/internal/telemetry') {
        const body = await request.text(); posts.push(body)
        try {
          bridge.ingest(body, request.headers.get('x-solz-telemetry-signature') ?? '')
          if (options.loseFirstAck && !lost) { lost = true; return Response.json({ code: 'SIMULATED_ACK_LOSS' }, { status: 503 }) }
          return Response.json({ accepted: true })
        } catch (error) { return Response.json({ code: error instanceof PredictionError ? error.code : 'BAD_BODY' }, { status: 400 }) }
      }
      if (url.pathname === '/internal/results') {
        if (request.headers.get('authorization') !== `Bearer ${controlToken}`) return new Response('unauthorized', { status: 401 })
        results.push(await request.text()); return Response.json({ queued: true })
      }
      if (/^\/matches\/.+\/telemetry$/.test(url.pathname)) {
        const id = decodeURIComponent(url.pathname.split('/')[2]!), value = received.get(id)
        return value ? Response.json(value) : new Response('missing', { status: 404 })
      }
      return new Response('unknown', { status: 404 })
    }, websocket: {
      open(socket) { sockets.add(socket); socket.send(Buffer.from([10, 1, 120, 4, ...Buffer.from('none')])) },
      message(socket, input) {
        const bytes = typeof input === 'string' ? Buffer.from(input) : input
        gameFrames.push(bytes[0]!)
        if (bytes[0] === 10 && !socket.data.joined) {
          socket.data.joined = true
          const timer = setTimeout(() => {
            timers.delete(timer)
            socket.send(frame('snapshot', sourceSnapshot(Date.now())))
            if (options.disconnectFirst && !disconnected) {
              disconnected = true
              const closer = setTimeout(() => { timers.delete(closer); socket.close(1012, 'fixture reconnect') }, 40)
              timers.add(closer)
            }
          }, 5)
          timers.add(timer)
        }
      }, close(socket) { sockets.delete(socket) },
    },
  })
  const url = `http://127.0.0.1:${server.port}`
  return { url, received, posts, results, joins, sockets, gameFrames,
    send(type: string, input: unknown) { for (const socket of sockets) if (socket.data.joined) socket.send(frame(type, input)) },
    close() { for (const timer of timers) clearTimeout(timer); for (const socket of sockets) socket.close(); server.stop(true) },
  }
}

test('real Colyseus 0.16 spectator client discovers only configured rooms, reconnects, authenticates and reconciles lost API acknowledgements', async () => {
  const local = fixture({ loseFirstAck: true, disconnectFirst: true })
  const config = workerConfig({ colyseusUrl: local.url.replace('http:', 'ws:'), predictionApiUrl: local.url, activityUrl: `${local.url}/activity` })
  const store = new TelemetryWorkerStore(':memory:')
  const logs: string[] = []
  const worker = new TelemetryObserverWorker(config, { store, publisher: new PredictionPublisher({ predictionApiUrl: local.url, telemetrySecret: secret }), transport: new ColyseusSpectatorTransport(config.colyseusUrl, 300), log: event => logs.push(event), random: () => 0 })
  try {
    worker.start()
    await eventually(() => local.joins.length >= 2 && local.received.size === 1 && store.pending().length === 0)
    expect(local.posts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(local.gameFrames)).toEqual(new Set([10]))
    for (const join of local.joins) {
      expect(join.spectator).toBe(true); expect(join.observer).toBe(true); expect(join.mode).toBe('spectator'); expect(join.joinMode).toBe('spectator')
      expect(JSON.stringify(join)).not.toContain(secret); expect(JSON.stringify(join)).not.toContain(controlToken)
    }
    expect(local.joins[0]!.playerId).not.toBe(local.joins[1]!.playerId)
    const snapshot = [...local.received.values()][0]!
    expect(snapshot.participants).toHaveLength(2)
    expect(snapshot.sequence).toBeGreaterThanOrEqual(1)
    await worker.stop()
    await eventually(() => local.sockets.size === 0)
    const count = local.joins.length
    await Bun.sleep(80)
    expect(local.joins.length).toBe(count)
  } finally { await worker.stop(); store.close(); local.close() }
})

test('HMAC authenticates the exact body and rejects tampering and stale source clocks', async () => {
  const local = fixture()
  const config = workerConfig(), now = Date.now()
  const body = JSON.stringify({ matchId: config.rooms[0]!.matchId, sequence: 1, timestamp: now, remainingMs: 1000, participants: [{ id: 'a', hp: 1, maxHp: 1, alive: true, kills: 0 }], kills: [], score: {}, objectives: {} })
  try {
    const bad = await fetch(`${local.url}/internal/telemetry`, { method: 'POST', headers: { 'x-solz-telemetry-signature': telemetrySignature(body, secret) }, body: `${body} ` })
    expect((await bad.json() as { code: string }).code).toBe('UNAUTHORIZED_TELEMETRY')
    const stale = JSON.stringify({ ...JSON.parse(body), timestamp: now - 20_000 })
    const response = await fetch(`${local.url}/internal/telemetry`, { method: 'POST', headers: { 'x-solz-telemetry-signature': telemetrySignature(stale, secret) }, body: stale })
    expect((await response.json() as { code: string }).code).toBe('STALE_TELEMETRY')
    expect(local.received.size).toBe(0)
  } finally { local.close() }
})

test('only correctly signed, explicitly allowed authority results reach the independent result sink', async () => {
  const local = fixture(), base = workerConfig(), keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const publicKey = new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))).toBase58()
  const chain = { programId: new PublicKey(new Uint8Array(32).fill(3)).toBase58(), chainId: new PublicKey(new Uint8Array(32).fill(4)).toBase58(), networkDomain: '11'.repeat(32), oracleAuthority: publicKey }
  const marketId = new PublicKey(new Uint8Array(32).fill(5)).toBase58()
  base.rooms[0]!.resultMarkets = [{ venue: 'SOLANA', chainId: chain.chainId, marketId }]
  const config = workerConfig({ ...base, colyseusUrl: local.url.replace('http:', 'ws:'), predictionApiUrl: local.url, resultSinkUrl: `${local.url}/internal/results` })
  const store = new TelemetryWorkerStore(':memory:')
  const logs: string[] = []
  const worker = new TelemetryObserverWorker(config, { store, publisher: new PredictionPublisher({ predictionApiUrl: local.url, telemetrySecret: secret, resultSinkUrl: config.resultSinkUrl, controlToken }), transport: new ColyseusSpectatorTransport(config.colyseusUrl, 300), parseResult: parseSignedMatchResult, verifyResult: result => verifySolanaResultAttestation(result, chain), log: event => logs.push(event) })
  const now = Math.floor(Date.now() / 1000) * 1000
  const result: SignedMatchResult = { matchId: base.rooms[0]!.matchId, venue: 'SOLANA', chainId: chain.chainId, marketId, winningOutcomeId: 1, voided: false, stateHash: `0x${'bb'.repeat(32)}`, matchEndedAt: now, expiresAt: now + 60_000, signature: '' }
  const signature = await crypto.subtle.sign('Ed25519', keys.privateKey, await solanaResultDigest(result, chain) as Uint8Array<ArrayBuffer>)
  result.signature = JSON.stringify({ scheme: 'SOLZ_SOLANA_RESULT_V1', signature: Buffer.from(signature).toString('hex') })
  try {
    worker.start()
    await eventually(() => local.received.size === 1)
    local.send('match:result', { winnerId: 'a' })
    local.send('prediction:signed-result', { ...result, winningOutcomeId: 0 })
    // A legitimate result arriving during verification of an invalid result must not be lost.
    local.send('prediction:signed-result', result)
    await eventually(() => logs.includes('result_rejected'))
    await eventually(() => local.results.length === 1)
    expect(JSON.parse(local.results[0]!)).toEqual(result)
    local.send('prediction:signed-result', result)
    await Bun.sleep(50)
    expect(local.results).toHaveLength(1)
  } finally { await worker.stop(); store.close(); local.close() }
})

test('shutdown aborts an unfinished Colyseus handshake and closes its socket', async () => {
  const sockets = new Set<ServerWebSocket<undefined>>()
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(request, server) {
    if (request.headers.get('upgrade')) { if (server.upgrade(request)) return; return new Response('bad', { status: 400 }) }
    return Response.json({ room: { roomId: 'room_a', processId: 'p', name: 'fixture' }, sessionId: 's' })
  }, websocket: { open(socket) { sockets.add(socket) }, message() {}, close(socket) { sockets.delete(socket) } } })
  const controller = new AbortController()
  const observe = new ColyseusSpectatorTransport(`ws://127.0.0.1:${server.port}`, 5000).observe(workerConfig().rooms[0]!, () => {}, controller.signal)
  // Attach rejection immediately to avoid an unhandled promise when the abort fires.
  const stopped = observe.catch(() => {})
  try { await eventually(() => sockets.size === 1); controller.abort(); await stopped; await eventually(() => sockets.size === 0) }
  finally { controller.abort(); server.stop(true) }
})

test('activity IDs cannot bind a reused room to the previous prediction match', () => {
  const rooms = workerConfig().rooms
  expect([...discoverBoundRooms({ matches: [{ roomId: 'room_a', id: 'new_match' }, { roomId: 'foreign_room', id: 'game_a' }] }, rooms)]).toEqual([])
})
