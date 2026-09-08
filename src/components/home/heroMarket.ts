import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'

export type HighlightView = 'live' | 'market' | 'options'
export const INTERMISSION_DELAY = 150_000
export const teamLabel = (symbol: string) => `${symbol.replace(/^\$/, '')} TEAM`
export const matchLabel = (teams: Array<{ symbol: string }>) => teams.length > 2 ? `${teams.length}-TEAM FREE FOR ALL` : teams.map((team) => teamLabel(team.symbol)).join(' — ')
export function outcomeColor(outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index = 0) {
  return snapshot.agents.find((agent) => agent.id === outcome.participantId)?.color ?? snapshot.teams.find((team) => team.id === outcome.teamId)?.color ?? ['#c7ff00', '#ff579d', '#65cfff', '#ffac57', '#bd9afa', '#f9e071'][index % 6]
}
export function availableShares(snapshot: SolzSnapshot, market: ArenaMarket, outcome: ArenaMarketOutcome) {
  const held = snapshot.account.positions.filter((position) => position.marketId === market.id && position.outcomeId === outcome.id && position.token === 'COOLA').reduce((sum, position) => sum + position.shares, 0)
  const reserved = snapshot.limitOrders.filter((order) => order.status === 'open' && order.side === 'sell' && order.marketId === market.id && order.outcomeId === outcome.id && order.token === 'COOLA').reduce((sum, order) => sum + order.shares, 0)
  return Math.max(0, held - reserved)
}
export function shouldShowSeason(phase: string, endedAt: number, now: number, pinned: boolean) {
  return pinned || (phase === 'settled' && now - endedAt >= INTERMISSION_DELAY)
}
