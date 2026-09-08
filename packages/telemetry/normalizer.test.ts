import { describe, expect, test } from 'bun:test'
import { RoomTelemetryNormalizer } from './normalizer'
import { workerConfig, sourceSnapshot } from '../../apps/telemetry-worker/fixtures'

const now = 1_700_000_000_000
describe('authoritative room normalization', () => {
  test('uses explicit outcome entities, preserves server time, excludes spectators and maps metrics', () => {
    const normalizer = new RoomTelemetryNormalizer(workerConfig().rooms[0]!)
    const value = normalizer.accept('snapshot', sourceSnapshot(now))!
    expect(value.telemetry.timestamp).toBe(now)
    expect(value.telemetry.remainingMs).toBe(60_000)
    expect(value.telemetry.participants.map(player => [player.id, player.teamId])).toEqual([['a', 'red'], ['b', 'blue']])
    expect(value.telemetry.score).toEqual({ red: 1, blue: 0 })
    expect(value.telemetry.objectives).toEqual({})
  })
  test('does not turn local receipt time or timestamp-less updates into authoritative snapshots', () => {
    const normalizer = new RoomTelemetryNormalizer(workerConfig().rooms[0]!)
    const { timestamp: _timestamp, ...withoutTime } = sourceSnapshot(now)
    expect(normalizer.accept('snapshot', withoutTime)).toBeUndefined()
    expect(normalizer.accept('player:update', { id: 'a', hp: 50 })).toBeUndefined()
    const value = normalizer.accept('player:update', { id: 'a', hp: 40, timestamp: now + 1 })!
    expect(value.telemetry.participants[0]!.hp).toBe(40)
    expect(value.telemetry.timestamp).toBe(now + 1)
  })
  test('rejects wrong match, unknown competitors, missing life state and invalid HP', () => {
    const normalizer = new RoomTelemetryNormalizer(workerConfig().rooms[0]!)
    expect(() => normalizer.accept('snapshot', { ...sourceSnapshot(now), match: { id: 'reused-room', endsAt: now } })).toThrow('another match')
    const unknown = sourceSnapshot(now); unknown.players[0]!.id = 'foreign'
    expect(() => normalizer.accept('snapshot', unknown)).toThrow('exactly one outcome')
    const missingAlive = sourceSnapshot(now); delete missingAlive.players[0]!.alive
    expect(() => normalizer.accept('snapshot', missingAlive)).toThrow('alive state')
    expect(() => normalizer.accept('snapshot', sourceSnapshot(now, 200))).toThrow('health range')
  })
  test('never infers settlement from a winner field, eliminated participants or unsigned match:result', () => {
    const normalizer = new RoomTelemetryNormalizer(workerConfig().rooms[0]!)
    normalizer.accept('snapshot', sourceSnapshot(now))
    expect(normalizer.accept('match:result', { winnerId: 'a', timestamp: now, players: [{ id: 'b', hp: 0 }] })).toBeUndefined()
    expect(normalizer.accept('prediction:signed-result', { winnerId: 'a' })).toBeUndefined()
  })
  test('configuration rejects ambiguous mapping and unsafe paths', () => {
    const rooms = workerConfig().rooms
    rooms[0]!.outcomes[1]!.participantIds = ['a']
    expect(() => workerConfig({ rooms })).toThrow('must not overlap')
    const safe = workerConfig().rooms
    safe[0]!.schema.timestampPath = '__proto__.timestamp'
    expect(() => workerConfig({ rooms: safe })).toThrow('safe property path')
  })
  test('regressing source snapshots never overwrite the live delta cache, including a persisted cursor', () => {
    const binding = workerConfig().rooms[0]!
    const normalizer = new RoomTelemetryNormalizer(binding, { timestamp: now })
    expect(normalizer.accept('snapshot', sourceSnapshot(now - 1, 1))).toBeUndefined()
    expect(normalizer.accept('player:update', { id: 'a', hp: 50, timestamp: now + 1 })).toBeUndefined()
    normalizer.accept('snapshot', sourceSnapshot(now + 2, 90))
    expect(normalizer.accept('snapshot', sourceSnapshot(now + 1, 1))).toBeUndefined()
    const latest = normalizer.accept('player:update', { id: 'b', hp: 70, timestamp: now + 3 })!
    expect(latest.telemetry.participants[0]!.hp).toBe(90)
  })
})
