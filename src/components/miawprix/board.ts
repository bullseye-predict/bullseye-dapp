import type {
  MiawPrixMarketsState, MiawPrixMatch, MiawPrixSeason, MiawPrixStanding,
} from './miawPrixSource'

/**
 * The MIAW PRIX reading rules, as plain TypeScript.
 *
 * Everything a reader could argue about — who is champion, whether a match has
 * a market, whether a pairing exists yet — is decided here rather than inside
 * JSX, so it can be tested and so there is exactly one answer per question.
 */

/** Nothing on this page prints a zero it cannot stand behind. */
export const EM_DASH = '—'

/** CATWALK binds a pairing this far before kickoff. Before that moment the
 *  opponents genuinely do not exist yet, and the row must say so. */
export const PAIRING_LOCK_MS = 12 * 60 * 60 * 1000

/** The programme is numbered, and local/testing opens at zero, so the label is
 *  padded: SEASON 00 sorts and reads next to SEASON 11.
 *
 *  A `season_id` is a database key — `<game_key>-<index>` — and is never shown
 *  to a reader (RANKED_TERMINOLOGY 4.110), so a season the control plane sent
 *  without a number says it has none rather than leaking the key as its name. */
export function seasonLabel(season: MiawPrixSeason | null): string {
  if (!season) return 'NO SEASON'
  if (season.seasonIndex < 0) return 'SEASON UNNUMBERED'
  return `SEASON ${String(season.seasonIndex).padStart(2, '0')}`
}

/**
 * Whether the programme answered with the season that was asked for.
 *
 * The selector and the `?season=` deep link can both name a season the server
 * declines to serve, and what comes back then is whatever it has instead —
 * usually the live one. Rendering those standings, results and reward pools
 * under the requested season's name would misreport every number on the page,
 * so the substitution is stated.
 *
 * Both seasons are named by NUMBER. The requested id is the only handle the
 * client holds, but it is a key, not a name, so a season missing from the
 * programme's own list is described instead of spelled out.
 *
 * Returns null when nothing was requested or the right season arrived.
 */
export function seasonMismatch(
  requestedId: string,
  served: MiawPrixSeason | null,
  seasons: readonly MiawPrixSeason[],
): string | null {
  if (!requestedId || served?.seasonId === requestedId) return null
  const asked = seasons.find((season) => season.seasonId === requestedId) ?? null
  const name = asked ? seasonLabel(asked) : 'The season you asked for'
  if (!served) return `${name} could not be loaded, and the programme returned no season in its place.`
  return `${name} could not be loaded. Every figure below belongs to ${seasonLabel(served)}.`
}

/** Newest first: the season selector opens on the one being played. */
export function orderSeasons(seasons: readonly MiawPrixSeason[]): MiawPrixSeason[] {
  return [...seasons].sort((a, b) => b.seasonIndex - a.seasonIndex || b.startsAt - a.startsAt)
}

export type RankedStanding = MiawPrixStanding & {
  rank: number
  /** True when this row has the same win count as the row above it. The season
   *  is won on raw wins, so a tie there is the one case where the order on
   *  screen is decided by something other than the visible numbers, and the
   *  table has to admit it instead of implying the rank is earned. */
  tiedOnWins: boolean
}

/**
 * A season is won on RAW WIN COUNT. Losses order a tie and nothing else: a coin
 * that played thirty matches to reach nine wins finishes above a coin with
 * eight from eight. That is the rule people will argue about, so the table
 * shows wins first and never derives a win rate that would quietly restate it.
 *
 * Rows that tie on both wins and losses keep the order the server sent, which
 * carries `reached_wins_at` — first to the win count leads.
 */
export function rankStandings(rows: readonly MiawPrixStanding[]): RankedStanding[] {
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => b.row.wins - a.row.wins || a.row.losses - b.row.losses || a.index - b.index)
  return ordered.map(({ row }, position) => ({
    ...row,
    rank: position + 1,
    tiedOnWins: position > 0 && ordered[position - 1]!.row.wins === row.wins,
  }))
}

/**
 * How the title was settled when more than one coin finished on the top win
 * count. `level` is how many OTHER coins reached it.
 *
 *   losses -> the champion played fewer losses than everyone else up there
 *   order  -> even losses were level, so it came down to who got there first
 */
export type ChampionTieBreak = { level: number; on: 'losses' | 'order'; wins: number; losses: number }

export type Champion = RankedStanding & {
  /** Null when the champion led the season outright on wins. */
  tieBreak: ChampionTieBreak | null
}

/** The coin that finished a closed season on top. Null while a season is still
 *  being played — a leader is not a champion.
 *
 *  The season is won on RAW WINS, so two coins can finish level and the title is
 *  then decided by something the champion cell does not show: losses, or the
 *  order the server sent. The standings table already admits this with a tie
 *  chip on the row below; stating the winner flatly up here contradicted it.
 *  The decision travels with the champion so the panel can say it out loud. */
export function champion(season: MiawPrixSeason | null, rows: readonly RankedStanding[]): Champion | null {
  if (!season || season.status !== 'closed') return null
  const top = rows[0]
  if (!top) return null
  const level = rows.filter((row) => row.wins === top.wins)
  if (level.length < 2) return { ...top, tieBreak: null }
  // Fewer losses separated them only if nobody else is level on losses too.
  const onLosses = level.filter((row) => row.losses === top.losses).length === 1
  return {
    ...top,
    tieBreak: { level: level.length - 1, on: onLosses ? 'losses' : 'order', wins: top.wins, losses: top.losses },
  }
}

/** What the champion cell says underneath the record when the title was not won
 *  outright. Empty when it was — an uncontested season states nothing extra. */
export function championNote(winner: Champion | null): string {
  if (!winner?.tieBreak) return ''
  const { level, on, wins, losses } = winner.tieBreak
  const others = `${level} other ${level === 1 ? 'coin' : 'coins'}`
  if (on === 'losses') {
    return `Tied on ${wins} ${wins === 1 ? 'win' : 'wins'} with ${others}; the title was broken on fewer losses (${losses}).`
  }
  return `Tied on ${wins} ${wins === 1 ? 'win' : 'wins'} and ${losses} ${losses === 1 ? 'loss' : 'losses'} with ${others}; `
    + `the title was broken on who reached ${wins} first.`
}

export type MatchState = 'final' | 'live' | 'cancelled' | 'upcoming'

/** The programme and the game server spell the same lifecycle differently
 *  (`settled`/`final`, `reserved`/`scheduled`/`planned`), so the page reads it
 *  once, here. A published result outranks any status string: a match with a
 *  winner is finished whatever the row still calls itself. */
export function matchState(match: MiawPrixMatch): MatchState {
  if (match.result) return 'final'
  const status = match.status.toLowerCase()
  if (status === 'cancelled' || status === 'canceled' || status === 'void') return 'cancelled'
  if (status === 'live' || status === 'running') return 'live'
  if (status === 'settled' || status === 'final' || status === 'resolved') return 'final'
  return 'upcoming'
}

/** Kickoff first for what is coming, most recent first for what is done. */
export function splitMatches(matches: readonly MiawPrixMatch[]) {
  const upcoming: MiawPrixMatch[] = []
  const finished: MiawPrixMatch[] = []
  for (const match of matches) (matchState(match) === 'final' || matchState(match) === 'cancelled' ? finished : upcoming).push(match)
  upcoming.sort((a, b) => a.scheduledStartAt - b.scheduledStartAt)
  finished.sort((a, b) => b.scheduledStartAt - a.scheduledStartAt)
  return { upcoming, finished }
}

/** A coarse countdown. Minutes below an hour, never seconds: this page is read,
 *  not walked, and a ticking second hand would imply a precision the schedule
 *  does not have. */
export function countdown(remainingMs: number): string {
  const total = Math.max(0, Math.floor(remainingMs / 60_000))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  if (days) return `${days}d ${String(hours).padStart(2, '0')}h`
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m`
}

/** What the season header says to the right of the window. */
export function seasonClock(season: MiawPrixSeason | null, now: number): string {
  if (!season) return EM_DASH
  if (season.status === 'closed') return 'Final'
  if (season.status === 'upcoming') return season.startsAt > now ? `Opens in ${countdown(season.startsAt - now)}` : 'Opening'
  return season.endsAt > now ? `Closes in ${countdown(season.endsAt - now)}` : 'Closing'
}

/**
 * What an unpaired upcoming match is allowed to say.
 *
 * Returning a notice means the row must NOT render teams: before the pairing binds,
 * the opponents are genuinely undecided, and filling the cell with placeholders
 * would publish a fixture that does not exist.
 */
export function pairingNotice(match: MiawPrixMatch, now: number): string | null {
  if (match.sides.length) return null
  if (matchState(match) !== 'upcoming') return 'No pairing recorded'
  if (!match.scheduledStartAt) return 'Not scheduled'
  const locksAt = match.scheduledStartAt - PAIRING_LOCK_MS
  return locksAt > now ? `Pairing locks in ${countdown(locksAt - now)}` : 'Pairing pending'
}

const PROGRAMMES: Record<string, string> = {
  colosseum_team_deathmatch_3v3: 'Team Deathmatch 3v3',
  colosseum_grab_bottle_3v3: 'Grab Bottle 3v3',
}

/** The definition id is the identity; the title is whatever the catalogue
 *  happened to store. Prefer the known programme name so the two modes read the
 *  same on every row. */
export function programmeLabel(match: MiawPrixMatch): string {
  const known = PROGRAMMES[match.definitionId]
  if (known) return known
  if (match.title) return match.title
  if (!match.definitionId) return EM_DASH
  return match.definitionId.replace(/^colosseum_/, '').replaceAll('_', ' ')
}

export function rewardLabel(match: MiawPrixMatch): string {
  return match.rewardPoolL === null ? EM_DASH : `${match.rewardPoolL.toLocaleString('en')} Soda`
}

/** Which of the five things the VOLUME column can be saying. The renderer needs
 *  this rather than the string, because `pending` is drawn, not written. */
export type VolumeReading = 'pending' | 'unreadable' | 'unopened' | 'unreported' | 'zero' | 'figure'

export type VolumeCell = { reading: VolumeReading; text: string; note: string }

/** The sentence that is true of exactly ONE of the readings below. Exported so
 *  a test can prove it is absent from the other four. */
export const NO_MARKET_NOTE = 'No prediction market opened for this match'

/**
 * The one place that decides what the VOLUME column says.
 *
 * FIVE different facts share this column and collapsing any two of them is a
 * lie — about liquidity, or about whether anyone asked:
 *
 *   catalogue unread    -> nobody has answered yet; the cell claims NOTHING
 *   catalogue failed    -> we could not read the catalogue; not about this match
 *   read, no entry      -> there is no market to trade at all
 *   read, no figure     -> a market exists, its traded volume is not reported here
 *   read, figure        -> that is the number, including a genuine zero
 *
 * The first two used to be indistinguishable from the third, because an empty
 * `Map` served as the initial state, the error state and a real answer. Every
 * row therefore published `NO_MARKET_NOTE` during the load window of every page
 * view, and silently forever when the catalogue was down.
 *
 * Only the last may ever print a dollar amount.
 */
export function volumeCell(matchId: string, markets: MiawPrixMarketsState): VolumeCell {
  // Nothing has been read, so nothing may be claimed — not even an em dash,
  // which this page spends on "we asked and there is none".
  if (markets.status === 'unread') return { reading: 'pending', text: '', note: 'Reading the prediction catalogue' }
  if (markets.status === 'failed') {
    return {
      reading: 'unreadable',
      text: EM_DASH,
      note: 'The market catalogue could not be read. This is not a statement about this match.',
    }
  }
  const summary = markets.byMatch.get(matchId.toLowerCase())
  if (!summary) return { reading: 'unopened', text: EM_DASH, note: NO_MARKET_NOTE }
  if (summary.volumeUsd === null) return { reading: 'unreported', text: EM_DASH, note: 'Market listed; traded volume is not reported by the prediction catalogue' }
  if (summary.volumeUsd === 0) return { reading: 'zero', text: '$0', note: 'Market open; no trades yet' }
  return {
    reading: 'figure',
    text: `$${summary.volumeUsd.toLocaleString('en', { maximumFractionDigits: summary.volumeUsd < 1000 ? 2 : 0 })}`,
    note: 'Traded volume reported by the prediction catalogue',
  }
}

/** The page-level disclosure for a catalogue outage. Every Volume cell is an em
 *  dash in that state, and an em dash on this page otherwise means "we looked
 *  and there is no market", so the outage is stated once, visibly, in words. */
export function marketsNotice(markets: MiawPrixMarketsState): string {
  if (markets.status !== 'failed') return ''
  return 'The prediction catalogue could not be read, so Volume is unknown for every match below. '
    + 'That is an outage on our side, not a statement about which matches have a market.'
}

/** One clock format for the whole page, so a schedule row and a result row are
 *  read against each other rather than against two different renderings. */
export function kickoffLabel(at: number): string {
  if (!at) return EM_DASH
  return new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function windowLabel(season: MiawPrixSeason | null): string {
  if (!season || !season.startsAt || !season.endsAt) return EM_DASH
  const day = (at: number) => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  return `${day(season.startsAt)} – ${day(season.endsAt)}`
}

/** The winning side of a finished match, matched on the coin's own identity. A
 *  result that names a mint nobody played is reported as no highlight rather
 *  than as the first side. */
export function isWinner(match: MiawPrixMatch, side: { teamId: string; mint: string }): boolean {
  if (!match.result) return false
  const { winnerTeamId, winnerMint } = match.result
  if (winnerMint && side.mint) return winnerMint.toLowerCase() === side.mint.toLowerCase()
  return Boolean(winnerTeamId) && winnerTeamId === side.teamId
}

/**
 * The count beside a section heading.
 *
 * A count is a claim, and after a failed programme read there is no board to
 * count — `EMPTY_BOARD` stands in so the tables keep their shape, and taking a
 * length from it printed "0 settled" directly beneath the banner saying the
 * programme could not be reached. Zero and unknown are different answers, and
 * the one place they are decided is here rather than inline per heading.
 */
export function sectionCount(
  state: { loading: boolean; counted: boolean },
  count: number,
  label: { one: string; many: string; unavailable: string },
) {
  if (state.loading) return 'Reading the season'
  if (!state.counted) return label.unavailable
  return `${count} ${count === 1 ? label.one : label.many}`
}

/**
 * What the MARKET CAP column says, as one of TWO facts.
 *
 * The programme payload may or may not carry a capitalisation for a coin — the
 * field is new, it is joined from a price source the game server does not own,
 * and a coin nobody could price still walks. Absent is therefore UNKNOWN and
 * takes the page's em dash, exactly as an unopened prediction market does. It
 * is never rendered as `$0`: a coin worth nothing and a coin nobody read are
 * opposite claims, and only one of them libels the coin.
 *
 * A reported zero IS printed, because that is a figure somebody published.
 */
export type MarketCapCell = { known: boolean; text: string; note: string }

/** Exported so a test can prove it appears on an unpriced row and nowhere else. */
export const MARKET_CAP_UNKNOWN_NOTE = 'Market capitalisation is not reported for this coin'

/** Compact dollars: a nine-figure capitalisation must not out-shout the win
 *  count, which is the number this season is actually decided on. */
export function usdCompact(value: number): string {
  if (value < 1_000) return `$${value.toLocaleString('en', { maximumFractionDigits: 2 })}`
  return `$${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`
}

export function marketCapCell(value: number | null | undefined): MarketCapCell {
  if (value === null || value === undefined) return { known: false, text: EM_DASH, note: MARKET_CAP_UNKNOWN_NOTE }
  return { known: true, text: usdCompact(value), note: 'Market capitalisation reported with the programme standings' }
}
