import type { Market, SignedMatchResult } from '../../packages/prediction-core/types'
import { invariant, marketKey } from '../../packages/prediction-core/validation'
import { encodeStored, decodeStored } from '../../packages/prediction-core/serialization'
import type { SettlementReceipt } from '../matcher/settlement'
import type { PredictionDatabase } from '../api/storage/database'

export interface ResultTransport {
  getMarket(result: SignedMatchResult): Promise<Market>
  verify(result: SignedMatchResult, market: Market): Promise<boolean>
  /** Persist/recover a single chain transaction under this key; never create a blind replacement. */
  submit(id: string, result: SignedMatchResult): Promise<SettlementReceipt>
  lookup(id: string, result: SignedMatchResult): Promise<SettlementReceipt>
}

export interface ResultJob {
  id: string
  result: SignedMatchResult
  status: 'QUEUED' | 'SUBMITTING' | 'PENDING' | 'AMBIGUOUS' | 'CONFIRMED' | 'FAILED'
  txHash?: string
  error?: string
}

/** Independent from the game loop. Only verified authority results become settlement jobs. */
export class ResultSettlementWorker {
  constructor(private readonly database: PredictionDatabase, private readonly transport: ResultTransport, private readonly now = Date.now) {
    database.sql.run('CREATE TABLE IF NOT EXISTS result_jobs (id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
  }

  get(id: string): ResultJob | undefined {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM result_jobs WHERE id = ?').get(id)
    return row ? decodeStored<ResultJob>(row.payload) : undefined
  }
  private save(job: ResultJob): void { this.database.sql.query('INSERT INTO result_jobs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload').run(job.id, encodeStored(job)) }

  async enqueue(result: SignedMatchResult): Promise<ResultJob> {
    const copy = structuredClone(result)
    const market = await this.transport.getMarket(copy)
    invariant(copy.marketId === market.id && copy.matchId === market.matchId && copy.venue === market.venue && copy.chainId === market.chainId, 'WRONG_RESULT', 'Result does not belong to this market.')
    invariant(Number.isSafeInteger(copy.matchEndedAt) && copy.matchEndedAt >= market.createdAt && copy.matchEndedAt <= this.now() && copy.expiresAt > this.now(), 'INVALID_RESULT_TIME', 'Result is expired or has an invalid finish time.')
    invariant(typeof copy.voided === 'boolean' && Number.isInteger(copy.winningOutcomeId) && copy.winningOutcomeId >= 0 && copy.winningOutcomeId < market.outcomes.length && (!copy.voided || copy.winningOutcomeId === 0), 'INVALID_OUTCOME', 'Result outcome is invalid.')
    invariant(await this.transport.verify(copy, market), 'INVALID_RESULT_SIGNATURE', 'Result authority signature is invalid.')
    const id = marketKey(copy.venue, copy.chainId, copy.marketId)
    return this.database.transaction(() => {
      const previous = this.get(id)
      if (previous) {
        invariant(encodeStored(previous.result) === encodeStored(copy), 'CONFLICTING_RESULT', 'A different signed result is already queued for this market.')
        return previous
      }
      const job: ResultJob = { id, result: copy, status: 'QUEUED' }
      this.save(job)
      return job
    })
  }

  async tick(id: string): Promise<ResultJob> {
    const { job, submit } = this.database.transaction(() => {
      const job = this.get(id)
      invariant(job, 'NOT_FOUND', 'Unknown result job.')
      const submit = job.status === 'QUEUED'
      if (submit) { job.status = 'SUBMITTING'; this.save(job) }
      return { job, submit }
    })
    if (job.status === 'CONFIRMED' || job.status === 'FAILED') return job
    let receipt: SettlementReceipt
    try { receipt = await (submit ? this.transport.submit(id, job.result) : this.transport.lookup(id, job.result)) }
    catch { receipt = { status: 'UNKNOWN' } }
    return this.database.transaction(() => {
      const current = this.get(id)!
      if (current.status === 'CONFIRMED' || current.status === 'FAILED') return current
      if (receipt.status === 'CONFIRMED') current.status = 'CONFIRMED'
      else if (receipt.status === 'FAILED') { current.status = 'FAILED'; current.error = receipt.reason }
      else if (receipt.status === 'PENDING') current.status = 'PENDING'
      else current.status = 'AMBIGUOUS'
      if (receipt.txHash) current.txHash = receipt.txHash
      this.save(current)
      if (current.status === 'CONFIRMED') this.database.appendEvent(`markets:${id}`, current.result.voided ? 'MARKET_VOIDED' : 'MARKET_RESOLVED', { marketId: current.result.marketId, winningOutcomeId: current.result.voided ? undefined : current.result.winningOutcomeId, txHash: current.txHash })
      return current
    })
  }
}
