import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TelemetryWorkerStore } from './store'
import { RoomTelemetryNormalizer } from '../../packages/telemetry/normalizer'
import { sourceSnapshot, workerConfig } from './fixtures'
import type { SignedMatchResult } from '../../packages/prediction-core/types'

const dirs: string[] = []
afterEach(() => { for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true }) })
const normalize = (timestamp: number, hp = 100) => new RoomTelemetryNormalizer(workerConfig().rooms[0]!).accept('snapshot', sourceSnapshot(timestamp, hp))!

test('source monotonicity and allocated output sequences survive an actual SQLite restart', () => {
  const path = mkdtempSync(join(tmpdir(), 'solz-telemetry-')); dirs.push(path)
  let store = new TelemetryWorkerStore(join(path, 'state.sqlite'))
  const first = store.enqueue({ ...normalize(1000), sourceSequence: 10 })!
  expect(first.sequence).toBe(1)
  store.close()
  store = new TelemetryWorkerStore(join(path, 'state.sqlite'))
  try {
    expect(store.pending()[0]!.body).toBe(first.body)
    expect(store.enqueue({ ...normalize(2000, 90), sourceSequence: 9 })).toBeUndefined()
    expect(store.enqueue({ ...normalize(999, 90), sourceSequence: 11 })).toBeUndefined()
    const second = store.enqueue({ ...normalize(2000, 90), sourceSequence: 11 })!
    expect(second.sequence).toBe(2)
    store.ack(first)
    expect(store.pending()[0]!.sequence).toBe(2)
  } finally { store.close() }
})
test('lost acknowledgements reconcile unchanged body; restored counters rebase newer telemetry', () => {
  const store = new TelemetryWorkerStore(':memory:')
  try {
    const first = store.enqueue(normalize(1000))!
    store.reconcile(JSON.parse(first.body))
    expect(store.pending()).toEqual([])
    const second = store.enqueue(normalize(2000, 90))!
    store.reconcile({ ...JSON.parse(first.body), sequence: 100 })
    expect(store.pending()[0]!.sequence).toBe(101)
    expect(JSON.parse(store.pending()[0]!.body).participants[0].hp).toBe(90)
    store.ack(second)
    expect(store.pending()).toHaveLength(1)
    expect(store.enqueue(normalize(3000, 80))!.sequence).toBe(102)
  } finally { store.close() }
})
test('verified result outbox survives restart, rejects a conflicting winner, and never republishes completed results', () => {
  const path = mkdtempSync(join(tmpdir(), 'solz-result-')); dirs.push(path)
  let store = new TelemetryWorkerStore(join(path, 'state.sqlite'))
  const result: SignedMatchResult = { venue: 'SOLANA', chainId: 'fixture-chain', marketId: 'fixture-market', matchId: workerConfig().rooms[0]!.matchId, winningOutcomeId: 0, voided: false, matchEndedAt: 1000, expiresAt: 9000, stateHash: `0x${'aa'.repeat(32)}`, signature: 'preverified-fixture' }
  expect(store.enqueueResult(result)).toBe(true)
  store.close()
  store = new TelemetryWorkerStore(join(path, 'state.sqlite'))
  try {
    expect(JSON.parse(store.results()[0]!.body)).toEqual(result)
    expect(store.enqueueResult(result)).toBe(false)
    expect(() => store.enqueueResult({ ...result, winningOutcomeId: 1 })).toThrow('already recorded')
    const queued = store.results()[0]!
    store.finishResult(queued.key)
    expect(store.results()).toEqual([])
    expect(store.enqueueResult(result)).toBe(false)
  } finally { store.close() }
})
