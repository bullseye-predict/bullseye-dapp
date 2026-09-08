import { afterEach, describe, expect, test } from 'bun:test'
import { createLiveArenaAdapter } from '../src/components/arena/liveArenaAdapter'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
})

function useFetchStub(handler: () => Promise<Response>) {
  // Bun adds fetch.preconnect to its global type, but these response-only adapter tests never invoke it.
  globalThis.fetch = handler as unknown as typeof fetch
}

describe('SOLZ live arena adapter', () => {
  test('fails closed without inventing matches when the SOLZ source is offline', async () => {
    useFetchStub(async () => new Response(JSON.stringify({ message: 'SOLZ source offline for test.' }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    }))
    const snapshot = await createLiveArenaAdapter(null).load()

    expect(snapshot.matches).toEqual([])
    expect(snapshot.markets).toEqual([])
    expect(snapshot.capabilities.observer.ready).toBe(false)
    expect(snapshot.capabilities.observer.reason).toContain('offline for test')
    expect(snapshot.capabilities.orders.ready).toBe(false)
    expect(snapshot.capabilities.prompts.ready).toBe(false)
  })

  test('loads only the real SOLZ overview without creating fallback leaderboard rows', async () => {
    useFetchStub(async () => new Response(JSON.stringify({
      generatedAt: 1_788_400_000_000,
      colyseusUrl: 'wss://rooms.solz.test',
      gameOrigin: null,
      activity: {
        generatedAt: 1_788_400_000_000,
        tokens: [],
        casual: { unlimited: { matches: [] }, survival: { matches: [] } },
      },
      leaderboard: { kills: { rows: [] }, wins: { rows: [] } },
      capabilities: {
        orders: { ready: false, reason: 'escrow unavailable' },
        prompts: { ready: false, reason: 'relay unavailable' },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const snapshot = await createLiveArenaAdapter(null).load()

    expect(snapshot.matches).toEqual([])
    expect(snapshot.leaderboard).toEqual([])
    expect(snapshot.feed[0]?.text).toContain('No SOLZ matches')
    expect(snapshot.capabilities.orders.reason).toBe('escrow unavailable')
  })
})
