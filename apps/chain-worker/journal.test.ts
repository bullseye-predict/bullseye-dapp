import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PredictionDatabase } from '../api/storage/database'
import { ChainSubmissionJournal, intentHash, signedOrderIntent } from './journal'
import type { SignedMatchResult, SignedOrder } from '../../packages/prediction-core/types'

describe('chain submission journal', () => {
  test('survives restart with identical bytes, guards preparation leases and exact intent identity', () => {
    const directory = mkdtempSync(join(tmpdir(), 'solz-chain-'))
    let database = new PredictionDatabase(join(directory, 'worker.sqlite'))
    try {
      let now = 1000
      const first = new ChainSubmissionJournal(database, () => now)
      const second = new ChainSubmissionJournal(database, () => now)
      expect(first.claim('fill:1', 'EVM:1', { quantity: 10n }, { account: '0xABC', pending: 7n })?.nonce).toBe(7n)
      expect(second.claim('fill:1', 'EVM:1', { quantity: 10n })).toBeUndefined()
      expect(second.failUnsigned('fill:1', 'not mine')).toEqual({ status: 'UNKNOWN' })
      now += 120001
      expect(second.claim('fill:1', 'EVM:1', { quantity: 10n })?.nonce).toBe(7n)
      expect(() => first.signed('fill:1', { raw: 'other', txHash: 'other' })).toThrow('owns')
      second.signed('fill:1', { raw: 'signed-exactly-once', txHash: '0xabc' })
      expect(() => first.claim('fill:1', 'EVM:1', { quantity: 11n })).toThrow('different')
      database.close()
      database = new PredictionDatabase(join(directory, 'worker.sqlite'))
      const resumed = new ChainSubmissionJournal(database)
      expect(resumed.get('fill:1')?.prepared?.raw).toBe('signed-exactly-once')
      resumed.record('fill:1', { status: 'CONFIRMED', txHash: '0xabc', confirmedAt: 2000 })
      expect(resumed.record('fill:1', { status: 'UNKNOWN' }).status).toBe('CONFIRMED')
    } finally { database.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  test('serializes gas-account nonces across deployments and refuses to abandon assigned nonces', () => {
    const database = new PredictionDatabase()
    try {
      const first = new ChainSubmissionJournal(database)
      const second = new ChainSubmissionJournal(database)
      const nonce = { account: '0xABC', pending: 5n, scope: 'EVM:1' }
      expect(first.claim('one', 'factory:1', {}, nonce)?.nonce).toBe(5n)
      expect(second.claim('two', 'factory:2', {}, { ...nonce, account: '0xabc' })?.nonce).toBe(6n)
      expect(first.failUnsigned('one', 'expired')).toEqual({ status: 'UNKNOWN' })
      first.claim('fresh', 'factory:1', {})
      expect(first.failUnsigned('fresh', 'simulation failed').status).toBe('FAILED')
      expect(second.claim('fresh', 'factory:1', {})?.receipt?.status).toBe('FAILED')
    } finally { database.close() }
  })
  test('result queue rejects equivocation and exact repeat stays idempotent after finalization', () => {
    const database = new PredictionDatabase()
    try {
      const journal = new ChainSubmissionJournal(database)
      const result: SignedMatchResult = { venue: 'EVM', chainId: '1', marketId: 'market', matchId: 'match', winningOutcomeId: 0, voided: false, stateHash: 'state', matchEndedAt: 1000, expiresAt: 2000, signature: 'signed' }
      const id = journal.enqueueResult(result)
      expect(journal.enqueueResult(result)).toBe(id)
      expect(() => journal.enqueueResult({ ...result, winningOutcomeId: 1 })).toThrow('different authoritative result')
      journal.finishResult(id, { status: 'CONFIRMED', txHash: '0xabc', confirmedAt: 1500 })
      expect(journal.pendingResults()).toHaveLength(0)
      expect(journal.result(result)?.receipt?.status).toBe('CONFIRMED')
    } finally { database.close() }
  })
  test('signed order identity ignores mutable book fields without ignoring signed limits', () => {
    const order: SignedOrder = { orderId: 'id', venue: 'EVM', chainId: '1', maker: 'owner', marketId: 'market', outcomeId: 0, side: 'BUY', price: 500000n, quantity: 10n, nonce: 0n, expiresAt: 2000, signature: 'signed' }
    expect(intentHash(signedOrderIntent({ ...order, filled: 0n } as SignedOrder))).toBe(intentHash(signedOrderIntent({ ...order, filled: 10n, status: 'FILLED' } as SignedOrder)))
    expect(intentHash(signedOrderIntent({ ...order, quantity: 11n }))).not.toBe(intentHash(signedOrderIntent(order)))
  })
})
