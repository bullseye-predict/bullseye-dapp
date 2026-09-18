import { expect, test } from 'bun:test'
import { arenaWrapSlug } from './AgentArenaApp'
import { GENESIS_SKIN_SLUGS } from '../home/HomePrimitives'
import { genesisMint } from '../home/genesisMint'

/** `slot` is zero-based on the wire and agentSkinSlug takes the numeral the
 *  agent carries, so the two are one apart. Reading the slot straight through
 *  returned the PREVIOUS agent's wrap for every row but the first, and the live
 *  API hides it by sending skinSlug - only the legacy shape reaches the
 *  fallback. This pins the offset rather than trusting the field to be there. */
test('a slot resolves to its own wrap when the API omits skinSlug', () => {
  const resolved = GENESIS_SKIN_SLUGS.map((_, slot) => arenaWrapSlug({ slot, skinSlug: undefined }))
  expect(resolved).toEqual([...GENESIS_SKIN_SLUGS])
  expect(arenaWrapSlug({ slot: 0, skinSlug: undefined })).toBe('c0ke')
  expect(arenaWrapSlug({ slot: 1, skinSlug: undefined })).toBe('peps1')
  expect(arenaWrapSlug({ slot: 11, skinSlug: undefined })).toBe('12ed-13u11')
})

test('a wrap the API does send wins over the slot', () => {
  expect(arenaWrapSlug({ slot: 0, skinSlug: 'hei9ken' })).toBe('hei9ken')
})

/** Every slot the arena can return has a rarity, or its row shows no tier. */
test('every arena slot maps onto a mint row', () => {
  for (let slot = 0; slot < GENESIS_SKIN_SLUGS.length; slot++) {
    expect(genesisMint(arenaWrapSlug({ slot, skinSlug: undefined }))).toBeDefined()
  }
})
