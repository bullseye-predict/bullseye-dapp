import type { PredictionDatabase } from './storage/database'
import type { ResultJob } from '../settlement/worker'
import { decodeStored } from '../../packages/prediction-core/serialization'
import { invariant, marketKey, PredictionError } from '../../packages/prediction-core/validation'

/** Public projection of authority-verified jobs; never derives a winner from telemetry. */
export function readDreamDexOracleResult(database: PredictionDatabase, chainId: string, matchId: string, now = Date.now()) {
  invariant(chainId === '5031' || chainId === '50312', 'WRONG_NETWORK', 'Unsupported DreamDEX chain.')
  // Match ID is known before the oracle question/market is created. Reject ambiguous
  // topics rather than silently picking one of several markets for the same match.
  const markets = database.listMarkets('DREAMDEX', chainId, now).filter(market => market.matchId === matchId)
  if (!markets.length) throw new PredictionError('RESULT_PENDING', 'No registered market result yet.', 425)
  invariant(markets.length === 1 && markets[0]!.outcomes.length === 2, 'AMBIGUOUS_EVENT', 'This source requires exactly one binary winner market per match and network.')
  const market = markets[0]!
  const exists = database.sql.query("SELECT name FROM sqlite_master WHERE type='table' AND name='result_jobs'").get()
  if (!exists) throw new PredictionError('RESULT_SOURCE_UNAVAILABLE', 'Verified result storage is not configured.', 503)
  const key = marketKey('DREAMDEX', chainId, market.id)
  const row = database.sql.query<{ payload: string }, [string]>('SELECT payload FROM result_jobs WHERE id=?').get(key)
  if (!row) throw new PredictionError('RESULT_PENDING', 'The authority has not finalized this match.', 425)
  // QUEUED is sufficient: enqueue verifies the authority before persisting. Waiting
  // for chain settlement here would deadlock the oracle that must cause settlement.
  const job = decodeStored<ResultJob>(row.payload)
  const result = job.result
  invariant(job.id === key && result.venue === 'DREAMDEX' && result.chainId === chainId && result.marketId === market.id && result.matchId === matchId, 'WRONG_RESULT', 'Stored result identity mismatch.')
  invariant(typeof result.voided === 'boolean' && Number.isSafeInteger(result.matchEndedAt) && result.matchEndedAt >= market.createdAt && result.matchEndedAt <= now, 'INVALID_RESULT', 'Invalid stored result.')
  if (result.voided) throw new PredictionError('RESULT_VOIDED', 'This match has no winning answer. Apply the configured oracle timeout/void policy.', 422)
  invariant(result.winningOutcomeId === 0 || result.winningOutcomeId === 1, 'INVALID_RESULT', 'Invalid binary winner.')
  // Do not expose signature, transport errors, or internal job state. Expiry guards
  // admission, not the lifetime of a result that was already verified and persisted.
  return { matchId, venue: 'DREAMDEX', chainId, marketId: market.id, status: 'FINAL', resultCode: result.winningOutcomeId + 1, matchEndedAt: result.matchEndedAt }
}
