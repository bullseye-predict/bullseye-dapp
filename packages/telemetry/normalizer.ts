import type { MatchTelemetry, ParticipantState, VenueId } from '../prediction-core/types'
import { integer, invariant, record, textField } from '../prediction-core/validation'
import { parseTelemetry } from './bridge'

export interface OutcomeBinding {
  outcomeId: number
  /** Must equal the market outcome's configured telemetry entity ID. */
  entityId: string
  participantIds?: string[]
  sourceTeamId?: string
  scoreSourceKey?: string
  objectiveSourceKey?: string
}
export interface TelemetrySchema {
  /** Paths use own object properties separated by dots; all timestamps are milliseconds. */
  timestampPath: string
  matchIdPath: string
  playersPath: string
  matchPath: string
  remainingMsPath?: string
  endsAtPath?: string
  sourceSequencePath?: string
  scorePath?: string
  objectivesPath?: string
  killsPath?: string
  playerIdPath: string
  playerTeamPath: string
  hpPath: string
  maxHpPath: string
  killsCountPath: string
  alivePath?: string
  lifeStatePath?: string
  aliveStates: string[]
  deadStates: string[]
  snapshotMessage: string
  playerUpdateMessage?: string
  playerPayloadPath?: string
  matchUpdateMessage?: string
  matchPayloadPath?: string
  resultMessage?: string
}
export interface RoomBinding {
  roomId: string
  matchId: string
  /** The game identity, explicitly mapped to the prediction match ID. */
  sourceMatchId: string
  casualGuest: boolean
  outcomes: OutcomeBinding[]
  schema: TelemetrySchema
  resultMarkets: Array<{ venue: VenueId; chainId: string; marketId: string }>
}
export type TelemetryDraft = Omit<MatchTelemetry, 'sequence'>
export interface NormalizedSnapshot { telemetry: TelemetryDraft; sourceSequence?: number }

export function readPath(value: unknown, path: string): unknown {
  let current = value
  for (const key of path.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
function writePath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.')
  let current = target
  for (const key of keys.slice(0, -1)) {
    const previous = current[key]
    current[key] = previous && typeof previous === 'object' && !Array.isArray(previous) ? { ...previous } : {}
    current = current[key] as Record<string, unknown>
  }
  current[keys[keys.length - 1]!] = value
}

/** A read-only cache of authoritative server data. Receipt time is never a game timestamp. */
export class RoomTelemetryNormalizer {
  private snapshot?: Record<string, unknown>
  private timestampFloor: number
  private sourceSequenceFloor?: number
  constructor(readonly binding: RoomBinding, cursor?: { timestamp: number; sourceSequence?: number }) {
    this.timestampFloor = cursor?.timestamp ?? 0
    this.sourceSequenceFloor = cursor?.sourceSequence
  }

  accept(type: string, input: unknown): NormalizedSnapshot | undefined {
    const schema = this.binding.schema
    if (![schema.snapshotMessage, schema.playerUpdateMessage, schema.matchUpdateMessage, '$state'].includes(type)) return undefined
    const event = record(input)
    const eventTime = readPath(event, schema.timestampPath)
    const eventTimestamp = eventTime === undefined ? undefined : integer(eventTime, 'server timestamp')
    const eventSequence = eventTimestamp !== undefined && schema.sourceSequencePath ? integer(readPath(event, schema.sourceSequencePath), 'source sequence') : undefined
    // Drop old snapshots before they can poison the delta cache, including after a process restart.
    if (eventTimestamp !== undefined && eventTimestamp < this.timestampFloor) return undefined
    if (eventSequence !== undefined && this.sourceSequenceFloor !== undefined && eventSequence <= this.sourceSequenceFloor) return undefined
    if (type === '$state' || type === schema.snapshotMessage) {
      this.snapshot = structuredClone(event)
    } else if (this.snapshot && type === schema.playerUpdateMessage) {
      const update = record(schema.playerPayloadPath ? readPath(event, schema.playerPayloadPath) : event)
      const id = textField(readPath(update, schema.playerIdPath), 'player id')
      const players = this.playerRows(readPath(this.snapshot, schema.playersPath))
      const index = players.findIndex(player => readPath(player, schema.playerIdPath) === id)
      if (index < 0) players.push(update)
      else players[index] = { ...players[index], ...update }
      writePath(this.snapshot, schema.playersPath, players)
    } else if (this.snapshot && type === schema.matchUpdateMessage) {
      const update = record(schema.matchPayloadPath ? readPath(event, schema.matchPayloadPath) : event)
      writePath(this.snapshot, schema.matchPath, { ...record(readPath(this.snapshot, schema.matchPath)), ...update })
    } else return undefined

    // A timestamp-less delta may enrich the cache, but cannot manufacture a fresh snapshot.
    if (eventTimestamp === undefined) return undefined
    const timestamp = eventTimestamp
    writePath(this.snapshot, schema.timestampPath, timestamp)
    invariant(readPath(this.snapshot, schema.matchIdPath) === this.binding.sourceMatchId, 'WRONG_SOURCE_MATCH', 'The room is reporting another match.')
    const participants = this.playerRows(readPath(this.snapshot, schema.playersPath))
      .filter(player => player.spectator !== true && player.observer !== true)
      .map(player => this.participant(player))
    invariant(participants.length > 0, 'INCOMPLETE_TELEMETRY', 'No mapped competitors are present.')
    const remaining = schema.remainingMsPath ? readPath(this.snapshot, schema.remainingMsPath) : undefined
    const remainingMs = remaining === undefined
      ? Math.max(0, integer(readPath(this.snapshot, schema.endsAtPath!), 'server endsAt') - timestamp)
      : integer(remaining, 'remainingMs', 0, 86_400_000)
    const ids = new Set(participants.map(player => player.id))
    const rawKills = schema.killsPath ? readPath(this.snapshot, schema.killsPath) : undefined
    invariant(rawKills === undefined || Array.isArray(rawKills), 'INVALID_TELEMETRY', 'Kill events must be an array.')
    const kills = (rawKills as unknown[] | undefined ?? []).slice(-128).map(value => {
      const kill = record(value)
      const killerId = textField(kill.killerId, 'killerId'), victimId = textField(kill.victimId, 'victimId')
      invariant(ids.has(killerId) && ids.has(victimId), 'INVALID_TELEMETRY', 'Kill event references an unmapped participant.')
      const time = integer(kill.timestamp, 'kill timestamp')
      invariant(time <= timestamp, 'INVALID_TELEMETRY', 'Kill event is newer than the server snapshot.')
      return { id: textField(kill.id, 'kill id'), killerId, victimId, timestamp: time }
    })
    invariant(new Set(kills.map(kill => kill.id)).size === kills.length, 'INVALID_TELEMETRY', 'Duplicate kill event IDs.')
    const parsed = parseTelemetry({ matchId: this.binding.matchId, sequence: 0, timestamp, remainingMs, participants,
      score: this.metrics(schema.scorePath, 'scoreSourceKey'), objectives: this.metrics(schema.objectivesPath, 'objectiveSourceKey'), kills })
    const { sequence: _sequence, ...telemetry } = parsed
    this.timestampFloor = timestamp
    this.sourceSequenceFloor = eventSequence ?? this.sourceSequenceFloor
    return { telemetry, sourceSequence: eventSequence }
  }

  private playerRows(input: unknown): Record<string, unknown>[] {
    const rows = Array.isArray(input) ? input : Object.values(record(input))
    invariant(rows.length <= 128, 'INVALID_TELEMETRY', 'Too many players.')
    return rows.map(record)
  }
  private participant(player: Record<string, unknown>): ParticipantState {
    const schema = this.binding.schema
    const id = textField(readPath(player, schema.playerIdPath), 'participant id')
    const team = readPath(player, schema.playerTeamPath)
    const matches = this.binding.outcomes.filter(outcome => outcome.participantIds?.includes(id) || (outcome.sourceTeamId !== undefined && outcome.sourceTeamId === team))
    invariant(matches.length === 1, 'UNMAPPED_PARTICIPANT', `Participant ${id} must map to exactly one outcome.`)
    const aliveValue = schema.alivePath ? readPath(player, schema.alivePath) : undefined
    const lifeState = schema.lifeStatePath ? readPath(player, schema.lifeStatePath) : undefined
    const alive = typeof aliveValue === 'boolean' ? aliveValue
      : typeof lifeState === 'string' && schema.aliveStates.includes(lifeState) ? true
      : typeof lifeState === 'string' && schema.deadStates.includes(lifeState) ? false : undefined
    invariant(alive !== undefined, 'INCOMPLETE_TELEMETRY', 'An authoritative alive state is required.')
    return { id, teamId: matches[0]!.entityId, hp: readPath(player, schema.hpPath) as number, maxHp: readPath(player, schema.maxHpPath) as number,
      kills: integer(readPath(player, schema.killsCountPath), 'kills'), alive }
  }
  private metrics(path: string | undefined, key: 'scoreSourceKey' | 'objectiveSourceKey'): Record<string, number> {
    const raw = path ? readPath(this.snapshot, path) : undefined
    if (raw === undefined) return {}
    const values = record(raw)
    return Object.fromEntries(this.binding.outcomes.flatMap(outcome => outcome[key] !== undefined && Object.hasOwn(values, outcome[key]!)
      ? [[outcome.entityId, values[outcome[key]!] as number]] : []))
  }
}
