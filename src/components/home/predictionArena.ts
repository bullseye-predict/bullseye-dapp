import type { ArenaFeed } from './arenaFeed'
import type { ArenaMarket, GenesisAgent, MatchRosterEntry, SolzMatch, SolzSnapshot } from '../solz/model'

type ArenaQuestion = { questionId: string; agentId: string; actorId: string; answer: 'YES' | 'NO' | 'VOID' | null }
type ArenaEvent = { eventId: string; matchId: string; roomId: string; status: 'planned' | 'reserved' | 'live' | 'settled' | 'cancelled'; questions: ArenaQuestion[] }

function timestamp(value: unknown, fallback: number) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(parsed) ? parsed : fallback
}

function phase(value: string): SolzMatch['phase'] {
  if (value === 'live') return 'live'
  if (value === 'settled' || value === 'cancelled') return 'settled'
  return 'countdown'
}

function agentColor(index: number) {
  return ['#c7ff00', '#ff579d', '#65cfff', '#ffac57', '#bd9afa', '#f9e071'][index % 6]!
}

const teamColors = ['#c7ff00', '#65cfff'] as const

/** The database owns an agent's identity once it carries one. A seeded row still
 *  wins on the fields the API has no column for (bio, traits, team history). */
function withLiveIdentity(agent: ArenaFeed['agents'][number], base: GenesisAgent): GenesisAgent {
  return {
    ...base,
    codename: agent.codename || base.codename,
    subname: agent.subname ?? base.subname,
    skinSlug: agent.skinSlug ?? base.skinSlug,
    color: agent.accentColor ?? base.color,
  }
}

function realAgents(feed: ArenaFeed, base: GenesisAgent[]) {
  return feed.agents.map((agent, index) => {
    const existing = base.find(value => value.id === agent.agentId)
    return existing ? withLiveIdentity(agent, existing) : {
      id: agent.agentId, number: agent.slot + 1, codename: agent.codename, archetype: agent.archetype,
      subname: agent.subname ?? '', skinSlug: agent.skinSlug ?? '',
      color: agent.accentColor ?? agentColor(index), status: 'active' as const, matches: agent.matchesPlayed ?? 0, wins: agent.wins ?? 0,
      losses: Math.max(0, (agent.matchesPlayed ?? 0) - (agent.wins ?? 0)), kills: agent.kills ?? 0,
      deaths: agent.deaths ?? 0, objectives: 0, winRate: agent.matchesPlayed ? (agent.wins ?? 0) / agent.matchesPlayed : 0,
      rating: 0, preferredMode: 'ARENA', teamHistory: [], bio: 'Genesis arena agent.',
    }
  })
}

function realMatch(raw: ArenaFeed['matches'][number], agents: GenesisAgent[], now: number): SolzMatch {
  const fallbackStartAt = timestamp(raw.createdAt, now) + 5 * 60_000
  const scheduledStartAt = timestamp(raw.scheduledStartAt, fallbackStartAt)
  const startedAt = timestamp(raw.startedAt ?? raw.scheduledStartAt ?? raw.createdAt, now)
  const nextMatchAt = timestamp(raw.nextMatchAt, 0)
  const isIntermission = raw.status === 'settled' && nextMatchAt > now
  const durationMs = isIntermission
    ? raw.definition?.breakMs ?? 5 * 60_000
    : raw.matchDurationMs ?? 5 * 60_000
  const timingType = raw.timingType ?? 'countdown'
  const endsAt = isIntermission
    ? nextMatchAt
    : raw.status === 'reserved'
    ? scheduledStartAt
    : raw.status === 'live'
      ? timingType === 'countdown' ? startedAt + durationMs : Number.MAX_SAFE_INTEGER
      : timestamp(raw.completedAt, startedAt + durationMs)
  const roster: MatchRosterEntry[] = raw.participants.map((participant, index) => {
    const agent = agents.find(value => value.id === participant.agentId)
    return {
      agentId: participant.agentId, teamId: participant.teamId ?? 'genesis-arena', codename: agent?.codename ?? participant.agentId,
      color: agent?.color ?? agentColor(index), kills: participant.kills ?? 0, deaths: participant.deaths ?? 0,
      assists: 0, objectives: 0, hp: 100, hpMax: 100, status: raw.status === 'settled' ? 'eliminated' : 'active',
      x: 0, y: 0, momentum: 0,
    }
  })
  const declaredTeams = raw.definition?.teams ?? []
  const teamIds = declaredTeams.length
    ? declaredTeams.map((team) => team.id)
    : [...new Set(roster.map((entry) => entry.teamId).filter((teamId) => teamId !== 'genesis-arena'))]
  const teams = teamIds.length >= 2
    ? teamIds.map((teamId, index) => {
        const declared = declaredTeams.find((team) => team.id === teamId)
        const members = roster.filter((entry) => entry.teamId === teamId)
        const label = declared?.label ?? `Team ${index + 1}`
        return {
          teamId,
          symbol: label,
          name: label,
          color: teamColors[index % teamColors.length]!,
          glyph: `T${index + 1}`,
          score: members.reduce((total, entry) => total + entry.kills, 0),
          agentIds: members.map((entry) => entry.agentId),
        }
      })
    : [{ teamId: 'genesis-arena', symbol: 'GENESIS', name: 'GENESIS AGENTS', color: '#c7ff00', glyph: 'GA', score: 0, agentIds: roster.map(value => value.agentId) }]
  return {
    id: raw.matchId ? `arena-${raw.matchId.slice(2)}` : `arena-${raw.roomId}`, roomId: raw.roomId, sourceMatchId: raw.matchId ?? raw.roomId, displayMatchId: raw.displayMatchId, matchNumber: raw.matchNumber, kind: 'highlight', mode: raw.definition?.title ?? raw.gameMode.toUpperCase(), map: 'GENESIS AGENT ARENA',
    round: isIntermission ? 'INTERMISSION' : raw.status === 'live' ? 'MATCH LIVE' : raw.status.toUpperCase(), phase: isIntermission ? 'countdown' : phase(raw.status), startedAt: isIntermission ? nextMatchAt - durationMs : startedAt,
    endsAt, durationMs, timingType, timingEstimated: raw.status === 'reserved' ? !raw.scheduledStartAt : raw.status === 'live' ? !raw.startedAt : !raw.completedAt,
    viewers: 0, marketId: `arena-${raw.roomId}`,
    volume: { SOL: 0, COOLA: 0 }, teams, roster,
  }
}

function marketStatus(event: ArenaEvent): ArenaMarket['status'] {
  return event.status === 'settled' || event.status === 'cancelled' ? 'closed' : 'indicative'
}

function marketsFor(event: ArenaEvent, agents: GenesisAgent[], now: number): ArenaMarket[] {
  return event.questions.map(question => {
    const agent = agents.find(value => value.id === question.agentId)
    const settled = question.answer !== null
    const yes = question.answer === 'YES' ? 1 : question.answer === 'NO' || question.answer === 'VOID' ? 0 : .5
    return {
      id: question.questionId, matchId: event.eventId, kind: 'match-winner',
      title: `Will ${agent?.codename ?? question.agentId} win?`, description: 'Resolves from the recorded match result in Neon.',
      status: marketStatus(event), closesAt: settled ? now : Number.MAX_SAFE_INTEGER, volume: { SOL: 0, COOLA: 0 },
      outcomes: [
        { id: 'yes', label: 'YES', detail: 'This agent wins the recorded match.', probability: yes, participantId: question.agentId, priceHistory: settled ? [{ at: now, probability: yes }] : [] },
        { id: 'no', label: 'NO', detail: 'This agent does not win the recorded match.', probability: 1 - yes, participantId: question.agentId, priceHistory: settled ? [{ at: now, probability: 1 - yes }] : [] },
      ],
      rules: question.answer === 'VOID' ? 'This question was voided because the match was cancelled.' : 'Resolves from the final recorded winner list. Trading is not enabled yet.',
    }
  })
}

export function applyPredictionArena(base: SolzSnapshot, feed: ArenaFeed, events: unknown): SolzSnapshot {
  if (!Array.isArray((events as { events?: unknown[] }).events)) throw Error('Invalid prediction event catalogue.')
  const now = feed.readAt
  const agents = realAgents(feed, base.agents)
  const matches = feed.matches.map(match => realMatch(match, agents, now))
  const drafts = (events as { events: ArenaEvent[] }).events
  const markets = drafts.flatMap(event => marketsFor(event, agents, now))
  const currentId = feed.current ? (feed.current.matchId ? `arena-${feed.current.matchId.slice(2)}` : `arena-${feed.current.roomId}`) : matches[0]?.id
  return {
    ...base, updatedAt: now, highlightMatchId: currentId ?? base.highlightMatchId, matches, markets, agents,
    capabilities: { ...base.capabilities, orders: { ready: false, reason: 'Prediction questions are imported from Neon; trading is not enabled.' } },
  }
}
