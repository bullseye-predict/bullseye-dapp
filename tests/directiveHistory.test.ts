import { afterEach, expect, test } from 'bun:test'
import {
  mergeDirectives,
  recordDirective,
  resetDirectiveHistory,
  subscribeDirectives,
  type DirectiveEntry,
} from '../src/components/home/directiveHistory'
import { readDirectivePurchases } from '../src/components/solz/directiveRelay'
import { directiveStatus } from '../src/components/home/useDirectiveHistory'
import { proxyDirectives } from '../src/server/directive-proxy'

const runtime = { SOLZ_GAME_API_ORIGIN: 'http://localhost:3100' }
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

function entry(over: Partial<DirectiveEntry> = {}): DirectiveEntry {
  return {
    id: 'purchase-1',
    matchId: 'match-77',
    symbol: 'COLACAT',
    mint: 'Mint111111111111111111111111111111111111111',
    decimals: 6,
    amountAtoms: '1000000',
    usdPrice: null,
    tokenUsd: null,
    expiresAt: 0,
    state: 'paid',
    at: 1_000,
    text: 'Hold the west relay and protect the team.',
    ...over,
  }
}

afterEach(() => resetDirectiveHistory())

test('a recorded directive reaches the rail before the relay is asked anything', () => {
  const seen: DirectiveEntry[][] = []
  const stop = subscribeDirectives((value) => seen.push(value))
  recordDirective({ purchase: entry(), text: 'Push the centre lane while the timer runs.', wallet: WALLET })
  stop()
  const last = seen.at(-1)!
  expect(last).toHaveLength(1)
  // The confirm response carries the purchase, never the words that were
  // bought, so the page's own copy of the text is what must survive.
  expect(last[0].text).toBe('Push the centre lane while the timer runs.')
})

test('a refresh replaces the state it knows better and keeps a row it has never seen', () => {
  const local = entry({ text: 'Fall back and defend the point we already hold.' })
  const relay = entry({ state: 'executed', text: '' })
  const merged = mergeDirectives([local], [relay])
  expect(merged).toHaveLength(1)
  expect(merged[0].state).toBe('executed')
  expect(merged[0].text).toBe('Fall back and defend the point we already hold.')
})

test('the rail reads the relay states in its own words', () => {
  expect(directiveStatus('paid')).toBe('pending')
  expect(directiveStatus('consumed')).toBe('accepted')
  expect(directiveStatus('executed')).toBe('executed')
  expect(directiveStatus('paid_expired')).toBe('ignored')
  expect(directiveStatus('failed')).toBe('ignored')
})

test('the purchases proxy forwards the payer, because no browser identity crosses it', async () => {
  let asked = ''
  const response = await proxyDirectives(
    new Request(`http://site/api/directives/purchases?matchId=match-77&wallet=${WALLET}&actorId=someone-else`),
    'purchases',
    runtime,
    async (input) => {
      asked = String(input)
      return Response.json({ ok: true, purchases: [], now: 1 })
    },
  )
  expect(response.status).toBe(200)
  const target = new URL(asked)
  expect(target.pathname).toBe('/api/v1/viewer-actions/purchases')
  expect(target.searchParams.get('matchId')).toBe('match-77')
  expect(target.searchParams.get('wallet')).toBe(WALLET)
  // Only the two named parameters, never a passthrough.
  expect(target.searchParams.get('actorId')).toBeNull()
})

test('a receipt keeps the words and the clock a purchase does not carry, and one bad row does not blank the rest', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    Response.json({
      ok: true,
      purchases: [
        { id: 'p-1', matchId: 'match-77', symbol: 'COLACAT', mint: 'M', decimals: 6, amountAtoms: '1000000', state: 'paid', createdAt: 10, text: 'older' },
        { nothing: true },
        { id: 'p-2', matchId: 'match-77', symbol: 'COLACAT', mint: 'M', decimals: 6, amountAtoms: '2000000', state: 'executed', createdAt: 20, text: 'newer', botId: 'agent-3' },
      ],
    })) as typeof fetch
  try {
    const rows = await readDirectivePurchases('match-77', WALLET)
    expect(rows.map((row) => row.id)).toEqual(['p-2', 'p-1'])
    expect(rows[0].botId).toBe('agent-3')
    expect(rows[0].at).toBe(20)
  } finally {
    globalThis.fetch = original
  }
})
