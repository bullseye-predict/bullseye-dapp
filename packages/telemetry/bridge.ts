import { createHmac, timingSafeEqual } from 'node:crypto'
import type { MatchTelemetry } from '../prediction-core/types'
import { integer, invariant, record, textField } from '../prediction-core/validation'

export interface TelemetryStore {
  saveTelemetry(value: MatchTelemetry): boolean
  telemetry(matchId: string): MatchTelemetry | undefined
}

const finite = (value: unknown, name: string, max = 1_000_000) => {
  invariant(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max, 'INVALID_TELEMETRY', `${name} is invalid.`)
  return value
}

function metrics(value: unknown): Record<string, number> {
  const entries = Object.entries(record(value))
  invariant(entries.length <= 128, 'INVALID_TELEMETRY', 'Too many metrics.')
  return Object.fromEntries(entries.map(([key, amount]) => [textField(key, 'metric key', 100), finite(amount, key)]))
}

export function parseTelemetry(value: unknown): MatchTelemetry {
  const input = record(value)
  invariant(Array.isArray(input.participants) && input.participants.length <= 128, 'INVALID_TELEMETRY', 'Invalid participant list.')
  invariant(Array.isArray(input.kills) && input.kills.length <= 128, 'INVALID_TELEMETRY', 'Invalid kill events.')
  const participants = input.participants.map(value => {
    const row = record(value)
    invariant(typeof row.alive === 'boolean', 'INVALID_TELEMETRY', 'alive must be a boolean.')
    const hp = finite(row.hp, 'hp')
    const maxHp = finite(row.maxHp, 'maxHp')
    invariant(maxHp > 0 && hp <= maxHp, 'INVALID_TELEMETRY', 'Invalid health range.')
    return { id: textField(row.id, 'participant id'), teamId: row.teamId === undefined ? undefined : textField(row.teamId, 'teamId'), hp, maxHp, alive: row.alive, kills: integer(row.kills, 'kills', 0, 1_000_000) }
  })
  invariant(new Set(participants.map(row => row.id)).size === participants.length, 'INVALID_TELEMETRY', 'Duplicate participant IDs.')
  return {
    matchId: textField(input.matchId, 'matchId'), sequence: integer(input.sequence, 'sequence'), timestamp: integer(input.timestamp, 'timestamp'), remainingMs: integer(input.remainingMs, 'remainingMs', 0, 86_400_000), participants,
    score: metrics(input.score), objectives: metrics(input.objectives),
    kills: input.kills.map(value => {
      const row = record(value)
      return { id: textField(row.id, 'kill id'), killerId: textField(row.killerId, 'killerId'), victimId: textField(row.victimId, 'victimId'), timestamp: integer(row.timestamp, 'timestamp') }
    }),
  }
}

/** Signs the exact UTF-8 request body. The game publishes; this bridge never sends game commands. */
export function telemetrySignature(body: string, secret: string): string {
  return createHmac('sha256', secret).update('SOLZ_TELEMETRY_V1\n').update(body).digest('hex')
}

export class TelemetryBridge {
  constructor(private readonly store: TelemetryStore, private readonly secret: string, private readonly now = Date.now, private readonly maxAgeMs = 10_000) {
    invariant(secret.length >= 32, 'INVALID_CONFIG', 'Telemetry signing secret must contain at least 32 characters.')
  }

  ingest(body: string, signature: string): MatchTelemetry {
    invariant(/^[0-9a-f]{64}$/.test(signature), 'UNAUTHORIZED_TELEMETRY', 'Invalid telemetry signature.')
    const expected = Buffer.from(telemetrySignature(body, this.secret), 'hex')
    invariant(timingSafeEqual(expected, Buffer.from(signature, 'hex')), 'UNAUTHORIZED_TELEMETRY', 'Invalid telemetry signature.')
    const telemetry = parseTelemetry(JSON.parse(body))
    const age = this.now() - telemetry.timestamp
    invariant(age >= -2_000 && age <= this.maxAgeMs, 'STALE_TELEMETRY', 'Telemetry timestamp is stale or in the future.')
    invariant(this.store.saveTelemetry(telemetry), 'REPLAYED_TELEMETRY', 'Telemetry sequence must increase and timestamp must not decrease.')
    return telemetry
  }
}
