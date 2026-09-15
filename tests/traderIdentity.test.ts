import { beforeEach, expect, test } from 'bun:test'
import {
  isWalletAddress,
  parsePumpProfile,
  pumpProfileUrl,
  shortAddress,
  traderName,
} from '../src/components/identity/profile'
import { resetTraderProfileCache, resolveTraderProfiles } from '../src/server/pump-profiles'

const OWNER = '4qMhJ42sCexUkXgqEkPt9nsyK93d92QeNGKZNyNYPGUb'
const OTHER = '7zp53pV8CCuwLSei1jiQXCtK8w3eqtkUGYoh63KMsBXw'

/** The shape the directory actually returns, trimmed to the fields read. */
const payload = (over: Record<string, unknown> = {}) => ({
  address: OWNER,
  is_pump_user: true,
  username: 'vosum',
  profile_image: 'https://pump.mypinata.cloud/ipfs/QmeM26V188A7jitdfttmD3DQCQH6ZfMXzFbn4VmFZ6vw4j',
  bio: null,
  x_username: null,
  canonical_svm_wallet: OWNER,
  ...over,
})

beforeEach(() => resetTraderProfileCache())

test('wallets are truncated one way, whoever asks', () => {
  expect(shortAddress(OWNER)).toBe('4qMh…PGUb')
  expect(shortAddress(OWNER, 6, 4)).toBe('4qMhJ4…PGUb')
  // Short enough to show whole: an ellipsis that hides nothing is noise.
  expect(shortAddress('abc')).toBe('abc')
})

test('only base58 wallets reach the directory', () => {
  expect(isWalletAddress(OWNER)).toBe(true)
  // A market id is base58 too, but an EVM address, a truncated display string
  // and an empty cell are the things that actually leaked into these lists.
  expect(isWalletAddress('0x8f3a2b1c4d5e6f70819a2b3c4d5e6f7081920304')).toBe(false)
  expect(isWalletAddress('4qMh…PGUb')).toBe(false)
  expect(isWalletAddress(undefined)).toBe(false)
})

test('a registered handle replaces the address', () => {
  const profile = parsePumpProfile(OWNER, payload())
  expect(profile?.username).toBe('vosum')
  expect(profile?.imageUrl).toContain('pump.mypinata.cloud')
  expect(traderName(OWNER, profile)).toBe('vosum')
  expect(traderName(OWNER, null)).toBe('4qMh…PGUb')
})

test('a generated handle for a wallet that never signed up is not a name', () => {
  // The directory names every address it has indexed. "RogueLaceAvenue" beside a
  // real share count is an invented identity, so the address stands instead.
  const profile = parsePumpProfile(OWNER, payload({ is_pump_user: false, username: 'RogueLaceAvenue', profile_image: null }))
  expect(profile).toBeNull()
  expect(traderName(OWNER, profile)).toBe('4qMh…PGUb')
})

test('a filled-in profile counts as a signup even without the flag', () => {
  expect(parsePumpProfile(OWNER, payload({ is_pump_user: false, profile_image: null, bio: 'jelly-my-eeeaawwww' }))?.username).toBe('vosum')
})

test('avatars are taken only from the directory own storage', () => {
  expect(parsePumpProfile(OWNER, payload({ profile_image: 'https://tracker.example/beacon.png' }))?.imageUrl).toBeUndefined()
  expect(parsePumpProfile(OWNER, payload({ profile_image: 'http://pump.fun/a.png' }))?.imageUrl).toBeUndefined()
  expect(parsePumpProfile(OWNER, payload({ profile_image: 'https://socialimages.pump.fun/a.webp' }))?.imageUrl).toBe('https://socialimages.pump.fun/a.webp')
})

test('a payload for a different wallet is discarded', () => {
  expect(parsePumpProfile(OWNER, payload({ address: OTHER, canonical_svm_wallet: OTHER }))).toBeNull()
  expect(parsePumpProfile(OWNER, 'not json')).toBeNull()
})

test('a batch reads each wallet once and remembers the answer', async () => {
  const asked: string[] = []
  const fetcher = async (input: string | URL | Request) => {
    asked.push(String(input))
    return new Response(JSON.stringify(payload({ address: undefined, canonical_svm_wallet: undefined })), { status: 200 })
  }
  const first = await resolveTraderProfiles([OWNER, OWNER, OTHER, 'not-an-address'], {}, fetcher)
  expect(Object.keys(first.profiles).sort()).toEqual([OWNER, OTHER].sort())
  expect(asked).toHaveLength(2)
  expect(asked).toContain(pumpProfileUrl(OWNER))

  const second = await resolveTraderProfiles([OWNER, OTHER], {}, fetcher)
  expect(asked).toHaveLength(2)
  expect(second.profiles[OWNER]?.username).toBe('vosum')
})

test('"no such profile" is an answer; "could not read" is not', async () => {
  let calls = 0
  const fetcher = async (input: string | URL | Request) => {
    calls++
    return String(input).includes(OWNER)
      ? new Response('{"message":"User not found"}', { status: 404 })
      : new Response('upstream on fire', { status: 503 })
  }
  const first = await resolveTraderProfiles([OWNER, OTHER], {}, fetcher)
  expect(first.profiles[OWNER]).toBeNull()
  expect(first.unavailable).toEqual([OTHER])
  expect(calls).toBe(2)

  // The 404 is cached, the failure is not: a bad minute upstream must not pin a
  // wallet to "unknown" for the next hour.
  await resolveTraderProfiles([OWNER, OTHER], {}, fetcher)
  expect(calls).toBe(3)
})

test('a directory that throws leaves the wallet unnamed rather than failing the read', async () => {
  const batch = await resolveTraderProfiles([OWNER], {}, async () => { throw new Error('offline') })
  expect(batch.profiles[OWNER]).toBeUndefined()
  expect(batch.unavailable).toEqual([OWNER])
})
