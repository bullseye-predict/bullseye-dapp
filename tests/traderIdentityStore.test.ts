import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  requestTraderProfiles,
  resetTraderProfiles,
  traderProfileEntry,
} from '../src/components/identity/store'

const A = '4qMhJ42sCexUkXgqEkPt9nsyK93d92QeNGKZNyNYPGUb'
const B = '7zp53pV8CCuwLSei1jiQXCtK8w3eqtkUGYoh63KMsBXw'
const C = 'GZUGFuycotBRQUKdts9shDYqCkYPJtJiBLfLr3ZLTLbT'

const realFetch = globalThis.fetch
let bodies: string[] = []
let reply: (addresses: string[]) => Response

/** The store refuses to fetch outside a browser, which is what keeps a server
 *  render from calling a relative URL with no origin. */
beforeEach(() => {
  ;(globalThis as { window?: unknown }).window = globalThis
  resetTraderProfiles()
  bodies = []
  reply = (addresses) => Response.json({
    profiles: Object.fromEntries(addresses.map(address => [address, { address, source: 'pump', username: `name-${address.slice(0, 4)}` }])),
    unavailable: [],
  })
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = String(init?.body ?? '{}')
    bodies.push(body)
    return reply((JSON.parse(body) as { addresses: string[] }).addresses)
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  delete (globalThis as { window?: unknown }).window
  resetTraderProfiles()
})

const settle = () => new Promise(resolve => setTimeout(resolve, 60))

test('a list of rows asking one at a time still costs one request', async () => {
  // This is the whole reason the store exists: forty holder rows each call
  // useTraderProfile in the same commit, and forty connections to a directory
  // for one panel is not a directory, it is a denial of service on yourself.
  for (const address of [A, B, C, A]) requestTraderProfiles([address])
  await settle()
  expect(bodies).toHaveLength(1)
  expect(JSON.parse(bodies[0]!).addresses.sort()).toEqual([A, B, C].sort())
  expect(traderProfileEntry(A)?.profile?.username).toBe('name-4qMh')
})

test('a wallet already resolved is not asked about again', async () => {
  requestTraderProfiles([A])
  await settle()
  requestTraderProfiles([A, B])
  await settle()
  expect(bodies).toHaveLength(2)
  expect(JSON.parse(bodies[1]!).addresses).toEqual([B])
})

test('anything that is not a wallet never reaches the directory', async () => {
  requestTraderProfiles([undefined, '', '0xabc', '4qMh…PGUb'])
  await settle()
  expect(bodies).toHaveLength(0)
})

test('a directory that is down leaves the wallet unnamed and retryable', async () => {
  globalThis.fetch = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  requestTraderProfiles([A])
  await settle()
  expect(traderProfileEntry(A)?.status).toBe('unavailable')
  expect(traderProfileEntry(A)?.profile).toBeNull()
})

test('an answered "no handle" is remembered, not retried on every render', async () => {
  reply = (addresses) => Response.json({ profiles: Object.fromEntries(addresses.map(a => [a, null])), unavailable: [] })
  requestTraderProfiles([A])
  await settle()
  expect(traderProfileEntry(A)).toEqual({ status: 'ready', profile: null, at: expect.any(Number) })
  requestTraderProfiles([A])
  await settle()
  expect(bodies).toHaveLength(1)
})
