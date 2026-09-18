import type { ArenaMarket, ArenaMarketOutcome, MatchTeamSide, SolzMatch, SolzSnapshot } from '../solz/model'

export type HighlightView = 'live' | 'market' | 'options'
export const INTERMISSION_DELAY = 150_000
export const teamLabel = (symbol: string) => /^team\s+\d+$/i.test(symbol) ? symbol : `${symbol.replace(/^\$/, '')} TEAM`
/** What one side of a match is called on screen.
 *
 *  A MIAW PRIX side IS a coin, so its ticker is the whole identity and
 *  `teamLabel` would publish "PURR TEAM" for a thing that has no team. A
 *  Genesis arena side is a community flying a token, where the suffix is the
 *  point. The mint is what tells the two apart, so neither has to be guessed
 *  from the symbol's spelling. */
export const sideLabel = (team: Pick<MatchTeamSide, 'symbol' | 'mint'>) =>
  team.mint ? team.symbol.replace(/^\$/, '') : teamLabel(team.symbol)
export const matchLabel = (teams: Array<{ symbol: string }>) => teams.length > 2 ? `${teams.length}-TEAM FREE FOR ALL` : teams.map((team) => teamLabel(team.symbol)).join(' — ')
export function matchIdLabel(match: Pick<SolzMatch, 'displayMatchId'|'matchNumber'>) {
  if (Number.isSafeInteger(match.matchNumber) && match.matchNumber! > 0) return `MATCH #${match.matchNumber}`
  const display = match.displayMatchId?.trim()
  if (display) {
    // The game service names a room by its whole recipe —
    // `GM-TDM_DR-5_TS-1789728152_ID-EEE76D5F` — of which only the trailing ID
    // is an identity a reader can carry. Printing the recipe fills a card with
    // a blob; printing its tail names the match and still matches the copy
    // chip, which carries the full canonical id.
    const tail = /_ID-([0-9A-Z]{4,})$/i.exec(display)
    if (tail) return `MATCH #${tail[1]!.toUpperCase()}`
    return display.replace(/^MATCH\s+(\d+)$/i, 'MATCH #$1')
  }
  return 'MATCH —'
}
export function outcomeColor(outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index = 0) {
  // The outcome's own colour wins: a standalone Solana question carries it on
  // the presentation and has no row in snapshot.teams to be found by.
  return outcome.color ?? snapshot.agents.find((agent) => agent.id === outcome.participantId)?.color ?? snapshot.teams.find((team) => team.id === outcome.teamId)?.color ?? ['#c7ff00', '#ff579d', '#65cfff', '#ffac57', '#bd9afa', '#f9e071'][index % 6]
}
export function availableShares(snapshot: SolzSnapshot, market: ArenaMarket, outcome: ArenaMarketOutcome) {
  const held = snapshot.account.positions.filter((position) => position.marketId === market.id && position.outcomeId === outcome.id && position.token === 'COOLA').reduce((sum, position) => sum + position.shares, 0)
  const reserved = snapshot.limitOrders.filter((order) => order.status === 'open' && order.side === 'sell' && order.marketId === market.id && order.outcomeId === outcome.id && order.token === 'COOLA').reduce((sum, order) => sum + order.shares, 0)
  return Math.max(0, held - reserved)
}
export function shouldShowSeason(phase: string, endedAt: number, now: number, pinned: boolean) {
  return pinned || (phase === 'settled' && now - endedAt >= INTERMISSION_DELAY)
}
