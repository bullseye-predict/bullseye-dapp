import { beforeEach, expect, test } from 'bun:test'
import {
  MAX_RPC_COOLDOWN_MS,
  MIN_RPC_COOLDOWN_MS,
  beginSigningRun,
  noteRpcAccepted,
  noteRpcThrottled,
  onRpcGateChange,
  resetRpcGate,
  rpcCooldownRemaining,
  signingInFlight,
} from './throttle'

beforeEach(() => resetRpcGate())

test('the first refusal parks background reads, and the next doubles it', () => {
  const now = 1_000_000
  expect(noteRpcThrottled(now)).toBe(MIN_RPC_COOLDOWN_MS)
  expect(noteRpcThrottled(now)).toBe(2 * MIN_RPC_COOLDOWN_MS)
  expect(rpcCooldownRemaining(now)).toBe(2 * MIN_RPC_COOLDOWN_MS)
})

test('the backoff is capped, so a bad minute cannot park the page for an hour', () => {
  const now = 1_000_000
  for (let i = 0; i < 20; i++) noteRpcThrottled(now)
  expect(rpcCooldownRemaining(now)).toBe(MAX_RPC_COOLDOWN_MS)
})

/** Several in-flight reads refused together are one episode. Treating each as
 *  an escalation would push a two-request page straight to the ceiling. */
test('a cooldown already running is never shortened, and time runs it out', () => {
  const now = 1_000_000
  noteRpcThrottled(now)
  expect(rpcCooldownRemaining(now + MIN_RPC_COOLDOWN_MS - 1)).toBe(1)
  expect(rpcCooldownRemaining(now + MIN_RPC_COOLDOWN_MS)).toBe(0)
})

test('a clean stretch forgets the strikes rather than holding the long cooldown', () => {
  const start = 1_000_000
  noteRpcThrottled(start)
  noteRpcThrottled(start)
  const later = start + 5 * MIN_RPC_COOLDOWN_MS
  noteRpcAccepted(later)
  // Forgiven, so the next refusal starts again at the floor.
  expect(noteRpcThrottled(later + 61_000)).toBe(MIN_RPC_COOLDOWN_MS)
})

test('a signing run holds the gate open across the gap between transactions', () => {
  const end = beginSigningRun()
  expect(signingInFlight()).toBe(true)
  end()
  // Still in flight for the tail, which is what covers a multi-transaction run.
  expect(signingInFlight()).toBe(true)
  expect(signingInFlight(Date.now() + 10_000)).toBe(false)
})

test('two overlapping runs are released by the last one to finish', () => {
  const first = beginSigningRun(), second = beginSigningRun()
  first()
  expect(signingInFlight(Date.now() + 10_000)).toBe(true)
  second()
  expect(signingInFlight(Date.now() + 10_000)).toBe(false)
})

test('waiting pollers are told when the gate changes, so none sit on a clock', () => {
  let woken = 0
  const off = onRpcGateChange(() => { woken++ })
  noteRpcThrottled()
  beginSigningRun()()
  off()
  noteRpcThrottled()
  expect(woken).toBe(3)
})
