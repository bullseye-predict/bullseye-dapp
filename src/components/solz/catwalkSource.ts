import { explorerClusterParam } from '../../../packages/adapters/solana/cluster'
import { rememberValue } from './liveCache'
import { miawPrixBoardKey, parseMiawPrixBoard } from '../miawprix/miawPrixSource'
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
   * Market cap in whole US dollars, or NULL when nobody published one.
   *
   * Null is the whole point. DexScreener answers for a mint only when it has a
   * pair with liquidity, so a coin that has only just launched, or one whose pair
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

/**
 * HOW MANY SEATS EACH LANE IS GUARANTEED, PER BAND.
 *
 * The server publishes the EFFECTIVE, already-clamped plan its lineup builder
 * honours - not the raw settings - so a panel quoting these figures can never
 * state a guarantee the board does not keep. Beyond its guarantee a lane may
 * still take spots another lane cannot fill, and it hands them straight back on
 * the next read; that spill is not a guarantee and is deliberately not carried.
 */
export type CatwalkSeatPlan = {
  runway: Record<CatwalkLane, number>
  lineup: Record<CatwalkLane, number>
}

export type CatwalkBoard = {
  gameKey: string
  activeSlots: number
  lineupSize: number
  /**
   * How long before a walk its board stops moving, or NULL when the wire did
   * not carry it.
   *
   * Null is the honest degradation and the reason this is nullable at all: the
   * page used to HARDCODE twelve hours, so an operator who moved `lockLeadMs`
   * got a countdown to the wrong instant under copy stating the wrong rule. A
   * server that has not shipped the field yet is not a server with no lock -
   * the caller falls back to the shared constant and, crucially, stops claiming
   * a specific number of hours in words.
   */
  lockLeadMs: number | null
  season: CatwalkSeason | null
  lineup: CatwalkLineupRow[]
  /**
   * The guaranteed seat plan, or NULL when the wire did not carry a whole,
   * readable one.
   *
   * Null is the only honest degradation. A server that has not shipped the field
   * yet is not a board that guarantees nothing, and a partial plan is not a plan
   * - so anything short of every lane of both bands arriving as a finite
   * non-negative integer collapses the WHOLE field to null, and the renderer
   * omits the guarantee rather than printing a figure it remembered.
   */
  seats: CatwalkSeatPlan | null
  /**
   * What the SOLZ ranked registry read did, or null when the wire said nothing.
   *
   * It has always been on the payload and was always dropped here, which left
   * the ranked lane unable to tell "the registry has not been read" from "the
   * registry lists nobody" - two facts one sentence away from each other and a
   * whole lie apart, exactly as `LadderState` and `StandingsState` keep theirs.
   */
  rankedLane: CatwalkRankedLaneRead | null
  /**
   * WHEN A SEAT WAS LAST PAID FOR, in epoch milliseconds, or null.
   *
   * An AGGREGATE - `MAX(paid_at)` over the active bids of this season - and
   * deliberately nothing finer. A per-row `paidAt` would put a purchase time
   * beside a coin on an unauthenticated endpoint, which is the boundary
   * /api/v1/catwalk states it keeps; one board-wide instant carries no wallet
   * and identifies nobody.
   *
   * Null is the only honest absence. It covers a server that does not publish
   * the field, a board where nothing has been paid for, and a timestamp that
   * did not parse - and the renderer prints an em dash for all three rather
   * than an epoch zero, which would date the last sale to 1970.
   */
  lastSeatPaidAt: number | null
  /** The chain the board's mints live on, when the wire names one. It is what
   *  an explorer link is built from, so a board that names no chain gets no
   *  link rather than a link pointing at the wrong one. */
  explorer: ExplorerVenue | null
}

/**
 * ONE COIN ON THE SOLZ RANKED LADDER, as the chain answered for it.
 *
 * THE THREE FIGURES ARE DECIMAL STRINGS AND THEY STAY STRINGS. `matches` and
 * `playerEntries` are u64 on chain and `poolBaseUnits` is a u128 that
 * accumulates a stake total per finalized match - past Number.MAX_SAFE_INTEGER
 * a coercion does not throw, it ROUNDS, and the column then shows a wrong
 * figure that looks entirely plausible. Nothing in this repo may call Number()
 * on them; the one renderer that scales the pool does it with BigInt.
 *
 * Each is null when the wire did not carry a readable one, and null renders as
 * an em dash. NEVER a zero: a coin with no finalized matches and a coin whose
 * figure did not parse are two different statements about that coin's record.
 *
 * `poolDecimals` is THIS PROJECT'S OWN stake-token scale, which is why it
 * travels on the row rather than in a constant. The pool figure is denominated
 * in each coin's own stake token: it is not dollars, it is not comparable down
 * the column, and it does not add up.
 */
export type CatwalkRankedProjectRow = {
  mint: string
  symbol: string
  name: string
  logoUrl: string | null
  matches: string | null
  playerEntries: string | null
  poolBaseUnits: string | null
  poolDecimals: number | null
}

export type CatwalkRankedLaneRead = {
  state: string
  candidates: number
  /** The ladder itself, in the order the chain decided. The page NEVER re-sorts
   *  it: the order is finalized matches DESC with a stable tie-break, settled
   *  once upstream, and a second sort here would be a second opinion. */
  projects: CatwalkRankedProjectRow[]
  /** How many tokens the identity registry names, or null when unreadable. It
   *  is NOT `candidates`, which counts the chain's non-native project records. */
  registryTokens: number | null
  registryUpdatedAt: string | null
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

/**
 * An epoch-millisecond instant, or null.
 *
 * ZERO IS NOT AN INSTANT. `count` would turn a missing field into 0 and a
 * renderer would date the last sale to 1 January 1970 - a stated fact about the
 * board built out of nobody having answered. A float, a string, a negative and
 * a NaN are all refused for the same reason: none of them is a timestamp this
 * page can put an age against.
 */
const timestamp = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null

/** A whole number of seats, or null. NOT `count`: `count` turns a missing field,
 *  a string and a float alike into 0, and a 0 here is a stated guarantee of
 *  nothing rather than the absence of one. */
const seatCount = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null

/** One band's three lanes, or null the moment any one of them is unreadable. */
function parseLaneSeats(value: unknown): Record<CatwalkLane, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, any>
  const plan = {} as Record<CatwalkLane, number>
  for (const lane of LANES) {
    const seats = seatCount(raw[lane])
    if (seats === null) return null
    plan[lane] = seats
  }
  return plan
}

/**
 * The seat plan, read all-or-nothing.
 *
 * A HALF-READ PLAN IS NOT A PLAN. If the runway parsed and the line-up did not,
 * a renderer holding the half would print "GUARANTEED 4" beside a band it knows
 * nothing about - which reads as a guarantee of none. Absent, malformed, or
 * carrying one unreadable lane all give the same answer: nobody has told us,
 * so nothing is said.
 */
export function parseCatwalkSeatPlan(value: unknown): CatwalkSeatPlan | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, any>
  const runway = parseLaneSeats(raw.runway)
  const lineup = parseLaneSeats(raw.lineup)
  if (!runway || !lineup) return null
  return { runway, lineup }
}

/**
 * A u64/u128 figure as it crosses JSON: a string of digits, or null.
 *
 * DELIBERATELY NOT A NUMBER AND DELIBERATELY NOT `count`. These figures are
 * chain counters - one of them a u128 - and `Number(...)` on a value past
 * MAX_SAFE_INTEGER rounds silently rather than failing, so the column would
 * print a plausible wrong total. The digits are carried verbatim and scaled
 * with BigInt at the one place a scale is needed.
 *
 * A number on the wire is refused rather than stringified: a server that sent
 * one has already lost the precision this type exists to keep, and accepting it
 * would hide that.
 */
const wireDigits = (value: unknown): string | null =>
  typeof value === 'string' && /^\d+$/.test(value) ? value : null

/** A token's own decimal scale, 0..255. Null when unreadable - and a null here
 *  nulls the whole pool cell, because base units nobody can scale are not a
 *  figure, they are a number of the wrong size. */
const tokenDecimals = (value: unknown): number | null =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 255 ? (value as number) : null

/** A mint the identity file does not name is SHOWN by its address, head and
 *  tail. The lane has to be legible rather than curated: a coin that has
 *  finalized ranked matches is on the ladder whether or not a registry file has
 *  caught up with its ticker. */
const shortMint = (mint: string) => (mint.length > 9 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint)

/**
 * ONE LADDER ROW, or nothing at all.
 *
 * A row with NO MINT is dropped entirely - the mint is the join key and the
 * identity of the thing, exactly as a lineup entry with no mint is dropped
 * above. Every FIGURE, by contrast, is independent: an unreadable `matches`
 * nulls that cell and keeps the row, because the coin is still on the ladder
 * and the rest of what the chain said about it is still true.
 */
function parseRankedProject(value: unknown): CatwalkRankedProjectRow[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const raw = value as Record<string, any>
  const mint = text(raw.mint)
  if (!mint) return []
  return [{
    mint,
    symbol: text(raw.symbol) || shortMint(mint),
    name: text(raw.name) || mint,
    logoUrl: text(raw.logoUrl) || null,
    matches: wireDigits(raw.matches),
    playerEntries: wireDigits(raw.playerEntries),
    poolBaseUnits: wireDigits(raw.poolBaseUnits),
    poolDecimals: tokenDecimals(raw.poolDecimals),
  }]
}

/**
 * The ranked registry read, or null when the wire carried no usable one.
 *
 * THE HEAD IS STILL ALL-OR-NOTHING. A state with no candidate count is not a
 * read this page can reason about, so those two are required together or the
 * WHOLE read is null - unchanged, and the thing tests/catwalkSource.test.ts
 * exists to hold.
 *
 * EVERYTHING ADDED BELOW IT DEGRADES ON ITS OWN. A server that has not shipped
 * `projects` yet is not a ladder with nobody on it: the list comes back empty
 * and the renderer draws no list, because the list is gated on `state` and
 * never on `projects.length`. Same for the registry depth - each half of that
 * sentence is omitted when its own field is unreadable rather than guessed.
 */
export function parseCatwalkRankedLane(value: unknown): CatwalkRankedLaneRead | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, any>
  const state = text(raw.state)
  const candidates = seatCount(raw.candidates)
  if (!state || candidates === null) return null
  return {
    state,
    candidates,
    projects: Array.isArray(raw.projects) ? raw.projects.flatMap(parseRankedProject) : [],
    registryTokens: seatCount(raw.registryTokens),
    registryUpdatedAt: text(raw.registryUpdatedAt) || null,
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
    // A lead of zero is not a lead, and a lead that is not a positive finite
    // number is not one either. Both collapse to null so a renderer falls back
    // rather than counting to now.
    lockLeadMs: Number.isFinite(data.lockLeadMs) && Number(data.lockLeadMs) > 0 ? Number(data.lockLeadMs) : null,
    season: season ? parseCatwalkSeason(season) : null,
    lineup: data.lineup.flatMap((raw: unknown): CatwalkLineupRow[] => {
      const entry = object(raw)
      const mint = text(entry.mint)
      const lane = LANES.includes(entry.lane) ? (entry.lane as CatwalkLane) : 'ranked'
      if (!mint) return []
      // A holder is a price and nothing else. `/api/v1/catwalk` no longer
      // publishes `seeded`, `wallet` or `paidAt`, and none of them is read
      // here: a buyer's wallet does not belong on an unauthenticated endpoint,
      // and the board draws no placeholder-versus-payment distinction. A bid
      // that is missing, or that is not a record at all, is simply no price -
      // it must not take the board down while the two repos land.
      const bid = entry.bid && typeof entry.bid === 'object' && !Array.isArray(entry.bid)
        ? (entry.bid as Record<string, any>)
        : null
      const paid = bid ? count(bid.usdMicros) : 0
      const team = entry.team && typeof entry.team === 'object' ? (entry.team as Record<string, any>) : null
      return [{
        spot: count(entry.spot),
        mint,
        lane,
        active: entry.active === true,
        team: entry.team ? parseCatwalkTeam(entry.team) : null,
        paidUsdMicros: paid > 0 ? paid : null,
        // Read from the team record first and the entry second, so whichever
        // side upstream lands the field on is picked up without a second pass
        // here - and absent from both is unknown, never zero.
        marketCapUsd: parseMarketCapUsd(team, entry),
      }]
    }),
    seats: parseCatwalkSeatPlan(data.seats),
    rankedLane: parseCatwalkRankedLane(data.rankedLane),
    lastSeatPaidAt: timestamp(data.lastSeatPaidAt),
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
  configuredSeats?: number
  closedReason?: string
  available: boolean
  seasonId: string
  outbidSpots: number
  spots: CatwalkSpot[]
}

export function parseCatwalkSpots(value: unknown): CatwalkLadderRead {
  const data = object(value)
  if (data.ok !== true) throw Error('Spot pricing is unavailable.')
  if (data.available !== true) return { available: false, seasonId: '', outbidSpots: 0, spots: [], configuredSeats: count(data.configuredSeats), closedReason: text(data.closedReason) }
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

/**
 * ONE RECORDED WALK'S HEADER - enough to name it in a picker, and no board.
 *
 * `lineupSize` is the SNAPSHOT'S own length, not today's board size: an admin
 * who has since widened the board must not make a past twelve-coin walk read as
 * a short thirty-six.
 */
export type CatwalkCycleHeader = {
  cycleIndex: number
  seasonId: string
  matchCount: number
  lineupSize: number
  startsAt: number
  endsAt: number
  lockedAt: number
}

/** One recorded walk, as the board actually stood when it locked. */
export type CatwalkCycle = CatwalkCycleHeader & {
  activeSlots: number
  lineup: CatwalkLineupRow[]
}

const cycleHeader = (raw: Record<string, any>): CatwalkCycleHeader => ({
  cycleIndex: count(raw.cycleIndex),
  seasonId: text(raw.seasonId),
  matchCount: count(raw.matchCount),
  lineupSize: count(raw.lineupSize),
  startsAt: Number(raw.startsAt) || 0,
  endsAt: Number(raw.endsAt) || 0,
  lockedAt: Number(raw.lockedAt) || 0,
})

export function parseCatwalkCycles(value: unknown): CatwalkCycleHeader[] {
  const data = object(value)
  if (data.ok !== true || !Array.isArray(data.cycles)) throw Error('Recorded walks are unavailable.')
  // Newest first is the server's order and it is kept, because a picker's first
  // option should be the most recent walk rather than the season's opener.
  return data.cycles.map((raw: unknown) => cycleHeader(object(raw)))
}

/**
 * ONE RECORDED BOARD.
 *
 * `paidUsdMicros` is NULL on every row and that is deliberate, not an omission:
 * the snapshot recorded who stood where, never what anybody paid, and a price
 * read off today's ladder would attach a live figure to a board that locked
 * weeks ago. Market cap is null for the same reason - it is today's figure, and
 * this is not today's board.
 */
export function parseCatwalkCycle(value: unknown): CatwalkCycle {
  const data = object(value)
  if (data.ok !== true || !data.cycle) throw Error('That walk is unavailable.')
  const cycle = object(data.cycle)
  const lineup = Array.isArray(cycle.lineup) ? cycle.lineup : []
  return {
    ...cycleHeader(cycle),
    activeSlots: count(cycle.activeSlots),
    lineup: lineup.flatMap((raw: unknown): CatwalkLineupRow[] => {
      const entry = object(raw)
      const mint = text(entry.mint)
      if (!mint) return []
      return [{
        spot: count(entry.spot),
        mint,
        lane: LANES.includes(entry.lane) ? (entry.lane as CatwalkLane) : 'ranked',
        active: entry.active === true,
        team: entry.team ? parseCatwalkTeam(entry.team) : null,
        paidUsdMicros: null,
        marketCapUsd: null,
      }]
    }),
  }
}

/**
 * The cache key one CATWALK read is remembered under: its own request URL.
 *
 * Exported because the READER needs it too - a hook seeds its first frame with
 * `cachedValue(catwalkReadKey(endpoint, 'catwalk'))`. Building the string twice
 * is how the writer and the reader drift apart and the seed quietly stops
 * working, so there is one builder and two callers.
 */
export function catwalkReadKey(endpoint: string, kind: string): string {
  return `${endpoint}?${new URLSearchParams({ kind })}`
}

export function catwalkSource(endpoint: string, fetcher: typeof fetch = fetch) {
  const read = async (kind: string, signal?: AbortSignal, params?: Record<string, string>) => {
    const query = new URLSearchParams({ kind, ...(params ?? {}) })
    const response = await fetcher(`${endpoint}?${query}`, {
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
  /** Whether this source is on the realm's OWN transport.
   *
   *  Only its answers become the realm's memory. A source built on an injected
   *  fetcher is a caller's private wire - a test's, most often - and writing
   *  its answer under the shared key would hand the next island a board that
   *  never came off this page's network. */
  const ours = fetcher === fetch
  /** Read, parse, and remember the parsed answer under its request URL so the
   *  next island to mount paints it on its first frame. See
   *  src/components/solz/liveCache.ts - this seeds a frame, it never skips a
   *  read. */
  const keep = async <T>(kind: string, parse: (payload: unknown) => T, signal?: AbortSignal): Promise<T> => {
    const value = parse(await read(kind, signal))
    return ours ? rememberValue(catwalkReadKey(endpoint, kind), value).value : value
  }
  return {
    board: async (signal?: AbortSignal) => keep('catwalk', parseCatwalkBoard, signal),
    standings: async (signal?: AbortSignal) => keep('standings', parseGrandPrixStandings, signal),
    spots: async (signal?: AbortSignal) => keep('catwalkSpots', parseCatwalkSpots, signal),
    /**
     * THE MIAW PRIX PROGRAMME, read for one fact: when this board next locks.
     *
     * The board carries no lock and no rotation cadence (see
     * src/components/catwalk/catwalkLock.ts), so the only way to state one is
     * to read the schedule the lock is derived from. This is transport only -
     * `parseMiawPrixBoard` still owns that wire shape, exactly as it does for
     * /miaw-prix, so the two pages can never disagree about what arrived.
     */
    schedule: async (signal?: AbortSignal) => {
      // Remembered under the PROGRAMME's own key, not a CATWALK one: this is
      // byte-for-byte the read /miaw-prix and the home hero make, so one board
      // in the cache serves all three rather than three copies that age apart.
      const board = parseMiawPrixBoard(await read('miawPrix', signal))
      return ours ? rememberValue(miawPrixBoardKey(endpoint), board).value : board
    },
    /**
     * THE WALKS ALREADY RECORDED - the index, then one board.
     *
     * Two calls rather than one payload carrying every snapshot: the index is
     * what a picker needs to draw itself, and shipping thirty-six coins per
     * recorded walk to fill a dropdown would make the page slower the longer
     * the season ran.
     */
    cycles: async (signal?: AbortSignal) => parseCatwalkCycles(await read('catwalkCycles', signal)),
    cycle: async (cycleIndex: number, signal?: AbortSignal) =>
      parseCatwalkCycle(await read('catwalkCycles', signal, { cycle: String(cycleIndex) })),
  }
}
