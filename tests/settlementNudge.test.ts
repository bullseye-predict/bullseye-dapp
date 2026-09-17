import { expect, test } from 'bun:test'
import { isAwaitingSettlement, nudgeChangedChain, nudgeDue } from '../src/components/portfolio/useSettlementNudge'
import type { SolanaPositionRow } from '../src/components/portfolio/solanaRows'

const row = (state: string, quantity = 100n) => ({ state, quantity } as unknown as SolanaPositionRow)
const MINUTE = 60_000

test('only a held position whose match ended without a result is worth a nudge', () => {
  expect(isAwaitingSettlement(row('Awaiting result'))).toBe(true)
  // Trading and Claim states need nothing from the settler.
  for (const state of ['Trading', 'Claim winnings', 'Claim refund', 'Lost', 'Closed', 'Orders']) {
    expect(isAwaitingSettlement(row(state))).toBe(false)
  }
  // An exited row is somebody else's position now.
  expect(isAwaitingSettlement(row('Awaiting result', 0n))).toBe(false)
})

test('a viewer with nothing stuck never asks', () => {
  expect(nudgeDue(0, undefined, 1_000_000)).toBe(false)
  expect(nudgeDue(0, 0, 1_000_000)).toBe(false)
})

test('the first viewer asks immediately', () => {
  expect(nudgeDue(1, undefined, 1_000_000)).toBe(true)
})

test('one ask per minute, however many rows are stuck', () => {
  const at = 1_000_000
  expect(nudgeDue(5, at, at + 1)).toBe(false)
  expect(nudgeDue(5, at, at + MINUTE - 1)).toBe(false)
  expect(nudgeDue(5, at, at + MINUTE)).toBe(true)
})

test('only a finished pass makes the page re-read', () => {
  expect(nudgeChangedChain({ configured: true, status: 'COMPLETED' })).toBe(true)
  // Each of these left the chain exactly as it was.
  for (const status of ['NOT_CONFIGURED', 'THROTTLED', 'RUNNING', 'LOCK_HELD', 'FAILED']) {
    expect(nudgeChangedChain({ configured: true, status })).toBe(false)
  }
  expect(nudgeChangedChain({ configured: false, status: 'NOT_CONFIGURED' })).toBe(false)
  expect(nudgeChangedChain({})).toBe(false)
})
