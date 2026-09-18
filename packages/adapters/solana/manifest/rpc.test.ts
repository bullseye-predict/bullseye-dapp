import { beforeEach, expect, test } from 'bun:test'
import { manifestRpcFetch } from './rpc'
import { MIN_RPC_COOLDOWN_MS, noteRpcAccepted, resetRpcGate, rpcCooldownRemaining } from './throttle'

const request = (method: string, id = 1) => ({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method, params: ['fixture'], id }) })
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } })

beforeEach(() => resetRpcGate())

/** The transport used to send up to four requests for every read the endpoint
 *  had just refused. One refusal, one request, and the pollers stand down. */
test('a throttled read is surfaced once and never retried', async () => {
  let calls = 0
  const fetcher = manifestRpcFetch(async () => { calls++; return new Response('', { status: 429 }) })
  expect((await fetcher('https://rpc.test', request('getLatestBlockhash'))).status).toBe(429)
  expect(calls).toBe(1)
})

test('a refusal parks background reads instead of answering with more of them', async () => {
  const fetcher = manifestRpcFetch(async () => new Response('', { status: 429 }))
  expect(rpcCooldownRemaining()).toBe(0)
  await fetcher('https://rpc.test', request('getLatestBlockhash'))
  expect(rpcCooldownRemaining()).toBeGreaterThan(MIN_RPC_COOLDOWN_MS - 1_000)
})

test('repeated refusals back off, and a clean stretch forgets them', async () => {
  const fetcher = manifestRpcFetch(async () => new Response('', { status: 429 }))
  await fetcher('https://rpc.test', request('getLatestBlockhash'))
  const first = rpcCooldownRemaining()
  await fetcher('https://rpc.test', request('getSlot'))
  expect(rpcCooldownRemaining()).toBeGreaterThan(first)
  resetRpcGate()
  noteRpcAccepted()
  expect(rpcCooldownRemaining()).toBe(0)
})

test('concurrent receipt readers share a request and get their own JSON-RPC id', async () => {
  let calls = 0
  const fetcher = manifestRpcFetch((async () => { calls++; return ok({ meta: { err: null } }) }))
  const [a, b] = await Promise.all([fetcher('https://rpc.test', request('getTransaction', 1)), fetcher('https://rpc.test', request('getTransaction', 2))])
  expect((await a.json()).id).toBe(1)
  expect((await b.json()).id).toBe(2)
  expect(calls).toBe(1)
  await fetcher('https://rpc.test', request('getTransaction', 3))
  expect(calls).toBe(1)
})

test('a missing receipt is retried on the next read', async () => {
  let calls = 0
  const fetcher = manifestRpcFetch((async () => { calls++; return ok(null) }))
  await fetcher('https://rpc.test', request('getTransaction'))
  await fetcher('https://rpc.test', request('getTransaction'))
  expect(calls).toBe(2)
})

test('transaction broadcasts are never automatically retried or deduplicated', async () => {
  let calls = 0
  const fetcher = manifestRpcFetch((async () => { calls++; return new Response('', { status: 429 }) }))
  expect((await fetcher('https://rpc.test', request('sendTransaction'))).status).toBe(429)
  expect(calls).toBe(1)
})
