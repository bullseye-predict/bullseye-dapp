import { expect, test } from 'bun:test'
import { startPredictionApi } from './main'
import { ResultSettlementWorker } from '../settlement/worker'
import type { Market, SignedMatchResult } from '../../packages/prediction-core/types'

test('public oracle reads only verified persisted results, scoped by network, without exposing signatures', async () => {
  const app = startPredictionApi({ PREDICTION_PORT: '0', PREDICTION_DATABASE_PATH: ':memory:' })
  const now = Date.now()
  const market: Market = { id: 'market-1', matchId: 'casual-1', venue: 'DREAMDEX', chainId: '50312', marketAddress: 'address', collateralToken: 'token', collateralDecimals: 6, outcomes: [{ id: 0, label: 'YES' }, { id: 1, label: 'NO' }], status: 'LOCKED', createdAt: now - 60000, tradingStartsAt: now - 50000, tradingLocksAt: now - 1000, expiresAt: now + 60000, paused: false }
  const url = new URL('/oracle/dreamdex/50312/matches/casual-1/result', app.server.url)
  const read = () => fetch(url)
  try {
    expect((await read()).status).toBe(425)
    app.database.saveMarket(market)
    expect((await read()).status).toBe(503)
    const worker = new ResultSettlementWorker(app.database, { getMarket: async () => market, verify: async result => result.signature === 'valid-test-signature', submit: async () => { throw new Error('must not submit') }, lookup: async () => { throw new Error('must not lookup') } })
    expect((await read()).status).toBe(425)
    const result: SignedMatchResult = { venue: market.venue, chainId: market.chainId, marketId: market.id, matchId: market.matchId, winningOutcomeId: 0, voided: false, stateHash: 'state', matchEndedAt: now - 100, expiresAt: now + 60000, signature: 'invalid' }
    await expect(worker.enqueue(result)).rejects.toThrow('signature')
    expect((await read()).status).toBe(425)
    await worker.enqueue({ ...result, signature: 'valid-test-signature' })
    const response = await read()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body.resultCode).toBe(1)
    expect(body.signature).toBeUndefined()
    expect((await fetch(new URL('/oracle/dreamdex/5031/matches/casual-1/result', app.server.url))).status).toBe(425)
    expect((await fetch(url, { method: 'POST', body: '{"resultCode":2}' })).status).not.toBe(200)
    await expect(worker.enqueue({ ...result, signature: 'valid-test-signature', winningOutcomeId: 1 })).rejects.toThrow('different signed result')
    expect(() => app.database.saveMarket({ ...market, id: 'other-market' })).toThrow('UNIQUE')
    expect((await read()).status).toBe(200)
  } finally { app.stop() }
})

test('a void never becomes a YES or NO answer', async () => {
  const { PredictionDatabase } = await import('./storage/database')
  const { readDreamDexOracleResult } = await import('./oracle-result')
  const db = new PredictionDatabase()
  const market: Market = { id: 'm', matchId: 'match', venue: 'DREAMDEX', chainId: '50312', marketAddress: 'a', collateralToken: 'c', collateralDecimals: 6, outcomes: [{ id: 0, label: 'YES' }, { id: 1, label: 'NO' }], status: 'LOCKED', createdAt: 0, tradingStartsAt: 1, tradingLocksAt: 2, expiresAt: 100, paused: false }
  try {
    db.saveMarket(market)
    const worker = new ResultSettlementWorker(db, { getMarket: async () => market, verify: async () => true, submit: async () => ({ status: 'UNKNOWN' }), lookup: async () => ({ status: 'UNKNOWN' }) }, () => 10)
    await worker.enqueue({ venue: 'DREAMDEX', chainId: '50312', marketId: 'm', matchId: 'match', winningOutcomeId: 0, voided: true, stateHash: 's', matchEndedAt: 5, expiresAt: 20, signature: 'test' })
    expect(() => readDreamDexOracleResult(db, '50312', 'match', 30)).toThrow('no winning answer')
  } finally { db.close() }
})
