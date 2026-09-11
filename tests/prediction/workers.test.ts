import { describe, expect, test } from 'bun:test'
import { ChainIndexer, type ChainEventSource, type FinalizedBatch } from '../../apps/indexer/indexer'
import { PredictionDatabase } from '../../apps/api/storage/database'
import { ResultSettlementWorker, type ResultTransport } from '../../apps/settlement/worker'
import { SqliteHermesJournal } from '../../apps/api/storage/hermes-journal'
import type { SignedMatchResult } from '../../packages/prediction-core/types'
import { at, market, wallet } from './core.test'

describe('independent durable workers', () => {
  test('indexer atomically checkpoints finalized events and rolls back invalid batches', async () => {
    const database = new PredictionDatabase()
    try {
      let batch: FinalizedBatch | undefined = { venue: market.venue, chainId: market.chainId, cursor: 'block-1', finality: 'FINALIZED', events: [{ type: 'MARKET', id: 'tx:0', value: market }] }
      const source: ChainEventSource = { id: 'test-finalized-source', venue: market.venue, chainId: market.chainId, readAfter: async () => batch }
      const indexer = new ChainIndexer(database, source)
      expect(await indexer.tick()).toBe(1)
      batch = { ...batch, cursor: 'block-2' }
      expect(await indexer.tick()).toBe(0)
      batch = { ...batch, cursor: 'block-3', events: [{ type: 'BALANCE', id: 'tx:1', value: { account: wallet.address, collateralToken: market.collateralToken, total: 10n, available: 10n, reserved: 5n } }] }
      await expect(indexer.tick()).rejects.toThrow()
      expect(database.balance(market.venue, market.chainId, wallet.address)).toBeUndefined()
      batch = { ...batch, events: [{ type: 'BALANCE', id: 'tx:1', value: { account: wallet.address, collateralToken: market.collateralToken, total: 10n, available: 5n, reserved: 5n } }] }
      expect(await indexer.tick()).toBe(1)
      expect(database.balance(market.venue, market.chainId, wallet.address.toLowerCase())?.total).toBe(10n)
    } finally { database.close() }
  })

  test('result authority check, conflict rejection, and ambiguous recovery never double-submit', async () => {
    const database = new PredictionDatabase()
    try {
      const result: SignedMatchResult = { matchId: market.matchId, marketId: market.id, venue: market.venue, chainId: market.chainId, winningOutcomeId: 1, voided: false, stateHash: `0x${'77'.repeat(32)}`, matchEndedAt: at, expiresAt: at + 10_000, signature: 'authority-proof' }
      let submits = 0
      const transport: ResultTransport = {
        getMarket: async () => market,
        verify: async input => input.signature === 'authority-proof',
        submit: async () => { submits++; throw new Error('Lost connection after send') },
        lookup: async () => ({ status: 'CONFIRMED', txHash: 'result-chain-tx', confirmedAt: at }),
      }
      const worker = new ResultSettlementWorker(database, transport, () => at)
      await expect(worker.enqueue({ ...result, signature: 'fake' })).rejects.toThrow()
      const job = await worker.enqueue(result)
      await expect(worker.enqueue({ ...result, winningOutcomeId: 0 })).rejects.toThrow()
      expect((await worker.tick(job.id)).status).toBe('AMBIGUOUS')
      const restarted = new ResultSettlementWorker(database, transport, () => at)
      expect((await restarted.tick(job.id)).status).toBe('CONFIRMED')
      expect((await restarted.tick(job.id)).status).toBe('CONFIRMED')
      expect(submits).toBe(1)
      expect(database.eventsAfter(`markets:${job.id}`)).toHaveLength(1)
    } finally { database.close() }
  })

  test('Hermes reservations persist and thrown transactions leave the prior policy intact', async () => {
    const database = new PredictionDatabase()
    try {
      const journal = new SqliteHermesJournal(database)
      const scope = { venue: market.venue, chainId: market.chainId, account: wallet.address }
      await journal.transaction(scope, () => ({ state: { revision: 1, enabled: false, nextSequence: 2, entries: [{ id: 'execution-1', createdAt: at, status: 'UNKNOWN', input: { marketId: market.id, outcomeId: 0, side: 'BUY', price: 500_000n, quantity: 10_000_000n, expiresAt: at + 10_000 } }] }, result: undefined }))
      await expect(journal.transaction(scope, current => { current!.enabled = true; throw new Error('Policy update failed') })).rejects.toThrow()
      const restored = await new SqliteHermesJournal(database).read(scope)
      expect(restored?.enabled).toBe(false)
      expect(restored?.entries[0]?.input.quantity).toBe(10_000_000n)
    } finally { database.close() }
  })
})
