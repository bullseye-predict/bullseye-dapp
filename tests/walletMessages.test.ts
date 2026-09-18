import { expect, test } from 'bun:test'
import { readWalletError } from '../packages/adapters/solana/manifest/messages'
import { noteRpcThrottled, resetRpcGate } from '../packages/adapters/solana/manifest/throttle'

/** The exact string the claim panel printed to a trader in the recording. */
const RATE_LIMIT = '429 : {"jsonrpc":"2.0","error":{"code":-32429,"message":"rate limited"}}'

test('a rate limit never reaches the trader as JSON-RPC', () => {
  resetRpcGate()
  const read = readWalletError(new Error(RATE_LIMIT))
  expect(read.message).not.toContain('jsonrpc')
  expect(read.message).not.toContain('{')
  expect(read.message).toContain('busy')
  // The original survives for a bug report.
  expect(read.raw).toBe(RATE_LIMIT)
})

test('the wait is named from the shared gate rather than guessed', () => {
  resetRpcGate()
  const now = 1_000_000
  noteRpcThrottled(now)
  const read = readWalletError(new Error(RATE_LIMIT), now)
  expect(read.retryInMs).toBeGreaterThan(0)
  expect(read.message).toMatch(/Try again in \d+ seconds?\./)
  resetRpcGate()
})

/** browser.ts builds this sentence and the explorer link is recovered from it,
 *  so the translation must not eat the signature. */
test('an unconfirmed send keeps its signature', () => {
  const signature = '5'.repeat(60)
  const read = readWalletError(new Error(`Check transaction ${signature} before retrying: confirmation unavailable`))
  expect(read.signature).toBe(signature)
  expect(read.message).toContain('explorer')
})

test('a declined signature says nothing was sent', () => {
  expect(readWalletError(new Error('User rejected the request.')).message).toContain('Nothing was sent.')
})

/** Earlier signatures in a claim may already have confirmed, so this must not
 *  read as "the whole thing failed". */
test('a wallet reconnect says the run stopped rather than failed', () => {
  const read = readWalletError(new Error('Network or wallet selection changed. Reconnect before signing.'))
  expect(read.message).toContain('carry on from where it stopped')
})

/** This repo's own throws are already prose and must survive untouched. */
test('a written sentence passes through unchanged', () => {
  const written = 'Cancel open sell orders for this question before claiming.'
  expect(readWalletError(new Error(written)).message).toBe(written)
})

test('any other machine output is replaced rather than shown', () => {
  const read = readWalletError(new Error('{"code":-32000,"data":{"logs":[]}}'))
  expect(read.message).toBe('Solana could not be reached. Try again in a moment.')
})
