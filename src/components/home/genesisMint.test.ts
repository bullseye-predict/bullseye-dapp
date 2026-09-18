import { expect, test } from 'bun:test'
import { GENESIS_MINT, GENESIS_TIER_COLOR, GENESIS_TIER_INK, GENESIS_TOTAL_SUPPLY, genesisMint, mintSupplyText } from './genesisMint'
import { GENESIS_SKIN_SLUGS } from './HomePrimitives'

test('the mint table covers every Genesis slot exactly once', () => {
  expect(GENESIS_MINT.map((entry) => entry.slug)).toEqual([...GENESIS_SKIN_SLUGS])
})

/** The announced headline is 9,100. It is summed from the rows rather than
 *  written beside them, so this asserts the rows still add up to what the
 *  banner promises. */
test('the twelve allocations add up to the announced total', () => {
  expect(GENESIS_TOTAL_SUPPLY).toBe(9100)
  expect(GENESIS_MINT.reduce((total, entry) => total + entry.supply, 0)).toBe(9100)
})

test('a multi-part agent splits into its own bodies', () => {
  const bull = genesisMint('12ed-13u11')!
  expect(bull.parts?.map((part) => part.supply)).toEqual([1100, 1200, 1300])
  expect(bull.parts!.reduce((total, part) => total + part.supply, 0)).toBe(bull.supply)
})

/** The sum of the three bodies is not a supply anyone can buy, so it must not
 *  be announced as one - the card and the label name each body instead. */
test('a multi-part agent announces each body, never their sum', () => {
  const bull = genesisMint('12ed-13u11')!
  expect(mintSupplyText(bull)).toBe('1,100 MELEE supply, 1,200 RANGE supply, 1,300 MAGIC supply')
  expect(mintSupplyText(bull)).not.toContain('3,600')
  expect(mintSupplyText(genesisMint('peps1')!)).toBe('100 supply')
  expect(mintSupplyText(genesisMint('c0ke')!)).toBe('OWN IT BY XXX')
})

test('c0ke is not sold and says so in place of a count', () => {
  expect(genesisMint('c0ke')).toMatchObject({ supply: 0, rarity: 'LEGENDARY', claim: 'OWN IT BY XXX' })
  expect(genesisMint('not-a-wrap')).toBeUndefined()
})

/** Neon is the site's signal colour. Spending it on any tier but LEGENDARY
 *  would make a common wrap read as the scarce one. */
test('every tier has a bar colour and an ink, and neon is legendary alone', () => {
  expect(GENESIS_TIER_COLOR.LEGENDARY).toBe('#c7ff00')
  for (const entry of GENESIS_MINT) {
    expect(GENESIS_TIER_COLOR[entry.rarity]).toMatch(/^#[0-9a-f]{6}$/)
    expect(GENESIS_TIER_INK[entry.rarity]).toMatch(/^#[0-9a-f]{6}$/)
    if (entry.rarity !== 'LEGENDARY') expect(GENESIS_TIER_COLOR[entry.rarity]).not.toBe('#c7ff00')
  }
})
