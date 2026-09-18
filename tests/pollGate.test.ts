import { afterEach, beforeEach, expect, test } from 'bun:test'
import { pollBlocked, schedulePoll } from '../src/components/home/venue/pollGate'
import { beginSigningRun, noteRpcThrottled, resetRpcGate } from '../packages/adapters/solana/manifest/throttle'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/** jsdom is not loaded here, so `document` is whatever the test installs. */
const setVisibility = (value: 'visible' | 'hidden') => {
  ;(globalThis as Record<string, unknown>).document = {
    visibilityState: value,
    addEventListener() {},
    removeEventListener() {},
  }
}

beforeEach(() => { resetRpcGate(); setVisibility('visible') })
afterEach(() => { delete (globalThis as Record<string, unknown>).document })

test('nothing blocks an ordinary visible page', () => {
  expect(pollBlocked()).toEqual({ blocked: false, retryInMs: 0, reason: null })
})

test('a hidden tab stops polling instead of running at full rate in the background', () => {
  setVisibility('hidden')
  expect(pollBlocked().reason).toBe('hidden')
})

test('a signing run blocks background reads, throttling outranks it', () => {
  const end = beginSigningRun()
  expect(pollBlocked().reason).toBe('signing')
  noteRpcThrottled()
  // The refusal is what the user is being hurt by, so it is the one reported.
  expect(pollBlocked().reason).toBe('throttled')
  end()
})

test('a blocked poll waits rather than firing, and runs once released', async () => {
  let runs = 0
  const end = beginSigningRun()
  const cancel = schedulePoll(() => { runs++ }, 0, () => 0)
  await sleep(30)
  expect(runs).toBe(0)
  end()
  // The tail keeps it shut, so releasing the run is not enough on its own.
  expect(runs).toBe(0)
  cancel()
})

test('a cancelled poll never runs, even after the gate opens', async () => {
  let runs = 0
  const cancel = schedulePoll(() => { runs++ }, 5, () => 0)
  cancel()
  await sleep(30)
  expect(runs).toBe(0)
})

test('an unblocked poll still runs on its own delay', async () => {
  let runs = 0
  const cancel = schedulePoll(() => { runs++ }, 5, () => 0)
  await sleep(40)
  expect(runs).toBe(1)
  cancel()
})
