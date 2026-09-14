import { expect, test } from 'bun:test'
import { manifestRpcFetch } from './rpc'

const request = (method: string, id = 1) => ({ method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method, params: ['fixture'], id }) })
const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { headers: { 'content-type': 'application/json' } })

test('RPC retries throttled blockhash reads before the wallet is asked to sign', async () => {
  let calls = 0
  const waits: number[] = []
  const fetcher = manifestRpcFetch((async () => ++calls < 3 ? new Response('', { status: 429 }) : ok('hash')), async ms => { waits.push(ms) })
  expect((await (await fetcher('https://rpc.test', request('getLatestBlockhash'))).json()).result).toBe('hash')
  expect(calls).toBe(3)
  expect(waits).toEqual([500, 1000])
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
