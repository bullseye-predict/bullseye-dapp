import type { GameQuestion } from './game-creation'

/**
 * Builds a question only for the authoritative, current twelve-agent arena
 * roster. The source URL is room-specific so an oracle cannot resolve one
 * match from another match's event log.
 */
export function questionFromArena(raw: unknown, agents: unknown, eventId: string, agentId: string, gameOrigin: string, now = Date.now()): GameQuestion {
  const arena = raw as { ok?: unknown; policy?: { participants?: unknown; matchDurationMs?: unknown }; match?: { roomId?: unknown; matchId?: unknown; status?: unknown; scheduledStartAt?: unknown; participants?: unknown } }
  const match = arena.match, policy = arena.policy
  const matchId = typeof match?.matchId === 'string' ? match.matchId : undefined
  const roomId = typeof match?.roomId === 'string' ? match.roomId : undefined
  const actualEventId = matchId ? `arena-${matchId.slice(2)}` : `arena-${roomId}`
  if (arena.ok !== true || eventId !== actualEventId || !match || !['reserved', 'live'].includes(String(match.status)) || policy?.participants !== 12 || policy.matchDurationMs !== 1_200_000) throw Error('Select the current twelve-agent arena match.')
  if (!Array.isArray(match.participants)) throw Error('The selected agent is not in this match roster.')
  const participants = match.participants as { agentId?: unknown; actorId?: unknown }[]
  const participant = participants.find(candidate => candidate.agentId === agentId)
  const roster = agents as { ok?: unknown; agents?: unknown }
  const agent = Array.isArray(roster.agents) ? roster.agents.find((candidate: { agentId?: unknown }) => candidate.agentId === agentId) as { codename?: unknown } | undefined : undefined
  if (roster.ok !== true || !participant || typeof participant.actorId !== 'string' || !agent || typeof agent.codename !== 'string' || participants.length !== 12 || new Set(participants.map(candidate => candidate.agentId)).size !== 12 || !roomId) throw Error('The selected agent is not in this match roster.')
  const start = Date.parse(String(match.scheduledStartAt ?? ''))
  if (!Number.isFinite(start)) throw Error('The game has no authoritative start time.')
  const tradingLocksAt = Math.floor((start + policy.matchDurationMs - 120_000) / 1000) * 1000
  if (tradingLocksAt <= now + 60_000) throw Error('This match is too close to its finish. Open the next match question instead.')
  return {
    eventId,
    roomId,
    agentId,
    subjectId: participant.actorId,
    label: `Will ${agent.codename} win?`,
    sourceUrl: new URL(`/api/v1/agent-arena/matches/${encodeURIComponent(roomId)}/logs`, gameOrigin).toString(),
    tradingStartsAt: Math.floor(now / 1000) * 1000,
    tradingLocksAt,
    resolutionAt: Math.floor((start + policy.matchDurationMs + 180_000) / 1000) * 1000,
  }
}
