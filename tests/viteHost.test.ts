import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { handleApiRequest } from '../src/server/handle-api'
import { eventHref } from '../src/components/events/eventModel'

test('the API boundary ignores application routes and refuses unknown API routes', async () => {
  expect(await handleApiRequest(new Request('https://app.test/markets'))).toBeNull()
  const missing = await handleApiRequest(new Request('https://app.test/api/not-real'))
  expect(missing?.status).toBe(404)
})

test('the migrated agent proxy fails closed when its upstream is not configured', async () => {
  const held = process.env.SOLZ_GAME_API_ORIGIN
  delete process.env.SOLZ_GAME_API_ORIGIN
  try {
    const response = await handleApiRequest(new Request('https://app.test/api/agent-arena'), {})
    expect(response?.status).toBe(503)
    expect(await response?.json()).toEqual({
      error: 'SOLZ_GAME_API_ORIGIN is unset in solz-prediction-market-vite. Refusing to guess an upstream.',
    })
  } finally {
    if (held === undefined) delete process.env.SOLZ_GAME_API_ORIGIN
    else process.env.SOLZ_GAME_API_ORIGIN = held
  }
})

test('empty token metadata is answered locally without an upstream read', async () => {
  const response = await handleApiRequest(new Request('https://app.test/api/token-meta'))
  expect(response?.status).toBe(200)
  expect(await response?.json()).toEqual({ ok: true, tokens: [] })
})

test('the generated route tree contains every Astro page migrated to TanStack', async () => {
  const routeTree = await readFile(new URL('../src/routeTree.gen.ts', import.meta.url), 'utf8')
  for (const route of [
    '/', '/demo', '/live', '/watch', '/markets', '/profile', '/agent-arena', '/catwalk', '/miaw-prix',
    '/colacat', '/bet-or-market', '/events/$id', '/events/$id/$predictionId', '/events-2/$id',
    '/events-2/$id/$predictionId', '/events-3/$id', '/events-3/$id/$predictionId', '/$chain/$network/$address',
    '/events-panta/$id',
  ]) expect(routeTree).toContain(`'${route}'`)
})

test('event perspectives and selections keep one stable route identity', () => {
  const market = new URL(eventHref('/events', 'match one', 'question/1', 'yes'), 'https://app.test')
  const community = new URL(eventHref('/events?view=community', 'match one', 'question/1'), 'https://app.test')
  const agents = new URL(eventHref('/events?view=agents', 'match one'), 'https://app.test')

  expect(market.pathname).toBe('/events/match%20one')
  expect(community.pathname).toBe(market.pathname)
  expect(agents.pathname).toBe(market.pathname)
  expect(market.searchParams.get('market')).toBe('question/1')
  expect(market.searchParams.get('outcome')).toBe('yes')
  expect(community.searchParams.get('view')).toBe('community')
  expect(agents.searchParams.get('view')).toBe('agents')
})
