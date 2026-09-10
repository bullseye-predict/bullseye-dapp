import type { ArenaFeed } from './arenaFeed'
import type { ArenaMarket, GenesisAgent, MatchRosterEntry, SolzMatch, SolzSnapshot } from '../solz/model'

type ArenaQuestion = { questionId: string; agentId: string; actorId: string; answer: 'YES' | 'NO' | 'VOID' | null }
type ArenaEvent = { eventId: string; roomId: string; status: 'reserved' | 'live' | 'settled' | 'cancelled'; questions: ArenaQuestion[] }

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

function realAgents(feed: ArenaFeed, base: GenesisAgent[]) {
  return feed.agents.map((agent, index) => {
    const existing = base.find(value => value.id === agent.agentId)
    return existing ?? {
      id: agent.agentId, number: agent.slot + 1, codename: agent.codename, archetype: agent.archetype,
      color: agentColor(index), status: 'active' as const, matches: agent.matchesPlayed ?? 0, wins: agent.wins ?? 0,
      losses: Math.max(0, (agent.matchesPlayed ?? 0) - (agent.wins ?? 0)), kills: agent.kills ?? 0,
      deaths: agent.deaths ?? 0, objectives: 0, winRate: agent.matchesPlayed ? (agent.wins ?? 0) / agent.matchesPlayed : 0,
      rating: 0, preferredMode: 'ARENA', teamHistory: [], bio: 'Genesis arena agent.',
    }
  })
}

function realMatch(raw: ArenaFeed['matches'][number], agents: GenesisAgent[], now: number): SolzMatch {
  const startedAt = timestamp(raw.startedAt ?? raw.createdAt, now)
  const roster: MatchRosterEntry[] = raw.participants.map((participant, index) => {
    const agent = agents.find(value => value.id === participant.agentId)
    return {
      agentId: participant.agentId, teamId: participant.teamId ?? 'genesis-arena', codename: agent?.codename ?? participant.agentId,
      color: agent?.color ?? agentColor(index), kills: participant.kills ?? 0, deaths: participant.deaths ?? 0,
      assists: 0, objectives: 0, hp: 100, hpMax: 100, status: raw.status === 'settled' ? 'eliminated' : 'active',
      x: 0, y: 0, momentum: 0,
    }
  })
  return {
    id: `arena-${raw.roomId}`, kind: 'highlight', mode: raw.gameMode.toUpperCase(), map: 'GENESIS AGENT ARENA',
    round: raw.status === 'live' ? 'MATCH LIVE' : raw.status.toUpperCase(), phase: phase(raw.status), startedAt,
    endsAt: timestamp(raw.completedAt, startedAt + 60 * 60_000), viewers: 0, marketId: `arena-${raw.roomId}`,
    volume: { SOL: 0, COOLA: 0 }, teams: [{ teamId: 'genesis-arena', symbol: 'GENESIS', name: 'GENESIS AGENTS', color: '#c7ff00', glyph: 'GA', score: 0, agentIds: roster.map(value => value.agentId) }], roster,
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
      id: `${event.eventId}-${question.questionId}`, matchId: event.eventId, kind: 'match-winner',
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
  const currentId = feed.current ? `arena-${feed.current.roomId}` : matches[0]?.id
  return {
    ...base, updatedAt: now, highlightMatchId: currentId ?? base.highlightMatchId, matches, markets, agents,
    capabilities: { ...base.capabilities, orders: { ready: false, reason: 'Prediction questions are imported from Neon; trading is not enabled.' } },
  }
}
