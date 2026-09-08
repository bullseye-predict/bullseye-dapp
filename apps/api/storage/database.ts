import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { decodeStored, encodeStored } from '../../../packages/prediction-core/serialization'
import { effectiveMarket, marketKey, validateMarket } from '../../../packages/prediction-core/validation'
import type { Balance, Market, MatchTelemetry, Position, VenueId } from '../../../packages/prediction-core/types'

type PayloadRow = { payload: string }
export type FeedEvent = { sequence: number; topic: string; type: string; payload: unknown; timestamp: number }

/** Local durable adapter. Deploy one SQLite writer on one host; not a distributed database. */
export class PredictionDatabase {
  readonly sql: Database

  constructor(path = ':memory:') {
    this.sql = new Database(path, { create: true, strict: true })
    this.sql.run('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    this.sql.run(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  }

  transaction<T>(operation: () => T): T { return this.sql.transaction(operation).immediate() }
  close(): void { this.sql.close() }

  saveMarket(market: Market): void {
    validateMarket(market)
    this.transaction(() => {
      this.sql.query('INSERT INTO markets VALUES (?, ?, ?, ?, ?) ON CONFLICT(venue, chain_id, id) DO UPDATE SET payload = excluded.payload').run(market.venue, market.chainId, market.id, market.matchId, encodeStored(market))
      for (const outcome of market.outcomes) this.sql.query('INSERT INTO market_outcomes VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET payload = excluded.payload').run(market.venue, market.chainId, market.id, outcome.id, encodeStored(outcome))
    })
  }

  getMarket(venue: VenueId, chainId: string, id: string, now = Date.now()): Market | undefined {
    const row = this.sql.query<PayloadRow, [string, string, string]>('SELECT payload FROM markets WHERE venue = ? AND chain_id = ? AND id = ?').get(venue, chainId, id)
    return row ? effectiveMarket(decodeStored<Market>(row.payload), now) : undefined
  }

  listMarkets(venue: VenueId, chainId: string, now = Date.now()): Market[] {
    return this.sql.query<PayloadRow, [string, string]>('SELECT payload FROM markets WHERE venue = ? AND chain_id = ? ORDER BY id').all(venue, chainId).map(row => effectiveMarket(decodeStored<Market>(row.payload), now))
  }

  telemetry(matchId: string): MatchTelemetry | undefined {
    const row = this.sql.query<PayloadRow, [string]>('SELECT payload FROM telemetry_snapshots WHERE match_id = ?').get(matchId)
    return row ? decodeStored<MatchTelemetry>(row.payload) : undefined
  }

  saveTelemetry(telemetry: MatchTelemetry): boolean {
    const result = this.sql.query('INSERT INTO telemetry_snapshots VALUES (?, ?, ?, ?) ON CONFLICT(match_id) DO UPDATE SET sequence = excluded.sequence, timestamp = excluded.timestamp, payload = excluded.payload WHERE excluded.sequence > telemetry_snapshots.sequence AND excluded.timestamp >= telemetry_snapshots.timestamp').run(telemetry.matchId, telemetry.sequence, telemetry.timestamp, encodeStored(telemetry))
    return result.changes === 1
  }

  consumeNonce(scope: string, nonce: string, expiresAt: number, now: number): boolean {
    return this.transaction(() => {
      this.sql.query('DELETE FROM consumed_nonces WHERE expires_at < ?').run(now)
      const result = this.sql.query('INSERT OR IGNORE INTO consumed_nonces VALUES (?, ?, ?)').run(scope, nonce, expiresAt)
      return result.changes === 1
    })
  }

  positions(venue: VenueId, chainId: string, account: string): Position[] {
    return this.sql.query<PayloadRow, [string]>('SELECT payload FROM positions WHERE account = ?').all(account).map(row => decodeStored<Position>(row.payload)).filter(position => position.venue === venue && position.chainId === chainId)
  }

  savePosition(position: Position): void {
    this.sql.query('INSERT INTO positions VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET payload = excluded.payload').run(marketKey(position.venue, position.chainId, position.marketId), position.account, position.outcomeId, encodeStored(position))
  }

  balance(venue: VenueId, chainId: string, account: string): Balance | undefined {
    const row = this.sql.query<PayloadRow, [string, string, string]>('SELECT payload FROM balances WHERE venue = ? AND chain_id = ? AND account = ?').get(venue, chainId, account)
    return row ? decodeStored<Balance>(row.payload) : undefined
  }

  saveBalance(venue: VenueId, chainId: string, balance: Balance): void {
    this.sql.query('INSERT INTO balances VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET payload = excluded.payload').run(venue, chainId, balance.account, encodeStored(balance))
  }

  appendEvent(topic: string, type: string, payload: unknown, timestamp = Date.now()): number {
    const result = this.sql.query('INSERT INTO events(topic, type, payload, timestamp) VALUES (?, ?, ?, ?)').run(topic, type, encodeStored(payload), timestamp)
    return Number(result.lastInsertRowid)
  }

  eventsAfter(topic: string, sequence = 0, limit = 100): FeedEvent[] {
    return this.sql.query<{ sequence: number; topic: string; type: string; payload: string; timestamp: number }, [string, number, number]>('SELECT * FROM events WHERE topic = ? AND sequence > ? ORDER BY sequence LIMIT ?').all(topic, sequence, limit).map(row => ({ ...row, payload: decodeStored(row.payload) }))
  }
}
