/** The Genesis mint table: how many of each agent exist, and at which rarity.
 *
 *  This is the ONE place the collection's numbers live. The card strip, the
 *  whitelist banner, the tier legend and the profile panel all read from here,
 *  so the announced total can never disagree with the twelve rows that make it
 *  up - `GENESIS_TOTAL_SUPPLY` is summed from the table rather than written
 *  down beside it.
 *
 *  Keyed by `skinSlug`, not by slot number, because an agent's artwork and its
 *  mint allocation are the same identity, and the slug is what both the seed
 *  adapter and `genesis_agents` already carry. */

export type GenesisRarity = 'LEGENDARY' | 'EPIC' | 'UNCOMMON' | 'COMMON'

/** One body of a multi-part agent. 12ed 13u11 mints as three separate bodies
 *  rather than one, so its row carries the split its card has to show. */
export type GenesisMintPart = { label: string; supply: number }

export type GenesisMintEntry = {
  slug: string
  rarity: GenesisRarity
  /** Units offered in the sale. Zero means the agent is not sold at all. */
  supply: number
  parts?: GenesisMintPart[]
  /** What the card says in place of a supply count. c0ke has no sale, so a
   *  bare `0 SUPPLY` would read as a missing number rather than a decision. */
  claim?: string
}

/** Slot order, so this list reads against AGENT_SEEDS line for line. */
export const GENESIS_MINT: GenesisMintEntry[] = [
  { slug: 'c0ke', rarity: 'LEGENDARY', supply: 0, claim: 'OWN IT BY XXX' },
  { slug: 'peps1', rarity: 'LEGENDARY', supply: 100 },
  { slug: '2up', rarity: 'EPIC', supply: 200 },
  { slug: 'monst3r', rarity: 'EPIC', supply: 300 },
  { slug: 'fant4', rarity: 'EPIC', supply: 400 },
  { slug: '5prite', rarity: 'EPIC', supply: 500 },
  { slug: '6uiness', rarity: 'UNCOMMON', supply: 600 },
  { slug: '7iger', rarity: 'UNCOMMON', supply: 700 },
  { slug: 'bintan8', rarity: 'UNCOMMON', supply: 800 },
  { slug: 'hei9ken', rarity: 'UNCOMMON', supply: 900 },
  { slug: 'moun10-dew', rarity: 'COMMON', supply: 1000 },
  {
    slug: '12ed-13u11',
    rarity: 'COMMON',
    supply: 3600,
    parts: [{ label: 'MELEE', supply: 1100 }, { label: 'RANGE', supply: 1200 }, { label: 'MAGIC', supply: 1300 }],
  },
]

/** The rarity bar across the top of a card. Neon is LEGENDARY - the site's own
 *  signal colour, spent on the scarcest tier and nothing else - then violet,
 *  blue and gray step down from it. */
export const GENESIS_TIER_COLOR: Record<GenesisRarity, string> = {
  LEGENDARY: '#c7ff00',
  EPIC: '#c58cff',
  UNCOMMON: '#66caff',
  COMMON: '#a6a8b3',
}

/** The ink that bar carries. Each is that tier's own hue taken down to near
 *  black, so the label reads as part of the bar rather than printed on it. */
export const GENESIS_TIER_INK: Record<GenesisRarity, string> = {
  LEGENDARY: '#161d04',
  EPIC: '#1c0f2e',
  UNCOMMON: '#04222f',
  COMMON: '#16171c',
}

/** Summed, never transcribed. A supply edited on one row moves the headline. */
export const GENESIS_TOTAL_SUPPLY = GENESIS_MINT.reduce((total, entry) => total + entry.supply, 0)

/** The early-access date, written once. The banner shows it and nothing else
 *  computes from it, so a change to the sale date is a change to this line. */
export const GENESIS_WHITELIST_DATE = '9 / 10'
export const GENESIS_WHITELIST_YEAR = '2026'

const BY_SLUG = new Map(GENESIS_MINT.map((entry) => [entry.slug, entry]))

/** An agent whose artwork the database has switched to an unlisted wrap has no
 *  allocation, and the card must then show no mint strip rather than a guess. */
export const genesisMint = (slug: string): GenesisMintEntry | undefined => BY_SLUG.get(slug)

export const supplyLabel = (value: number) => value.toLocaleString('en')
