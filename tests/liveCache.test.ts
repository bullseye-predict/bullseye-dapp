import { afterEach, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatwalkApp } from '../src/components/catwalk/CatwalkApp'
import { MiawPrixApp } from '../src/components/miawprix/MiawPrixApp'
import { catwalkReadKey as boardKey } from '../src/components/solz/catwalkSource'
import {
  cachedAge, cachedValue, forgetCachedValues, rememberValue,
} from '../src/components/solz/liveCache'
import { catwalkReadKey, catwalkSource } from '../src/components/solz/catwalkSource'
import { miawPrixBoardKey, miawPrixSource } from '../src/components/miawprix/miawPrixSource'

/**
 * THE REALM'S MEMORY, which is what stops a navigation redrawing a board the
 * reader was just looking at. See src/components/solz/liveCache.ts.
 */

afterEach(() => forgetCachedValues())

test('nothing is remembered until a read lands, and then it is remembered whole', () => {
  expect(cachedValue('/api/agent-arena?kind=catwalk')).toBeNull()
  const rows = [{ spot: 1 }]
  const written = rememberValue('/api/agent-arena?kind=catwalk', rows)
  // The SAME object, not a copy: the next island paints what this caller got.
  expect(cachedValue<typeof rows>('/api/agent-arena?kind=catwalk')?.value).toBe(rows)
  expect(written.at).toBeGreaterThan(0)
  // A different request is a different answer and must not be served this one.
  expect(cachedValue('/api/agent-arena?kind=standings')).toBeNull()
})

test('the key a read is remembered under is the request URL it was read from', () => {
  expect(catwalkReadKey('/api/agent-arena', 'catwalk')).toBe('/api/agent-arena?kind=catwalk')
  // CATWALK's schedule read and the programme page's board read are BYTE FOR
  // BYTE the same request, so one board in the realm serves both rather than
  // two copies that age apart.
  expect(miawPrixBoardKey('/api/agent-arena')).toBe('/api/agent-arena?kind=miawPrix')
  expect(miawPrixBoardKey('/api/agent-arena', 'solz-00')).toBe('/api/agent-arena?kind=miawPrix&seasonId=solz-00')
})

test('a fresh answer says nothing about its age; an old one says how old it is', () => {
  const now = 1_700_000_000_000
  // Under twenty seconds there is nothing worth saying, and saying it would
  // put a timestamp beside every panel on the site.
  expect(cachedAge(now - 5_000, now)).toBe('')
  expect(cachedAge(now - 45_000, now)).toBe('45s ago')
  expect(cachedAge(now - 5 * 60_000, now)).toBe('5m ago')
  expect(cachedAge(now - 3 * 3_600_000, now)).toBe('3h ago')
  // A clock that ran backwards is not a negative age.
  expect(cachedAge(now + 10_000, now)).toBe('')
})

/** A source built on the realm's own transport. `fetch` is patched rather than
 *  injected, because it is the DEFAULT transport that decides whether an answer
 *  becomes the realm's memory. */
function onRealmTransport<T>(payload: unknown, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response(JSON.stringify(payload), {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
  return run().finally(() => { globalThis.fetch = original })
}

const BOARD = {
  ok: true, gameKey: 'solz', activeSlots: 1, lineupSize: 2,
  season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2 },
  lineup: [{ spot: 1, mint: 'MintA', lane: 'outbid', active: true, team: { mint: 'MintA', symbol: 'ALPHA', name: 'Alpha' } }],
}

test('a read on the realm transport becomes the realm memory, parsed', async () => {
  const board = await onRealmTransport(BOARD, () => catwalkSource('/api/agent-arena').board())
  const held = cachedValue<typeof board>(catwalkReadKey('/api/agent-arena', 'catwalk'))
  expect(held?.value).toBe(board)
  // Parsed, so the next island takes the shape the network one would hand it.
  expect(held?.value.lineup[0]?.team?.symbol).toBe('ALPHA')
})

test("a source on an injected transport is somebody's private wire and writes nothing", async () => {
  const stub = (async () => new Response(JSON.stringify(BOARD), {
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch
  const board = await catwalkSource('/api/agent-arena', stub).board()
  expect(board.lineup).toHaveLength(1)
  // The answer came off a wire this page never opened. Writing it under the
  // shared key would hand the next island a board nothing on the site read.
  expect(cachedValue(catwalkReadKey('/api/agent-arena', 'catwalk'))).toBeNull()

  const programme = miawPrixSource('/api/agent-arena', '/api/prediction', (async () => new Response(
    JSON.stringify({ ok: true, seasons: [], standings: [], matches: [] }),
    { headers: { 'content-type': 'application/json' } },
  )) as unknown as typeof fetch)
  await programme.board()
  expect(cachedValue(miawPrixBoardKey('/api/agent-arena'))).toBeNull()
})

test("CATWALK's schedule read is remembered as the programme, so /miaw-prix opens on it", async () => {
  const payload = {
    ok: true,
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    seasons: [], standings: [], matches: [],
  }
  await onRealmTransport(payload, () => catwalkSource('/api/agent-arena').schedule())
  const held = cachedValue<{ season: { seasonId: string } | null }>(miawPrixBoardKey('/api/agent-arena'))
  expect(held?.value.season?.seasonId).toBe('solz-00')
  // ONE ENTRY, NOT TWO. The two builders land on the same string because the
  // two pages make the same request; a CATWALK-shaped key here would be a
  // second copy of the one programme, ageing separately from the one
  // /miaw-prix reads.
  expect(catwalkReadKey('/api/agent-arena', 'miawPrix')).toBe(miawPrixBoardKey('/api/agent-arena'))
})

/**
 * THE SERVER RENDER NEVER SEEDS.
 *
 * `/catwalk` and `/miaw-prix` are `client:load` islands: the server renders
 * their markup and React hydrates the client against it. The first pass seeded
 * inside `useState`, so the client's FIRST render carried remembered rows that
 * the server - where this map is always empty - had drawn as a skeleton. React
 * called that a hydration failure, threw the server's markup away and rebuilt
 * the island, which is the opposite of what the seed is for and took the whole
 * visible page with it.
 *
 * `renderToStaticMarkup` runs the render phase and no effects, which is exactly
 * what the server does and exactly what the client must match on its first
 * commit. So: a populated cache must change nothing here. The seed belongs in
 * `useCacheSeed`, which runs after that commit and before paint.
 */
test('a populated cache changes nothing about the first render of /catwalk', () => {
  const props = { endpoint: '/api/agent-arena' }
  const cold = renderToStaticMarkup(createElement(CatwalkApp, props))
  rememberValue(boardKey('/api/agent-arena', 'catwalk'), {
    gameKey: 'solz', activeSlots: 1, lineupSize: 2, lockLeadMs: null, season: null,
    lineup: [], seats: null, rankedLane: null, lastSeatPaidAt: null, explorer: null,
  })
  const warm = renderToStaticMarkup(createElement(CatwalkApp, props))
  expect(warm).toBe(cold)
  // And specifically: the carried-board line is a CLIENT fact and is never in
  // the markup the client hydrates against.
  expect(warm).not.toContain('cw-notice--carried')
})

test('a populated cache changes nothing about the first render of /miaw-prix', () => {
  const props = { endpoint: '/api/agent-arena', predictionApiUrl: '/api/prediction', initialSeasonId: '' }
  const cold = renderToStaticMarkup(createElement(MiawPrixApp, props))
  rememberValue(miawPrixBoardKey('/api/agent-arena'), {
    season: { seasonId: 'solz-00', seasonIndex: 0, startsAt: 1, endsAt: 2, status: 'live' },
    seasons: [], standings: [], matches: [],
  })
  const warm = renderToStaticMarkup(createElement(MiawPrixApp, props))
  expect(warm).toBe(cold)
  expect(warm).not.toContain('mp-carried')
  // The skeleton the server draws is still the skeleton, not a seeded table.
  expect(warm).toContain('mp-pending')
})
