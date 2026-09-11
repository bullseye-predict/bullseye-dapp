import { parseTelemetryWorkerConfig } from './config'

export function workerConfig(overrides: Record<string, unknown> = {}) {
  return parseTelemetryWorkerConfig({
    colyseusUrl: 'ws://127.0.0.1:2567', predictionApiUrl: 'http://127.0.0.1:8788', statePath: ':memory:',
    reconnectMinMs: 10, reconnectMaxMs: 50, connectTimeoutMs: 300, discoveryIntervalMs: 50, publishIntervalMs: 10,
    rooms: [{ roomId: 'room_a', sourceMatchId: 'game_a', matchId: `0x${'aa'.repeat(32)}`, casualGuest: true,
      outcomes: [{ outcomeId: 0, entityId: 'red', participantIds: ['a'], scoreSourceKey: 'RED' }, { outcomeId: 1, entityId: 'blue', sourceTeamId: 'BLUE', scoreSourceKey: 'BLUE' }],
      schema: { timestampPath: 'timestamp', matchIdPath: 'match.id', endsAtPath: 'match.endsAt', alivePath: 'alive', scorePath: 'score', killsPath: 'killEvents', playerUpdateMessage: 'player:update', matchUpdateMessage: 'match:update', matchPayloadPath: 'match', resultMessage: 'prediction:signed-result' },
    }], ...overrides,
  })
}
export function sourceSnapshot(timestamp: number, hp = 100) {
  return { timestamp, match: { id: 'game_a', endsAt: timestamp + 60_000 }, players: [
    { id: 'a', hp, hpMax: 100, kills: 1, alive: true },
    { id: 'b', teamId: 'BLUE', hp: 80, hpMax: 100, kills: 0, alive: true },
    { id: 'watcher', spectator: true },
  ], score: { RED: 1, BLUE: 0 }, killEvents: [] }
}
export async function eventually(check: () => boolean, timeout = 3000) {
  const started = Date.now()
  while (!check()) {
    if (Date.now() - started >= timeout) throw new Error('Timed out waiting for fixture condition.')
    await Bun.sleep(5)
  }
}
