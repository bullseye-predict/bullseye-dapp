import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type { MatchTelemetry, SignedMatchResult } from '../../packages/prediction-core/types'
import { stringify } from '../../packages/prediction-core/serialization'
import { integer, invariant, marketKey } from '../../packages/prediction-core/validation'
import type { NormalizedSnapshot } from '../../packages/telemetry/normalizer'
import { parseTelemetry } from '../../packages/telemetry/bridge'

export interface PendingTelemetry { matchId: string; sequence: number; timestamp: number; body: string }
export interface PendingResult { key: string; body: string; expiresAt: number }
type Cursor = { sequence: number; timestamp: number; source_sequence: number | null; hash: string }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const content = (value: MatchTelemetry) => { const { sequence: _sequence, ...rest } = value; return stringify(rest) }

/** One durable sequence allocator and coalescing live outbox, independent of the API database. */
export class TelemetryWorkerStore {
  private readonly db: Database
  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true })
    this.db.run(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS telemetry_cursors(match_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL, source_sequence INTEGER, hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS telemetry_outbox(match_id TEXT PRIMARY KEY, sequence INTEGER NOT NULL, timestamp INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS result_outbox(result_key TEXT PRIMARY KEY, hash TEXT NOT NULL, body TEXT NOT NULL, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT);`)
  }
  close() { this.db.close() }
  cursor(matchId: string): { timestamp: number; sourceSequence?: number } | undefined {
    const value = this.db.query<Cursor, [string]>('SELECT * FROM telemetry_cursors WHERE match_id=?').get(matchId)
    return value ? { timestamp: value.timestamp, sourceSequence: value.source_sequence ?? undefined } : undefined
  }
  enqueue(input: NormalizedSnapshot): PendingTelemetry | undefined {
    return this.db.transaction(() => {
      const draft = input.telemetry
      const previous = this.db.query<Cursor, [string]>('SELECT * FROM telemetry_cursors WHERE match_id=?').get(draft.matchId)
      const digest = hash(stringify(draft))
      if (previous && (draft.timestamp < previous.timestamp || digest === previous.hash || (input.sourceSequence !== undefined && previous.source_sequence !== null && input.sourceSequence <= previous.source_sequence))) return undefined
      const sequence = integer((previous?.sequence ?? 0) + 1, 'next telemetry sequence', 1)
      const parsed = parseTelemetry({ ...draft, sequence })
      const body = stringify(parsed)
      invariant(Buffer.byteLength(body) <= 64 * 1024, 'PAYLOAD_TOO_LARGE', 'Telemetry exceeds the API body limit.')
      this.db.query('INSERT INTO telemetry_cursors VALUES(?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET sequence=excluded.sequence,timestamp=excluded.timestamp,source_sequence=excluded.source_sequence,hash=excluded.hash')
        .run(draft.matchId, sequence, draft.timestamp, input.sourceSequence ?? previous?.source_sequence ?? null, digest)
      this.db.query('INSERT INTO telemetry_outbox VALUES(?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET sequence=excluded.sequence,timestamp=excluded.timestamp,body=excluded.body')
        .run(draft.matchId, sequence, draft.timestamp, body)
      return { matchId: draft.matchId, sequence, timestamp: draft.timestamp, body }
    }).immediate()
  }
  pending(): PendingTelemetry[] {
    return this.db.query<{ match_id: string; sequence: number; timestamp: number; body: string }, []>('SELECT * FROM telemetry_outbox ORDER BY timestamp').all().map(row => ({ matchId: row.match_id, sequence: row.sequence, timestamp: row.timestamp, body: row.body }))
  }
  ack(row: PendingTelemetry) { this.db.query('DELETE FROM telemetry_outbox WHERE match_id=? AND sequence=?').run(row.matchId, row.sequence) }
  /** Reconcile API acknowledgement loss or a locally restored database without reusing a sequence. */
  reconcile(remote: MatchTelemetry) {
    parseTelemetry(remote)
    this.db.transaction(() => {
      const cursor = this.db.query<Cursor, [string]>('SELECT * FROM telemetry_cursors WHERE match_id=?').get(remote.matchId)
      const pending = this.pending().find(row => row.matchId === remote.matchId)
      let next = Math.max(remote.sequence, cursor?.sequence ?? 0)
      if (pending && pending.sequence <= remote.sequence) {
        const parsed = parseTelemetry(JSON.parse(pending.body))
        if (pending.timestamp < remote.timestamp || content(parsed) === content(remote)) this.ack(pending)
        else {
          next = integer(next + 1, 'rebased telemetry sequence', 1)
          this.db.query('UPDATE telemetry_outbox SET sequence=?,body=? WHERE match_id=?').run(next, stringify({ ...parsed, sequence: next }), remote.matchId)
        }
      }
      this.db.query('INSERT INTO telemetry_cursors VALUES(?,?,?,?,?) ON CONFLICT(match_id) DO UPDATE SET sequence=excluded.sequence,timestamp=excluded.timestamp')
        .run(remote.matchId, next, Math.max(cursor?.timestamp ?? 0, remote.timestamp), cursor?.source_sequence ?? null, cursor?.hash ?? hash(content(remote)))
    }).immediate()
  }
  enqueueResult(result: SignedMatchResult) {
    const key = marketKey(result.venue, result.chainId, result.marketId), body = stringify(result), digest = hash(body)
    return this.db.transaction(() => {
      const previous = this.db.query<{ hash: string }, [string]>('SELECT hash FROM result_outbox WHERE result_key=?').get(key)
      invariant(!previous || previous.hash === digest, 'CONFLICTING_RESULT', 'An authority result is already recorded for this market.')
      if (previous) return false
      this.db.query('INSERT INTO result_outbox(result_key,hash,body,expires_at) VALUES(?,?,?,?)').run(key, digest, body, result.expiresAt)
      return true
    }).immediate()
  }
  results(): PendingResult[] { return this.db.query<{ result_key: string; body: string; expires_at: number }, []>("SELECT * FROM result_outbox WHERE status='pending'").all().map(row => ({ key: row.result_key, body: row.body, expiresAt: row.expires_at })) }
  finishResult(key: string, error?: string) { this.db.query('UPDATE result_outbox SET status=?,error=? WHERE result_key=?').run(error ? 'failed' : 'delivered', error ?? null, key) }
}
