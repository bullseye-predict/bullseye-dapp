import { integer, invariant, record, textField, venueId } from '../../packages/prediction-core/validation'
import type { RoomBinding, TelemetrySchema } from '../../packages/telemetry/normalizer'

export interface TelemetryWorkerConfig {
  colyseusUrl: string
  predictionApiUrl: string
  statePath: string
  activityUrl?: string
  resultSinkUrl?: string
  discoveryIntervalMs: number
  publishIntervalMs: number
  reconnectMinMs: number
  reconnectMaxMs: number
  connectTimeoutMs: number
  sourceMaxAgeMs: number
  rooms: RoomBinding[]
}
function endpoint(value: unknown, name: string, protocols = ['http:', 'https:']) {
  const url = new URL(textField(value, name, 2048))
  invariant(protocols.includes(url.protocol) && !url.username && !url.password && !url.hash, 'INVALID_CONFIG', `${name} uses an unsupported URL or embeds credentials.`)
  return url.toString().replace(/\/$/, '')
}
function path(value: unknown, name: string): string {
  const result = textField(value, name, 256)
  invariant(result.split('.').every(part => /^[A-Za-z0-9_-]+$/.test(part) && !['__proto__', 'constructor', 'prototype'].includes(part)), 'INVALID_CONFIG', `${name} must be a safe property path.`)
  return result
}
const strings = (value: unknown, name: string): string[] => {
  invariant(Array.isArray(value) && value.length <= 128, 'INVALID_CONFIG', `${name} must be a bounded string array.`)
  return value.map(item => textField(item, name))
}
function schema(input: unknown): TelemetrySchema {
  const value = record(input)
  const required = (key: string, fallback?: string) => path(value[key] ?? fallback, key)
  const optional = (key: string) => value[key] === undefined ? undefined : path(value[key], key)
  const result: TelemetrySchema = {
    timestampPath: required('timestampPath'), matchIdPath: required('matchIdPath'), playersPath: required('playersPath', 'players'), matchPath: required('matchPath', 'match'),
    remainingMsPath: optional('remainingMsPath'), endsAtPath: optional('endsAtPath'), sourceSequencePath: optional('sourceSequencePath'), scorePath: optional('scorePath'), objectivesPath: optional('objectivesPath'), killsPath: optional('killsPath'),
    playerIdPath: required('playerIdPath', 'id'), playerTeamPath: required('playerTeamPath', 'teamId'), hpPath: required('hpPath', 'hp'), maxHpPath: required('maxHpPath', 'hpMax'), killsCountPath: required('killsCountPath', 'kills'),
    alivePath: optional('alivePath'), lifeStatePath: optional('lifeStatePath'), aliveStates: strings(value.aliveStates ?? ['alive'], 'aliveStates'), deadStates: strings(value.deadStates ?? ['dead', 'eliminated', 'respawning'], 'deadStates'),
    snapshotMessage: textField(value.snapshotMessage ?? 'snapshot', 'snapshotMessage'), playerUpdateMessage: value.playerUpdateMessage === undefined ? undefined : textField(value.playerUpdateMessage, 'playerUpdateMessage'),
    playerPayloadPath: optional('playerPayloadPath'), matchUpdateMessage: value.matchUpdateMessage === undefined ? undefined : textField(value.matchUpdateMessage, 'matchUpdateMessage'), matchPayloadPath: optional('matchPayloadPath'),
    resultMessage: value.resultMessage === undefined ? undefined : textField(value.resultMessage, 'resultMessage'),
  }
  invariant((result.remainingMsPath || result.endsAtPath) && (result.alivePath || result.lifeStatePath), 'INVALID_CONFIG', 'Authoritative remaining time/endsAt and alive/lifeState paths are required.')
  invariant(!result.aliveStates.some(state => result.deadStates.includes(state)), 'INVALID_CONFIG', 'Alive and dead states overlap.')
  const messages = [result.snapshotMessage, result.playerUpdateMessage, result.matchUpdateMessage, result.resultMessage].filter(item => item !== undefined)
  invariant(new Set(messages).size === messages.length && !messages.includes('$state'), 'INVALID_CONFIG', 'Message types must be distinct.')
  return result
}
export function parseTelemetryWorkerConfig(input: unknown): TelemetryWorkerConfig {
  const value = record(input)
  invariant(Array.isArray(value.rooms) && value.rooms.length > 0 && value.rooms.length <= 128, 'INVALID_CONFIG', 'Configure 1–128 explicit room bindings.')
  const rooms = value.rooms.map(input => {
    const row = record(input)
    invariant(Array.isArray(row.outcomes) && row.outcomes.length >= 2 && row.outcomes.length <= 16, 'INVALID_CONFIG', 'Configure 2–16 outcome mappings.')
    const outcomes = row.outcomes.map((input, index) => {
      const outcome = record(input)
      invariant(outcome.outcomeId === index, 'INVALID_CONFIG', 'Outcome IDs must be contiguous from zero.')
      const parsed = { outcomeId: index, entityId: textField(outcome.entityId, 'entityId'), participantIds: outcome.participantIds === undefined ? undefined : strings(outcome.participantIds, 'participantIds'), sourceTeamId: outcome.sourceTeamId === undefined ? undefined : textField(outcome.sourceTeamId, 'sourceTeamId'), scoreSourceKey: outcome.scoreSourceKey === undefined ? undefined : textField(outcome.scoreSourceKey, 'scoreSourceKey'), objectiveSourceKey: outcome.objectiveSourceKey === undefined ? undefined : textField(outcome.objectiveSourceKey, 'objectiveSourceKey') }
      invariant(parsed.participantIds?.length || parsed.sourceTeamId, 'INVALID_CONFIG', 'An outcome must explicitly map participant IDs or a source team.')
      return parsed
    })
    for (const values of [outcomes.map(o => o.entityId), outcomes.flatMap(o => o.participantIds ?? []), outcomes.flatMap(o => o.sourceTeamId === undefined ? [] : [o.sourceTeamId])]) invariant(new Set(values).size === values.length, 'INVALID_CONFIG', 'Outcome mappings must not overlap.')
    invariant(row.resultMarkets === undefined || (Array.isArray(row.resultMarkets) && row.resultMarkets.length <= 32), 'INVALID_CONFIG', 'Invalid result market allowlist.')
    const resultMarkets = (row.resultMarkets as unknown[] | undefined ?? []).map(input => {
      const market = record(input)
      return { venue: venueId(market.venue), chainId: textField(market.chainId, 'chainId'), marketId: textField(market.marketId, 'marketId') }
    })
    invariant(row.casualGuest === undefined || typeof row.casualGuest === 'boolean', 'INVALID_CONFIG', 'casualGuest must be boolean.')
    const parsed: RoomBinding = { roomId: textField(row.roomId, 'roomId'), matchId: textField(row.matchId, 'matchId'), sourceMatchId: textField(row.sourceMatchId, 'sourceMatchId'), casualGuest: row.casualGuest === true, outcomes, schema: schema(row.schema), resultMarkets }
    invariant(!resultMarkets.length || parsed.schema.resultMessage, 'INVALID_CONFIG', 'Result forwarding requires an explicit signed-result message type.')
    invariant(/^[A-Za-z0-9_-]+$/.test(parsed.roomId), 'INVALID_CONFIG', 'Unsafe Colyseus room ID.')
    return parsed
  })
  invariant(new Set(rooms.map(room => room.roomId)).size === rooms.length && new Set(rooms.map(room => room.matchId)).size === rooms.length, 'INVALID_CONFIG', 'Each room and prediction match needs one observer binding.')
  const parsed: TelemetryWorkerConfig = {
    colyseusUrl: endpoint(value.colyseusUrl, 'colyseusUrl', ['ws:', 'wss:', 'http:', 'https:']), predictionApiUrl: endpoint(value.predictionApiUrl, 'predictionApiUrl'),
    statePath: textField(value.statePath ?? '.data/telemetry-worker.sqlite', 'statePath', 4096), activityUrl: value.activityUrl === undefined ? undefined : endpoint(value.activityUrl, 'activityUrl'), resultSinkUrl: value.resultSinkUrl === undefined ? undefined : endpoint(value.resultSinkUrl, 'resultSinkUrl'),
    discoveryIntervalMs: integer(value.discoveryIntervalMs ?? 5000, 'discoveryIntervalMs', 50, 300_000), publishIntervalMs: integer(value.publishIntervalMs ?? 100, 'publishIntervalMs', 10, 60_000),
    reconnectMinMs: integer(value.reconnectMinMs ?? 500, 'reconnectMinMs', 10, 60_000), reconnectMaxMs: integer(value.reconnectMaxMs ?? 30_000, 'reconnectMaxMs', 10, 300_000), connectTimeoutMs: integer(value.connectTimeoutMs ?? 10_000, 'connectTimeoutMs', 100, 60_000),
    sourceMaxAgeMs: integer(value.sourceMaxAgeMs ?? 10_000, 'sourceMaxAgeMs', 100, 10_000), rooms,
  }
  invariant(parsed.reconnectMaxMs >= parsed.reconnectMinMs, 'INVALID_CONFIG', 'Invalid reconnect backoff range.')
  invariant(!rooms.some(room => room.resultMarkets.length) || parsed.resultSinkUrl, 'INVALID_CONFIG', 'Signed-result forwarding requires resultSinkUrl.')
  return parsed
}
