import { expect, test } from 'bun:test'
import { PredictionDatabase } from '../api/storage/database'
import { createChainRuntime } from './runtime'
import type { Market, SignedMatchResult } from '../../packages/prediction-core/types'

test('accepted authoritative result keeps trading paused after queue failure and beyond the processing batch', () => {
  const database = new PredictionDatabase()
  try {
    const runtime = createChainRuntime({ database, configs: [] })
    const market: Market = { id: 'market', matchId: 'match', venue: 'EVM', chainId: '1', marketAddress: 'settlement', collateralToken: 'token', collateralDecimals: 6, outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }], status: 'TRADING', createdAt: 1000, tradingStartsAt: 1000, tradingLocksAt: 10000, expiresAt: 20000, paused: false }
    const result: SignedMatchResult = { venue: 'EVM', chainId: '1', marketId: market.id, matchId: market.matchId, winningOutcomeId: 0, voided: false, stateHash: 'hash', matchEndedAt: 2000, expiresAt: 3000, signature: 'authority' }
    for (let index = 0; index < 101; index++) runtime.journal.enqueueResult({ ...result, marketId: `other${index}` })
    const id = runtime.journal.enqueueResult(result)
    expect(runtime.marketForTrading(market).paused).toBe(true)
    runtime.journal.finishResult(id, { status: 'FAILED', reason: 'RPC preflight rejected the result transaction' })
    expect(runtime.marketForTrading(market).paused).toBe(true)
    expect(market.paused).toBe(false)
    expect(runtime.marketForTrading({ ...market, status: 'RESOLVED', winningOutcomeId: 0 }).paused).toBe(false)
  } finally { database.close() }
})
