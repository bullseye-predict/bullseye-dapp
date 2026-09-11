import { expect, test } from 'bun:test'
import { PredictionDatabase } from '../storage/database'
import { RequestAuthenticator } from './requests'
import { proofHeaders } from '../../../packages/sdk/auth'

const proof = { venue: 'EVM' as const, chainId: '1', account: 'fixture-owner', nonce: 'delayed_signature_nonce', expiresAt: 31_000, signature: 'fixture-verified-by-injected-verifier' }
const request = () => new Request('http://prediction.test/hermes/start?venue=EVM&chainId=1', { method: 'POST', headers: proofHeaders(proof), body: '{}' })
function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

test('proof that expires during asynchronous chain verification never consumes a nonce or authorizes mutation', async () => {
  const db = new PredictionDatabase(':memory:'), entered = deferred(), finish = deferred()
  let now = 1000
  const auth = new RequestAuthenticator(db, { verify: async () => { entered.release(); await finish.promise; return true } }, 'http://prediction.test', () => now)
  const pending = auth.authenticate(request(), '{}').then(value => ({ value }), error => ({ error }))
  try {
    await entered.promise
    now = proof.expiresAt
    finish.release()
    const result = await pending
    expect('error' in result && result.error.code).toBe('UNAUTHORIZED')
    expect(db.sql.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM consumed_nonces').get()!.count).toBe(0)
  } finally { finish.release(); db.close() }
})

test('a delayed concurrent replay remains rejected after expired-nonce cleanup', async () => {
  const db = new PredictionDatabase(':memory:'), bothEntered = deferred(), first = deferred(), second = deferred()
  let now = 1000, calls = 0
  const auth = new RequestAuthenticator(db, { verify: async () => {
    calls++
    const gate = calls === 1 ? first : second
    if (calls === 2) bothEntered.release()
    await gate.promise
    return true
  } }, 'http://prediction.test', () => now)
  const pendingFirst = auth.authenticate(request(), '{}')
  const pendingSecond = auth.authenticate(request(), '{}').then(value => ({ value }), error => ({ error }))
  try {
    await bothEntered.promise
    first.release()
    expect((await pendingFirst).nonce).toBe(proof.nonce)
    now = proof.expiresAt + 1
    db.consumeNonce('independent-proof', 'cleanup-operation', now + 30_000, now)
    second.release()
    const result = await pendingSecond
    expect('error' in result && result.error.code).toBe('UNAUTHORIZED')
    expect(db.sql.query<{ count: number }, [string]>('SELECT COUNT(*) AS count FROM consumed_nonces WHERE nonce=?').get(proof.nonce)!.count).toBe(0)
  } finally { first.release(); second.release(); db.close() }
})
