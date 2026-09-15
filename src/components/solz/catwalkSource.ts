import { explorerClusterParam } from '../../../packages/adapters/solana/cluster'
import type { ExplorerVenue } from '../../../packages/adapters/explorer'
import type { CatwalkLane, CatwalkLineupEntry, CatwalkSpot, SolzTeam } from './model'

/**
 * Live reads for the CATWALK board.
 *
 * The board is the merged qualified-team list that feeds Grand Prix. This
 * module is the only place that knows its wire shape; components take the
 * parsed result, per the repo's adapter rule.
 */

/** `seasonIndex` is the number the programme is known by; -1 means the wire did
 *  not carry one. The raw `seasonId` is a storage key, never a label. */
export type CatwalkSeason = { seasonId: string; seasonIndex: number; startsAt: number; endsAt: number }

/**
 * A lineup entry plus the one fact the board may render a price from.
 *
 * `spot` is a BOARD POSITION - where this coin stands in the merged draw. It is
 * not a ladder position, and joining it to one by number renders a coin against
 * a price somebody else paid. What this coin paid travels with the coin, here.
 */
export type CatwalkLineupRow = CatwalkLineupEntry & {
  /** What the holder paid for its seat, from its own bid. Null when unpaid. */
  paidUsdMicros: number | null
  /**
   * True when an operator placed this holder by hand rather than anybody paying.
   *
   * CARRIED, BUT DELIBERATELY NOT RENDERED ON THE PUBLIC BOARD. A seeded row
   * still has no signature, no wallet and no transfer behind it - that is why
   * the backend `seeded` column, the migration CHECKs that stop a seeded row
   * carrying a signature or a paid_at, and the seed script's production
   * refusals all stay exactly as they are, and why the admin panel at :3101
   * still labels these rows "seeded — not a payment" so an operator can see
   * which seats still want a real signature.
   *
   * The owner's launch call is that the public board is the initial teams and
   * shows them as ordinary held seats - same PAID label, same amount, same
   * accessible name - with a real outbid taking a seat over when one arrives.
   * So the flag is parsed and threaded through to `CatwalkRow` for the operator
   * surface and for the day the distinction is wanted back on the board; no
   * public renderer branches on it. See `Metric` in
   * src/components/catwalk/CatwalkSlotRow.tsx.
   */
  seeded: boolean
  /**
   * Market cap in whole US dollars, or NULL when nobody published one.
   *
   * Null is the whole point. DexScreener answers for a mint only when it has a
   * pair with liquidity, so a coin that has just been seeded, or one whose pair
   * the read could not reach, has NO market cap - and a zero there would say
   * the coin is worthless, which is a far larger claim than "unknown". Every
   * renderer must print an em dash for null and never a 0.
   *
   * It is read defensively because the field is arriving upstream in this same
   * run: `marketCapUsd`, then DexScreener's own `marketCap`, then `fdv` as the
   * last resort, on the team record or on the lineup entry beside it.
   */
  marketCapUsd: number | null
}

export type CatwalkBoard = {
  gameKey: string
  activeSlots: number
  lineupSize: number
  season: CatwalkSeason | null
  lineup: CatwalkLineupRow[]
  /** The chain the board's mints live on, when the wire names one. It is what
   *  an explorer link is built from, so a board that names no chain gets no
   *  link rather than a link pointing at the wrong one. */
  explorer: ExplorerVenue | null
}

export type GrandPrixStanding = {
  mint: string
  symbol: string
  name: string
  logoUrl?: string
  color?: string
  wins: number
  losses: number
  matches: number
}

const LANES: CatwalkLane[] = ['outbid', 'champion', 'ranked']

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('The board returned an invalid record.')
  return value as Record<string, any>
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0)

/**
 * A positive US-dollar figure, or null.
 *
 * Deliberately NOT `count`: a market cap arrives as a float, often as a string,
 * and `count` would turn every one of them into 0 - which reads on the board as
 * "this coin is worth nothing" rather than "nobody published a figure". Zero,
 * a negative, a NaN and a missing field all collapse to null, because none of
 * them is a market cap.
 */
export function usdFigure(value: unknown): number | null {
  const amount = typeof value === 'string' ? Number(value) : value
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return null
  return amount
}

/**
 * Market cap, read from wherever the wire happens to carry it.
 *
 * `marketCapUsd` is what this repo asks for; `marketCap` and `fdv` are what
 * DexScreener itself returns through ViewerTokenPriceSource upstream, so both
 * are accepted rather than dropped. FDV is last because it is a different
 * quantity and is only worth showing when no circulating figure exists.
 */
export function parseMarketCapUsd(...records: Array<Record<string, any> | null | undefined>): number | null {
  for (const record of records) {
    if (!record) continue
    const found = usdFigure(record.marketCapUsd) ?? usdFigure(record.marketCap) ?? usdFigure(record.fdv)
    if (found !== null) return found
  }
  return null
}

/**
 * The chain an explorer link is built against.
 *
 * Read from the wire when the board names one, so a devnet board links to
 * devnet. Absent that, the board's own mints are the SOLZ ranked registry's
 * mainnet mints, and `explorerClusterParam` returns no `?cluster=` for mainnet
 * - so this default is the one URL shape that is correct for them. It carries
 * no chainId rather than a guessed genesis hash, because naming the wrong
 * cluster is worse than naming none.
 */
export const DEFAULT_CATWALK_EXPLORER: ExplorerVenue = {
  family: 'SOLANA',
  explorerUrl: 'https://explorer.solana.com',
}

function parseExplorerVenue(value: unknown): ExplorerVenue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, any>
  const explorerUrl = text(raw.explorerUrl)
  if (!explorerUrl) return null
  return {
    family: text(raw.family) || undefined,
    chainId: text(raw.chainId) || undefined,
    explorerUrl,
  }
}

/**
 * An explorer link for a CONTRACT ADDRESS.
 *
 * The sibling of `explorerTxUrl` in packages/adapters/explorer.ts, with the
 * same contract: undefined when the venue declares no explorer, so a caller
 * renders no link rather than one pointing at the wrong chain. The cluster
 * comes from `explorerClusterParam`, never from a table copied into this file -
 * two copies of that table once disagreed and sent testnet links to mainnet.
 *
 * It lives here rather than beside `explorerTxUrl` only because that file is
 * outside this change's ownership; it belongs there.
 */
export function explorerAddressUrl(venue: ExplorerVenue | null | undefined, address: string): string | undefined {
  const base = venue?.explorerUrl?.trim().replace(/\/+$/, '')
  if (!base || !address) return undefined
  if (venue?.family === 'SOLANA') {
    const cluster = explorerClusterParam(venue.chainId)
    return `${base}/address/${encodeURIComponent(address)}${cluster ? `?cluster=${cluster}` : ''}`
  }
  return `${base}/address/${encodeURIComponent(address)}`
}

/**
 * Market cap, compacted. $1.2M reads at a glance where $1,234,567 does not, and
 * the board's whole use for the figure - telling whether the coins below the
 * walk-in band are interchangeable - is a glance comparison.
 *
 * Null renders as an em dash by its callers, never here and never as $0.
 */
export function marketCapLabel(usd: number): string {
  const units: Array<[number, string]> = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']]
  for (const [size, suffix] of units) {
    if (usd >= size) {
      const scaled = usd / size
      return `$${scaled.toLocaleString('en', { maximumFractionDigits: scaled < 10 ? 2 : scaled < 100 ? 1 : 0 })}${suffix}`
    }
  }
  return `$${usd.toLocaleString('en', { maximumFractionDigits: 0 })}`
}

function parseCatwalkSeason(season: Record<string, any>): CatwalkSeason {
  const index = Number.isSafeInteger(season.seasonIndex) && (season.seasonIndex as number) >= 0
    ? (season.seasonIndex as number)
    : -1
  return {
    seasonId: text(season.seasonId),
    seasonIndex: index,
    startsAt: Number(season.startsAt) || 0,
    endsAt: Number(season.endsAt) || 0,
  }
}

/**
 * SEASON plus the index, zero-padded to two digits - the same label /miaw-prix
 * prints from the same season, so the two pages never disagree about which
 * season is being played.
 *
 * Null rather than the raw `seasonId` when the index is missing: `solz-00` is a
 * storage key, and putting it on the page taught viewers a second name for the
 * season that nothing else in the product uses.
 */
export function catwalkSeasonLabel(season: CatwalkSeason | null): string | null {
  if (!season || season.seasonIndex < 0) return null
  return `SEASON ${String(season.seasonIndex).padStart(2, '0')}`
}

/** A registry row. Presentation is optional; identity is not. */
export function parseCatwalkTeam(value: unknown): SolzTeam | null {
  const raw = object(value)
  const mint = text(raw.mint)
  if (!mint) return null
  return {
    id: mint,
    mint,
    tokenProgram: text(raw.tokenProgram) || undefined,
    decimals: Number.isSafeInteger(raw.decimals) ? raw.decimals : undefined,
    logoUrl: text(raw.logoUrl) || undefined,
    symbol: text(raw.symbol, mint.slice(0, 4)),
    name: text(raw.name, mint),
    color: text(raw.color, '#c7ff00'),
    glyph: text(raw.symbol, '').replace(/^\$/, '').slice(0, 3).toUpperCase(),
    status: 'qualified',
    rank: 0,
    wins: 0,
    losses: 0,
    rating: 0,
    ratingDelta: 0,
    streak: '',
    matchesHosted: 0,
    communityPlayers: 0,
    activity: {
      matches: 0, matchesRequired: 0, uniquePlayers: 0, uniquePlayersRequired: 0,
      hostedArenas: 0, hostedArenasRequired: 0, completionRate: 0, progress: 1,
    },
    joinedAt: 0,
    blurb: '',
  }
}

export function parseCatwalkBoard(value: unknown): CatwalkBoard {
  const data = object(value)
  if (data.ok !== true || !Array.isArray(data.lineup)) throw Error('The CATWALK board is unavailable.')
  const season = data.season ? object(data.season) : null
  return {
    gameKey: text(data.gameKey, 'solz'),
    activeSlots: count(data.activeSlots),
    lineupSize: count(data.lineupSize),
    season: season ? parseCatwalkSeason(season) : null,
    lineup: data.lineup.flatMap((raw: unknown): CatwalkLineupRow[] => {
      const entry = object(raw)
      const mint = text(entry.mint)
      const lane = LANES.includes(entry.lane) ? (entry.lane as CatwalkLane) : 'ranked'
      if (!mint) return []
      const bid = entry.bid ? object(entry.bid) : null
      const paid = bid ? count(bid.usdMicros) : 0
      // Parsed and carried for the operator surface, not for the public board -
      // see the field's doc comment on CatwalkLineupRow. Dropping it here would
      // erase the one signal that tells an operator which seats are still the
      // launch placeholders rather than real, signed purchases.
      const seeded = bid?.seeded === true
      const team = entry.team && typeof entry.team === 'object' ? (entry.team as Record<string, any>) : null
      return [{
        spot: count(entry.spot),
        mint,
        lane,
        active: entry.active === true,
        team: entry.team ? parseCatwalkTeam(entry.team) : null,
        paidUsdMicros: paid > 0 ? paid : null,
        seeded,
        // Read from the team record first and the entry second, so whichever
        // side upstream lands the field on is picked up without a second pass
        // here - and absent from both is unknown, never zero.
        marketCapUsd: parseMarketCapUsd(team, entry),
      }]
    }),
    explorer: parseExplorerVenue(data.explorer),
  }
}

/**
 * The spot ladder: the list of seats that are actually for sale.
 *
 * `outbidSpots` is how many seats the sale publishes - exactly the outbid
 * lane's quota. It is carried here because it is what bounds the ladder as a
 * LIST of its own, which is the only honest way to render prices: board
 * positions are numbered 1..lineupSize in lane-priority order and have nothing
 * to do with these numbers, so a board row must never be priced from the seat
 * that happens to share its number.
 */
export type CatwalkLadderRead = {
  available: boolean
  seasonId: string
  outbidSpots: number
  spots: CatwalkSpot[]
}

export function parseCatwalkSpots(value: unknown): CatwalkLadderRead {
  const data = object(value)
  if (data.ok !== true) throw Error('Spot pricing is unavailable.')
  if (data.available !== true) return { available: false, seasonId: '', outbidSpots: 0, spots: [] }
  const spots = (Array.isArray(data.spots) ? data.spots : []).map((raw: unknown): CatwalkSpot => {
    const spot = object(raw)
    // The ladder has always carried who is holding a spot and what they paid;
    // dropping it here forced the board to re-join spots to the lineup by mint
    // for facts this row already answers, and left `heldUsdMicros` unreadable.
    const held = count(spot.heldUsdMicros)
    return {
      spot: count(spot.spot),
      askUsdMicros: count(spot.askUsdMicros),
      mint: text(spot.mint) || undefined,
      symbol: text(spot.symbol) || undefined,
      name: text(spot.name) || undefined,
      logoUrl: text(spot.logoUrl) || undefined,
      heldUsdMicros: held > 0 ? held : undefined,
    }
  })
  // An older server that does not publish the count is not a server with no
  // ladder: what arrived is the ladder, and its length is its length.
  const published = count(data.outbidSpots)
  return {
    available: true,
    seasonId: text(data.seasonId),
    outbidSpots: published > 0 ? published : spots.length,
    spots,
  }
}

export function parseGrandPrixStandings(value: unknown): { season: CatwalkSeason | null; rows: GrandPrixStanding[] } {
  const data = object(value)
  if (data.ok !== true || !Array.isArray(data.rows)) throw Error('Standings are unavailable.')
  const season = data.season ? object(data.season) : null
  return {
    season: season ? parseCatwalkSeason(season) : null,
    rows: data.rows.map((raw: unknown) => {
      const row = object(raw)
      const mint = text(row.mint)
      return {
        mint,
        symbol: text(row.symbol, mint.slice(0, 4)),
        name: text(row.name, mint),
        logoUrl: text(row.logoUrl) || undefined,
        color: text(row.color) || undefined,
        wins: count(row.wins),
        losses: count(row.losses),
        matches: count(row.matches),
      }
    }),
  }
}

/** The record index every CATWALK row reads from.
 *
 *  parseCatwalkTeam fills wins/losses/rating/rank/streak with zeroes because the
 *  team registry does not carry a record at all - it is a coin list, not a
 *  results table. A row that read those fields off its lineup entry would print
 *  `0-0` for a coin that has merely never been indexed, which states an on-chain
 *  result that never happened. Standings are the only payload that reports a
 *  record, so they are the only source a row is allowed to render one from, and
 *  a mint missing from this map renders an em dash rather than a zero.
 */
export function standingsByMint(rows: readonly GrandPrixStanding[]): Map<string, GrandPrixStanding> {
  return new Map(rows.filter((row) => row.mint).map((row) => [row.mint, row]))
}

/** USD micros as a readable price. The ladder is quoted in dollars because the
 *  payment token's price moves and a token figure would reorder paid spots. */
export function usdLabel(usdMicros: number) {
  return `$${(usdMicros / 1_000_000).toLocaleString('en', { maximumFractionDigits: 2 })}`
}

export function catwalkSource(endpoint: string, fetcher: typeof fetch = fetch) {
  const read = async (kind: string, signal?: AbortSignal) => {
    const response = await fetcher(`${endpoint}?kind=${encodeURIComponent(kind)}`, {
      signal,
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      const error = new Error(`The CATWALK board is unavailable (${response.status}).`) as Error & { status: number }
      error.status = response.status
      throw error
    }
    return response.json()
  }
  return {
    board: async (signal?: AbortSignal) => parseCatwalkBoard(await read('catwalk', signal)),
    standings: async (signal?: AbortSignal) => parseGrandPrixStandings(await read('standings', signal)),
    spots: async (signal?: AbortSignal) => parseCatwalkSpots(await read('catwalkSpots', signal)),
  }
}
