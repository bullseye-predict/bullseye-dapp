/**
 * Live reads for the MIAW PRIX programme.
 *
 * Two independent sources meet on this page and they are deliberately not
 * merged upstream:
 *
 *  - The programme itself (season, schedule, results, standings) comes from the
 *    game control plane through the same-origin arena proxy.
 *  - Prediction-market VOLUME is on-chain money. It is served by the prediction
 *    stake-api and joined here, client side, on the canonical matchId. Putting
 *    a traded figure inside the programme payload would make the game server
 *    the authority on liquidity, which it is not.
 *
 * This module is the only place that knows either wire shape; components take
 * the parsed result, per the repo's adapter rule.
 */

export type MiawPrixSeasonStatus = 'upcoming' | 'live' | 'closed'

export type MiawPrixSeason = {
  seasonId: string
  /** The number the programme is known by. Local/testing opens at 0 — "SEASON 00". */
  seasonIndex: number
  startsAt: number
  endsAt: number
  status: MiawPrixSeasonStatus
}

/** One side of a match. A team IS the coin, so identity is the mint. */
export type MiawPrixCoinSide = {
  teamId: string
  mint: string
  symbol: string
  name: string
  logoUrl?: string
  color?: string
}

export type MiawPrixStanding = {
  mint: string
  symbol: string
  name: string
  logoUrl?: string
  color?: string
  wins: number
  losses: number
  matches: number
  /** Reported market capitalisation in USD, or null when the programme did not
   *  report one. NULL IS NOT ZERO: the field is joined from a price source the
   *  game server does not own, so a coin it could not price still walks, and
   *  printing $0 for it would state a valuation nobody published.
   *
   *  Optional rather than required so that a row built from an older payload —
   *  or a fixture — is UNKNOWN rather than a type error; `marketCapCell()` reads
   *  undefined and null as the same fact, and neither as a figure. */
  marketCapUsd?: number | null
}

export type MiawPrixMatch = {
  matchId: string
  /** The short id a human reads. Never used as a join key. */
  displayMatchId: string
  /** Epoch ms. 0 when the programme has not scheduled it yet. */
  scheduledStartAt: number
  status: string
  definitionId: string
  title: string
  /** Empty until CATWALK binds the pairing. An empty array is "not locked yet",
   *  never "no opponents" — the page must not invent teams to fill it. */
  sides: MiawPrixCoinSide[]
  result: { winnerTeamId: string; winnerMint: string } | null
  rewardPoolL: number | null
}

export type MiawPrixBoard = {
  season: MiawPrixSeason | null
  seasons: MiawPrixSeason[]
  standings: MiawPrixStanding[]
  matches: MiawPrixMatch[]
}

/** What the prediction catalogue knows about one match.
 *
 *  `listed` and `volumeUsd` answer different questions and the page must keep
 *  them apart: a match absent from the catalogue has no market at all, while a
 *  listed match with no reported figure has a market whose traded volume this
 *  build cannot state. Neither is "$0". */
export type MiawPrixMarketSummary = { listed: boolean; volumeUsd: number | null }

export type MiawPrixMarkets = Map<string, MiawPrixMarketSummary>

/**
 * The catalogue read, as one of THREE states.
 *
 * An empty `Map` used to stand for both "not read yet" and "read and this match
 * is not listed", which made the volume column announce "No prediction market
 * opened for this match" on every row during the normal load window, and
 * permanently whenever the catalogue was down. Those are different facts and
 * only the last of them is about the match, so the map exists only in the state
 * that actually holds an answer — the ambiguous pair is unrepresentable.
 *
 * Same discipline as the CATWALK spot ladder (`LadderState` in
 * src/components/catwalk/useCatwalkBoard.ts): a read that FAILED is not a read
 * that came back empty.
 */
export type MiawPrixMarketsState =
  | { status: 'unread' }
  | { status: 'failed' }
  | { status: 'read'; byMatch: MiawPrixMarkets }

/** Nobody has answered yet. The volume column may claim nothing at all. */
export const MARKETS_UNREAD: MiawPrixMarketsState = { status: 'unread' }

/** The catalogue could not be read. This says nothing about any match. */
export const MARKETS_FAILED: MiawPrixMarketsState = { status: 'failed' }

/** The catalogue answered. Absence from `byMatch` is now a fact about the match. */
export function marketsRead(byMatch: MiawPrixMarkets): MiawPrixMarketsState {
  return { status: 'read', byMatch }
}

const SEASON_STATUS: MiawPrixSeasonStatus[] = ['upcoming', 'live', 'closed']

function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('MIAW PRIX returned an invalid record.')
  return value as Record<string, any>
}

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const count = (value: unknown) => (Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : 0)

/** A non-negative finite figure, from a number or from the string a Postgres
 *  `numeric` serialises to. Anything else — absent, null, NaN, negative, an
 *  object — is NOT a figure and comes back null so the column can say "unknown"
 *  rather than invent a bound. */
function figure(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
  }
  return null
}

/**
 * Market capitalisation for a standings row, read defensively.
 *
 * The field is being added to the programme payload by the service, not by this
 * client, and the wire spelling is not settled — micros are how this codebase
 * already carries USD (`volumeUsdMicros`), but a plain dollar figure and a
 * snake_case column name are both live possibilities. Every spelling it might
 * arrive as is read here, and an absent one stays NULL.
 *
 * Absence must survive all the way to the cell. A `?? 0` anywhere on this path
 * would turn "the price source has not answered for this coin" into "this coin
 * is worth nothing", which is a claim about the coin.
 */
export function standingMarketCapUsd(row: Record<string, any>): number | null {
  const micros = figure(row.marketCapUsdMicros)
  if (micros !== null) return micros / 1_000_000
  for (const key of ['marketCapUsd', 'marketCap', 'market_cap_usd', 'market_cap']) {
    const reported = figure(row[key])
    if (reported !== null) return reported
  }
  return null
}

/** Timestamps arrive as epoch ms from the control plane and as ISO strings from
 *  every catalogue read that predates it. Accepting both here keeps one clock
 *  type — epoch ms — in the components, instead of each of them guessing. */
export function moment(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'string' && value) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function parseMiawPrixSeason(value: unknown): MiawPrixSeason | null {
  const raw = object(value)
  const seasonId = text(raw.seasonId)
  if (!seasonId) return null
  const status = SEASON_STATUS.includes(raw.status) ? (raw.status as MiawPrixSeasonStatus) : 'upcoming'
  // Season 0 is a real season, so a missing index must not silently become it.
  const index = Number.isSafeInteger(raw.seasonIndex) && (raw.seasonIndex as number) >= 0
    ? (raw.seasonIndex as number)
    : seasonIndexFromId(seasonId)
  return { seasonId, seasonIndex: index, startsAt: moment(raw.startsAt), endsAt: moment(raw.endsAt), status }
}

/** The id is `<game_key>-<index>` by contract (RANKED_TERMINOLOGY 4.110), so a
 *  payload that omits the number still carries it. Reading it back is what lets
 *  an older row be ordered and labelled as a season rather than shown as the
 *  raw key, which the UI may never print. -1 when the id encodes nothing. */
function seasonIndexFromId(seasonId: string): number {
  const suffix = /-(\d{1,6})$/.exec(seasonId)
  return suffix ? Number(suffix[1]) : -1
}

function parseSide(value: unknown): MiawPrixCoinSide | null {
  const raw = object(value)
  const mint = text(raw.mint)
  const teamId = text(raw.teamId, mint)
  if (!mint && !teamId) return null
  return {
    teamId: teamId || mint,
    mint,
    symbol: text(raw.symbol, mint.slice(0, 4) || teamId),
    name: text(raw.name, mint || teamId),
    logoUrl: text(raw.logoUrl) || undefined,
    color: text(raw.color) || undefined,
  }
}

export function parseMiawPrixBoard(value: unknown): MiawPrixBoard {
  const data = object(value)
  if (data.ok !== true) throw Error('The MIAW PRIX programme is unavailable.')
  const seasons = (Array.isArray(data.seasons) ? data.seasons : [])
    .flatMap((raw: unknown) => { const season = parseMiawPrixSeason(raw); return season ? [season] : [] })
  return {
    season: data.season ? parseMiawPrixSeason(data.season) : null,
    seasons,
    standings: (Array.isArray(data.standings) ? data.standings : []).flatMap((raw: unknown): MiawPrixStanding[] => {
      const row = object(raw)
      const mint = text(row.mint)
      if (!mint) return []
      return [{
        mint,
        symbol: text(row.symbol, mint.slice(0, 4)),
        name: text(row.name, mint),
        logoUrl: text(row.logoUrl) || undefined,
        color: text(row.color) || undefined,
        wins: count(row.wins),
        losses: count(row.losses),
        matches: count(row.matches),
        marketCapUsd: standingMarketCapUsd(row),
      }]
    }),
    matches: (Array.isArray(data.matches) ? data.matches : []).flatMap((raw: unknown): MiawPrixMatch[] => {
      const match = object(raw)
      const matchId = text(match.matchId)
      // The matchId is the join key for on-chain volume and the identity of the
      // result. A row without one cannot be reconciled with anything, so it is
      // dropped rather than rendered as a row that will never resolve.
      if (!matchId) return []
      const result = match.result ? object(match.result) : null
      const rewardPoolL = typeof match.rewardPoolL === 'number' && Number.isFinite(match.rewardPoolL) ? match.rewardPoolL : null
      return [{
        matchId,
        displayMatchId: text(match.displayMatchId, matchId.slice(0, 10)),
        scheduledStartAt: moment(match.scheduledStartAt),
        status: text(match.status, 'scheduled'),
        definitionId: text(match.definitionId),
        title: text(match.title),
        sides: (Array.isArray(match.sides) ? match.sides : []).flatMap((side: unknown) => {
          const parsed = parseSide(side)
          return parsed ? [parsed] : []
        }),
        result: result && (text(result.winnerTeamId) || text(result.winnerMint))
          ? { winnerTeamId: text(result.winnerTeamId), winnerMint: text(result.winnerMint) }
          : null,
        rewardPoolL,
      }]
    }),
  }
}

/** The catalogue read documented by docs/MARKET_LIST_API.md.
 *
 *  A head-to-head match is expressed as linked binary items sharing one eventId,
 *  so several rows can carry the same matchId; their reported figures sum. The
 *  catalogue does not report volume today, which is why every numeric spelling
 *  it might grow is read here and a missing one stays `null` rather than 0. */
export function parseMiawPrixMarkets(value: unknown): MiawPrixMarkets {
  const data = object(value)
  const items = Array.isArray(data.items) ? data.items : []
  const byMatch: MiawPrixMarkets = new Map()
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const item = raw as Record<string, any>
    const matchId = text(item.matchId).toLowerCase()
    if (!matchId) continue
    const reported = volumeUsd(item)
    const seen = byMatch.get(matchId)
    if (!seen) byMatch.set(matchId, { listed: true, volumeUsd: reported })
    else if (reported !== null) seen.volumeUsd = (seen.volumeUsd ?? 0) + reported
  }
  return byMatch
}

function volumeUsd(item: Record<string, any>): number | null {
  const micros = item.volumeUsdMicros
  if (typeof micros === 'number' && Number.isFinite(micros) && micros >= 0) return micros / 1_000_000
  for (const key of ['volumeUsd', 'volume']) {
    const raw = item[key]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw
  }
  return null
}

export type MiawPrixSource = ReturnType<typeof miawPrixSource>

/**
 * @param arenaEndpoint same-origin arena proxy, e.g. `/api/agent-arena`.
 * @param predictionEndpoint same-origin prediction proxy, e.g. `/api/prediction`.
 */
export function miawPrixSource(arenaEndpoint: string, predictionEndpoint: string, fetcher: typeof fetch = fetch) {
  async function read(url: string, unavailable: string, signal?: AbortSignal) {
    const response = await fetcher(url, { signal, headers: { accept: 'application/json' } })
    if (!response.ok) {
      const error = new Error(`${unavailable} (${response.status}).`) as Error & { status: number }
      error.status = response.status
      throw error
    }
    return response.json()
  }
  return {
    async board(seasonId = '', signal?: AbortSignal): Promise<MiawPrixBoard> {
      const query = new URLSearchParams({ kind: 'miawPrix', ...(seasonId ? { seasonId } : {}) })
      return parseMiawPrixBoard(await read(`${arenaEndpoint}?${query}`, 'The MIAW PRIX programme is unavailable', signal))
    },
    /**
     * Volume is a join, not the page. A catalogue that is down must leave the
     * volume column unknown and the programme readable, so the caller treats a
     * rejection here as "no figures", never as a failed page.
     *
     * `status=all` because a settled match still has traded volume worth
     * reading; the default `eligible` filter would hide every finished row.
     */
    async markets(signal?: AbortSignal, pages = 5): Promise<MiawPrixMarkets> {
      const all: MiawPrixMarkets = new Map()
      let cursor = ''
      for (let page = 0; page < pages; page += 1) {
        const query = new URLSearchParams({ status: 'all', limit: '100', ...(cursor ? { cursor } : {}) })
        const payload = await read(`${predictionEndpoint}/market/list?${query}`, 'The prediction catalogue is unavailable', signal)
        for (const [matchId, summary] of parseMiawPrixMarkets(payload)) {
          const seen = all.get(matchId)
          if (!seen) all.set(matchId, summary)
          else if (summary.volumeUsd !== null) seen.volumeUsd = (seen.volumeUsd ?? 0) + summary.volumeUsd
        }
        cursor = text(object(payload).nextCursor)
        if (!cursor) break
      }
      return all
    },
  }
}
