import type { ArenaMarket, SolzMatch } from '../solz/model'
import { matchState, programmeLabel } from './board'
import type { MiawPrixMatch } from './miawPrixSource'

const SIDE_COLORS = ['#3fdcff', '#ff7a1a'] as const

/**
 * Adapts a recorded CATWALK programme card to the same event-domain model used
 * by every prediction page. This is intentionally only a display fallback:
 * when the canonical Solana question exists, its market ID and venue binding
 * replace this row and the normal live trading path remains authoritative.
 */
export function miawPrixEventView(match: MiawPrixMatch, now = Date.now()): {
  match: SolzMatch
  market: ArenaMarket
} | null {
  if (match.sides.length !== 2) return null
  const state = matchState(match, now)
  const durationMs = Math.max(1, match.matchDurationMs ?? 5 * 60_000)
  const kickoff = match.scheduledStartAt || now
  const teams = match.sides.map((side, index) => ({
    teamId: side.mint || side.teamId,
    symbol: side.symbol,
    name: side.name,
    ...(side.logoUrl ? { logoUrl: side.logoUrl } : {}),
    color: side.color ?? SIDE_COLORS[index]!,
    glyph: side.symbol.replace(/^\$/, '').slice(0, 3).toUpperCase(),
    score: match.result && (match.result.winnerMint === side.mint || match.result.winnerTeamId === side.teamId) ? 1 : 0,
    agentIds: [],
  })) satisfies SolzMatch['teams']
  const marketId = `miaw:${match.matchId}`
  const winnerIndex = match.result
    ? match.sides.findIndex((side) => match.result?.winnerMint === side.mint || match.result?.winnerTeamId === side.teamId)
    : -1
  const eventTitle = teams.map((team) => team.symbol).join(' vs ')
  const closed = state === 'final' || state === 'cancelled' || now >= kickoff
  const market: ArenaMarket = {
    id: marketId,
    matchId: match.matchId,
    kind: 'match-winner',
    title: eventTitle,
    description: closed
      ? 'Recorded MIAW PRIX moneyline. Trading is closed; the match record remains available.'
      : 'MIAW PRIX moneyline awaiting its canonical prediction-market book.',
    status: closed ? 'closed' : 'indicative',
    closesAt: kickoff,
    volume: { SOL: 0, COOLA: 0 },
    outcomes: teams.map((team, index) => ({
      id: index === 0 ? 'yes' : 'no',
      label: team.symbol,
      detail: `Pays if ${team.symbol} wins this MIAW PRIX match.`,
      probability: winnerIndex < 0 ? 0.5 : winnerIndex === index ? 1 : 0,
      indicative: winnerIndex < 0,
      priceHistory: [],
      teamId: team.teamId,
      color: team.color,
    })),
    rules: 'Resolves to the winner recorded by Agent Colosseum. A draw or cancelled match is void.',
    presentation: {
      kind: 'head-to-head',
      eventTitle,
      outcomes: teams.map((team, index) => ({
        id: index as 0 | 1,
        label: team.symbol,
        teamId: team.teamId,
        color: team.color,
        ...(team.logoUrl ? { imageUrl: team.logoUrl } : {}),
      })) as [{ id: 0; label: string; teamId: string; color: string; imageUrl?: string }, { id: 1; label: string; teamId: string; color: string; imageUrl?: string }],
    },
  }
  return {
    match: {
      id: match.matchId,
      displayMatchId: match.displayMatchId,
      kind: 'highlight',
      mode: programmeLabel(match),
      map: 'AGENT COLOSSEUM',
      round: match.cycleIndex === null
        ? 'MIAW PRIX'
        : `CATWALK #${match.cycleIndex + 1}${match.cycleMatchIndex === null ? '' : ` · MATCH ${match.cycleMatchIndex + 1}/${match.cycleMatchCount ?? '—'}`}`,
      phase: state === 'final' || state === 'cancelled'
        ? 'settled'
        : state === 'live'
          ? 'live'
          : 'countdown',
      startedAt: kickoff,
      endsAt: kickoff + durationMs,
      durationMs,
      timingType: 'countdown',
      timingEstimated: false,
      viewers: 0,
      marketId,
      volume: { SOL: 0, COOLA: 0 },
      teams,
      roster: [],
    },
    market,
  }
}
