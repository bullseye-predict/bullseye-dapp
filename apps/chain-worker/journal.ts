import { createHash, randomUUID } from 'node:crypto'
import { decodeStored, encodeStored } from '../../packages/prediction-core/serialization'
import { invariant } from '../../packages/prediction-core/validation'
import type { SignedMatchResult, SignedOrder } from '../../packages/prediction-core/types'
import type { SettlementReceipt } from '../matcher/settlement'
import type { PredictionDatabase } from '../api/storage/database'

export function intentHash(value: unknown): string {
  const canonical = (input: unknown): unknown => typeof input === 'bigint' ? { integer: input.toString() } : Array.isArray(input) ? input.map(canonical) : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : input
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
/** Orderbook lifecycle fields are deliberately excluded from transaction identity. */
export function signedOrderIntent(order: SignedOrder): SignedOrder {
  const { orderId, venue, chainId, maker, marketId, outcomeId, side, price, quantity, nonce, expiresAt, signature } = order
  return { orderId, venue, chainId, maker, marketId, outcomeId, side, price, quantity, nonce, expiresAt, signature }
}
export interface PreparedSubmission { raw: string; txHash: string; lastValidBlockHeight?: number }
export interface Submission {
  id: string; chain: string; intentHash: string; intent: unknown; nonce?: bigint
  leaseOwner: string; leaseUntil: number; prepared?: PreparedSubmission; receipt?: SettlementReceipt
}

/** Persist intent and signed bytes BEFORE broadcast. Retries may only rebroadcast identical bytes. */
export class ChainSubmissionJournal {
  readonly owner = randomUUID()
  constructor(readonly database: PredictionDatabase, private readonly now = Date.now) {
    database.sql.run(`CREATE TABLE IF NOT EXISTS chain_submissions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chain_signer_nonces (scope TEXT PRIMARY KEY, next_nonce TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chain_result_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, receipt TEXT);
      CREATE TABLE IF NOT EXISTS chain_result_scopes (scope TEXT PRIMARY KEY, id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chain_worker_cursors (scope TEXT PRIMARY KEY, cursor TEXT NOT NULL);`)
  }
  get(id: string): Submission | undefined {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM chain_submissions WHERE id = ?').get(id)
    return row ? decodeStored<Submission>(row.payload) : undefined
  }
  private save(value: Submission): void {
    this.database.sql.query('INSERT INTO chain_submissions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(value.id, encodeStored(value))
  }
  claim(id: string, chain: string, intent: unknown, nonce?: { account: string; pending: bigint; scope?: string }): Submission | undefined {
    return this.database.transaction(() => {
      const hash = intentHash(intent)
      const existing = this.get(id)
      invariant(!existing || existing.intentHash === hash && existing.chain === chain, 'SUBMISSION_CONFLICT', 'Submission ID was reused for a different transaction intent.')
      if (existing?.prepared || existing?.receipt?.status === 'FAILED' || existing?.receipt?.status === 'CONFIRMED') return existing
      if (existing && existing.leaseOwner !== this.owner && existing.leaseUntil > this.now()) return undefined
      let assigned = existing?.nonce
      if (assigned === undefined && nonce) {
        const scope = JSON.stringify([nonce.scope ?? chain, nonce.account.toLowerCase()])
        const current = this.database.sql.query<{ next_nonce: string }, [string]>('SELECT next_nonce FROM chain_signer_nonces WHERE scope = ?').get(scope)
        assigned = current && BigInt(current.next_nonce) > nonce.pending ? BigInt(current.next_nonce) : nonce.pending
        this.database.sql.query('INSERT INTO chain_signer_nonces VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET next_nonce = excluded.next_nonce').run(scope, (assigned + 1n).toString())
      }
      const value: Submission = { id, chain, intentHash: hash, intent, nonce: assigned, leaseOwner: this.owner, leaseUntil: this.now() + 120_000 }
      this.save(value)
      return value
    })
  }
  signed(id: string, prepared: PreparedSubmission): Submission {
    return this.database.transaction(() => {
      const value = this.get(id)
      invariant(value && value.leaseOwner === this.owner && !value.prepared, 'LOST_SUBMISSION_LEASE', 'Another worker owns this submission.')
      value.prepared = prepared
      value.leaseUntil = 0
      this.save(value)
      return value
    })
  }
  record(id: string, receipt: SettlementReceipt): SettlementReceipt {
    this.database.transaction(() => {
      const value = this.get(id)
      invariant(value, 'UNKNOWN_SUBMISSION', 'Submission was not journaled.')
      if (value.receipt?.status === 'CONFIRMED' || value.receipt?.status === 'FAILED') return
      value.receipt = receipt
      this.save(value)
    })
    return this.get(id)!.receipt!
  }
  failUnsigned(id: string, reason: string): SettlementReceipt {
    return this.database.transaction(() => {
      const value = this.get(id)
      if (!value || value.leaseOwner !== this.owner || value.prepared || value.nonce !== undefined) return { status: 'UNKNOWN' }
      value.receipt = { status: 'FAILED', reason }
      this.save(value)
      return value.receipt
    })
  }
  result(result: SignedMatchResult): { id: string; receipt?: SettlementReceipt } | undefined {
    const id = `result:${intentHash(result)}`
    const value = this.database.sql.query<{ receipt: string | null }, [string]>('SELECT receipt FROM chain_result_jobs WHERE id = ?').get(id)
    return value ? { id, ...(value.receipt ? { receipt: decodeStored<SettlementReceipt>(value.receipt) } : {}) } : undefined
  }
  hasMarketResult(venue: string, chainId: string, marketId: string): boolean {
    return !!this.database.sql.query<{ id: string }, [string]>('SELECT id FROM chain_result_scopes WHERE scope = ?').get(JSON.stringify([venue, chainId, marketId]))
  }
  enqueueResult(result: SignedMatchResult): string {
    const id = `result:${intentHash(result)}`
    return this.database.transaction(() => {
      const scope = JSON.stringify([result.venue, result.chainId, result.marketId])
      const existing = this.database.sql.query<{ id: string }, [string]>('SELECT id FROM chain_result_scopes WHERE scope = ?').get(scope)
      invariant(!existing || existing.id === id, 'RESULT_CONFLICT', 'A different authoritative result was already queued for this market.')
      this.database.sql.query('INSERT OR IGNORE INTO chain_result_scopes VALUES (?, ?)').run(scope, id)
      this.database.sql.query('INSERT OR IGNORE INTO chain_result_jobs VALUES (?, ?, NULL)').run(id, encodeStored(result))
      return id
    })
  }
  pendingResults(): Array<{ id: string; result: SignedMatchResult }> {
    return this.database.sql.query<{ id: string; payload: string }, []>('SELECT id, payload FROM chain_result_jobs WHERE receipt IS NULL ORDER BY rowid LIMIT 100').all().map(row => ({ id: row.id, result: decodeStored<SignedMatchResult>(row.payload) }))
  }
  finishResult(id: string, receipt: SettlementReceipt): void {
    if (receipt.status === 'CONFIRMED' || receipt.status === 'FAILED') this.database.sql.query('UPDATE chain_result_jobs SET receipt = ? WHERE id = ?').run(encodeStored(receipt), id)
  }
  cursor(scope: string): string | undefined { return this.database.sql.query<{ cursor: string }, [string]>('SELECT cursor FROM chain_worker_cursors WHERE scope = ?').get(scope)?.cursor }
  setCursor(scope: string, cursor: string): void { this.database.sql.query('INSERT INTO chain_worker_cursors VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET cursor = excluded.cursor').run(scope, cursor) }
}
