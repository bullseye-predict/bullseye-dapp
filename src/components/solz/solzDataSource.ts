import { promptRecipients } from './promptRouting'
import { baseOutcomeId, isNoContract, resolvePredictionContract } from './predictionContracts'
import type { ArenaPosition, LimitOrder, LimitOrderIntent } from './model'
import type {
  ArenaAccount,
  ArenaMarket,
  ArenaMarketOutcome,
  ArenaOrderIntent,
  ArenaOrderQuote,
  ArenaOrderReceipt,
  AutomationIntent,
  AutomationRule,
  AutomationStatus,
  ChatMessage,
  GenesisAgent,
  HighlightQueueEntry,
  MatchKind,
  MatchPhase,
  MatchResult,
  MatchRosterEntry,
  MatchTeamSide,
  PromptIntent,
  PromptQuote,
  PromptReceipt,
  PromptStatus,
  PromptSubmission,
  QueueSlot,
  SettlementToken,
  SolzDataSource,
  SolzMatch,
  SolzSnapshot,
  SolzTeam,
  SpotBid,
  SpotBidStatus,
  TapeEntry,
  TeamActivity,
  TeamLadderStatus,
  TimelineEvent,
} from './model'

/**
 * Local COOLA data source. Every seeded value is derived from a string hash so the first paint is
 * identical on every load; only the live simulation after subscribe() uses real randomness.
 * The six entities stay separate here: AGENT records accumulate, TEAM records rank, MATCH holds
 * the roster, MARKET holds tradeable outcomes, PROMPT addresses a playing agent, and AUTOMATION
 * only ever touches a market position.
 */

const ACCOUNT_KEY = 'coola.home-account.v2'
const TICK_MS = 2_600
const HISTORY_CAP = 48
const HISTORY_POINTS = 28
const HISTORY_STEP_MS = 15_000
const MINIMUM_ORDER: Record<SettlementToken, number> = { SOL: 0.01, COOLA: 25 }
const PROMPT_COST: Record<SettlementToken, number> = { SOL: 0.005, COOLA: 75 }
const REQUIRED_MATCHES = 25
const REQUIRED_PLAYERS = 250
const REQUIRED_ARENAS = 40
const KILL_LINE = 8.5
const HIGHLIGHT_MATCH_ID = 'match-07-bonk-wif'

/**
 * A spot bid buys a HIGHLIGHT QUEUE slot, nothing else. It never touches a team's W/L record,
 * its ladder status or an agent's stats: a qualifying token can buy arena exposure while it is
 * still working through the activity gate. Floors fall as the slot gets further from live.
 */
const SPOT_BID_FLOORS: Record<QueueSlot | 'RESERVE', Record<SettlementToken, number>> = {
  NOW: { SOL: 12, COOLA: 240_000 },
  NEXT: { SOL: 6, COOLA: 120_000 },
  UPCOMING: { SOL: 2.5, COOLA: 50_000 },
  RESERVE: { SOL: 1, COOLA: 20_000 },
}
/** A new bid has to clear the standing leader by this much. */
const SPOT_BID_INCREMENT = 1.05
/** Bids land in either settlement token, so they are compared at one fixed reference rate. */
const COOLA_PER_SOL = 20_000

/* ------------------------------------------------------------------ helpers */

function hashSeed(value: string) {
  let seed = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    seed = (Math.imul(seed, 16_777_619) ^ value.charCodeAt(index)) >>> 0
  }
  return seed >>> 0
}

/** Deterministic mulberry32 stream keyed by a stable string. */
function seeded(key: string) {
  let state = hashSeed(key)
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, digits: number) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeWeights(rows: Array<{ id: string; weight: number }>): Record<string, number> {
  const safe = rows.map((row) => ({ id: row.id, weight: Math.max(0.01, row.weight) }))
  const total = safe.reduce((sum, row) => sum + row.weight, 0)
  return Object.fromEntries(safe.map((row) => [row.id, row.weight / total]))
}

function uid(prefix: string) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${random}`
}

function shortAddress(address?: string) {
  if (!address || address.length < 9) return 'YOU'
  return `${address.slice(0, 4)}…${address.slice(-4)}`
}

function pickFrom<T>(rows: T[], roll: number): T {
  return rows[Math.min(rows.length - 1, Math.floor(roll * rows.length))]
}

/* --------------------------------------------------------------- spot bids */

/** SOL-equivalent value of a bid, so SOL and COOLA bids can be ranked against each other. */
function bidValue(amount: number, token: SettlementToken) {
  return token === 'SOL' ? amount : amount / COOLA_PER_SOL
}

function bidAmountIn(value: number, token: SettlementToken) {
  return token === 'SOL' ? value : value * COOLA_PER_SOL
}

/** Minimums always round up, so the quoted figure is genuinely payable. */
function roundBidUp(amount: number, token: SettlementToken) {
  return token === 'SOL' ? Math.ceil(amount * 1_000) / 1_000 : Math.ceil(amount)
}

function normalizeBidAmount(amount: number, token: SettlementToken) {
  return token === 'SOL' ? round(amount, 3) : Math.round(amount)
}

function formatBid(amount: number, token: SettlementToken) {
  return token === 'SOL'
    ? `${round(amount, 3)} SOL`
    : `${Math.round(amount).toLocaleString('en-US')} COOLA`
}

/** One bid holds a slot at a time; the highest SOL-equivalent live bid is the leader. */
function leadingBidFor(bids: SpotBid[], slot: QueueSlot | 'RESERVE'): SpotBid | undefined {
  return bids
    .filter((bid) => bid.slot === slot && bid.status === 'leading')
    .sort((left, right) => bidValue(right.amount, right.token) - bidValue(left.amount, left.token))[0]
}

/** The slot floor, raised past the standing leader by the increment when there is one. */
function spotBidMinimum(leading: SpotBid | undefined, slot: QueueSlot | 'RESERVE', token: SettlementToken) {
  const floor = SPOT_BID_FLOORS[slot][token]
  if (!leading) return floor
  const raised = bidAmountIn(bidValue(leading.amount, leading.token) * SPOT_BID_INCREMENT, token)
  return roundBidUp(Math.max(floor, raised), token)
}

/* -------------------------------------------------------------------- seeds */

type TeamSeed = {
  id: string
  symbol: string
  name: string
  color: string
  glyph: string
  status: TeamLadderStatus
  rank: number
  wins: number
  losses: number
  rating: number
  ratingDelta: number
  streak: string
  matchesHosted: number
  communityPlayers: number
  blurb: string
  activity: { matches: number; uniquePlayers: number; hostedArenas: number; completionRate: number }
}

const TEAM_SEEDS: TeamSeed[] = [
  {
    id: 'team-bonk', symbol: '$BONK', name: 'BONK COLLECTIVE', color: '#c6f432', glyph: 'BNK',
    status: 'qualified', rank: 1, wins: 18, losses: 5, rating: 1842, ratingDelta: 24, streak: 'W3',
    matchesHosted: 58, communityPlayers: 612,
    blurb: 'The loudest room on the ladder; hosts nightly arenas and never drops a slot.',
    activity: { matches: 41, uniquePlayers: 612, hostedArenas: 58, completionRate: 0.97 },
  },
  {
    id: 'team-wif', symbol: '$WIF', name: 'DOGWIFHAT SYNDICATE', color: '#ff2e88', glyph: 'WIF',
    status: 'qualified', rank: 2, wins: 16, losses: 7, rating: 1781, ratingDelta: 12, streak: 'W1',
    matchesHosted: 51, communityPlayers: 540,
    blurb: 'Fast rotations and a deep bench of community players backing every hosted arena.',
    activity: { matches: 38, uniquePlayers: 540, hostedArenas: 51, completionRate: 0.95 },
  },
  {
    id: 'team-jup', symbol: '$JUP', name: 'JUPITER VANGUARD', color: '#3fdcff', glyph: 'JUP',
    status: 'qualified', rank: 3, wins: 14, losses: 8, rating: 1712, ratingDelta: -8, streak: 'L1',
    matchesHosted: 47, communityPlayers: 470,
    blurb: 'Methodical objective play, funded by the largest treasury on the ladder.',
    activity: { matches: 33, uniquePlayers: 470, hostedArenas: 47, completionRate: 0.94 },
  },
  {
    id: 'team-ansem', symbol: '$ANSEM', name: 'ANSEM BLOC', color: '#ff7a1a', glyph: 'ANS',
    status: 'qualified', rank: 4, wins: 12, losses: 8, rating: 1688, ratingDelta: 17, streak: 'W2',
    matchesHosted: 44, communityPlayers: 402,
    blurb: 'Aggressive openers; wins early rounds and gambles the rest.',
    activity: { matches: 30, uniquePlayers: 402, hostedArenas: 44, completionRate: 0.93 },
  },
  {
    id: 'team-pengu', symbol: '$PENGU', name: 'PUDGY COLUMN', color: '#7fb2ff', glyph: 'PNG',
    status: 'qualified', rank: 5, wins: 11, losses: 9, rating: 1640, ratingDelta: 5, streak: 'W1',
    matchesHosted: 41, communityPlayers: 366,
    blurb: 'Defensive holds and the highest round-completion rate in the mid table.',
    activity: { matches: 28, uniquePlayers: 366, hostedArenas: 41, completionRate: 0.92 },
  },
  {
    id: 'team-solz', symbol: '$COOLA', name: 'COOLA HOUSE', color: '#d9ff3d', glyph: 'COOLA',
    status: 'qualified', rank: 6, wins: 10, losses: 9, rating: 1602, ratingDelta: -3, streak: 'L2',
    matchesHosted: 40, communityPlayers: 318,
    blurb: 'The house team; runs the open arenas any token can enter to start qualifying.',
    activity: { matches: 27, uniquePlayers: 318, hostedArenas: 40, completionRate: 0.91 },
  },
  {
    id: 'team-popcat', symbol: '$POPCAT', name: 'POPCAT IRREGULARS', color: '#ffb347', glyph: 'POP',
    status: 'qualified', rank: 7, wins: 9, losses: 11, rating: 1554, ratingDelta: 9, streak: 'W1',
    matchesHosted: 40, communityPlayers: 288,
    blurb: 'Chaotic skirmishers that trade rounds instead of grinding objectives.',
    activity: { matches: 26, uniquePlayers: 288, hostedArenas: 40, completionRate: 0.9 },
  },
  {
    id: 'team-mew', symbol: '$MEW', name: 'MEW CADRE', color: '#ff6fae', glyph: 'MEW',
    status: 'qualified', rank: 8, wins: 8, losses: 12, rating: 1508, ratingDelta: -14, streak: 'L3',
    matchesHosted: 40, communityPlayers: 262,
    blurb: 'Newest qualified token; cleared the ladder gate three weeks ago.',
    activity: { matches: 25, uniquePlayers: 262, hostedArenas: 40, completionRate: 0.89 },
  },
  {
    id: 'team-giga', symbol: '$GIGA', name: 'GIGACHAD PROGRAM', color: '#9ee06a', glyph: 'GIGA',
    status: 'qualifying', rank: 0, wins: 6, losses: 5, rating: 1452, ratingDelta: 21, streak: 'W2',
    matchesHosted: 22, communityPlayers: 188,
    blurb: 'Two thirds of the way through the gate; needs hosted arenas, not wins.',
    activity: { matches: 17, uniquePlayers: 188, hostedArenas: 22, completionRate: 0.86 },
  },
  {
    id: 'team-moodeng', symbol: '$MOODENG', name: 'MOO DENG UNIT', color: '#57e0c2', glyph: 'MOO',
    status: 'qualifying', rank: 0, wins: 4, losses: 4, rating: 1418, ratingDelta: 6, streak: 'W1',
    matchesHosted: 14, communityPlayers: 129,
    blurb: 'Entered the ladder this week; player count is the binding requirement.',
    activity: { matches: 11, uniquePlayers: 129, hostedArenas: 14, completionRate: 0.81 },
  },
]

type AgentSeed = {
  codename: string
  archetype: string
  color: string
  preferredMode: string
  teamHistory: string[]
  bio: string
}

const AGENT_SEEDS: AgentSeed[] = [
  { codename: 'COKE', archetype: 'BREACHER', color: '#ff6868', preferredMode: 'DOMINION', teamHistory: ['team-bonk', 'team-solz'], bio: 'Opens every round by forcing the first contest and refuses to trade ground back.' },
  { codename: 'PEPSI', archetype: 'RECON', color: '#74a9ff', preferredMode: 'BREACH', teamHistory: ['team-bonk', 'team-jup', 'team-mew'], bio: 'Maps the arena before committing, then feeds firing lines to the rest of the side.' },
  { codename: 'SPRITE', archetype: 'VANGUARD', color: '#7ad88b', preferredMode: 'DOMINION', teamHistory: ['team-bonk', 'team-popcat'], bio: 'Runs the shortest path to the objective and absorbs whatever is waiting there.' },
  { codename: 'FANTA', archetype: 'SPECTRE', color: '#ffa449', preferredMode: 'RECLAIM', teamHistory: ['team-wif', 'team-mew'], bio: 'Works the flanks alone and only surfaces when a relay is already contested.' },
  { codename: 'DR PEPPER', archetype: 'ANCHOR', color: '#f883a4', preferredMode: 'DOMINION', teamHistory: ['team-wif', 'team-pengu', 'team-solz'], bio: 'Holds a single point for an entire round and rarely leaves it voluntarily.' },
  { codename: 'MTN DEW', archetype: 'ARBITER', color: '#b6ed38', preferredMode: 'BREACH', teamHistory: ['team-wif', 'team-jup'], bio: 'Reads round economy better than positioning and calls the rotation timing.' },
  { codename: '7UP', archetype: 'BREACHER', color: '#8be0ae', preferredMode: 'BREACH', teamHistory: ['team-jup', 'team-ansem'], bio: 'Trades health for tempo and keeps pressure on the far half of the map.' },
  { codename: 'SUNKIST', archetype: 'ANCHOR', color: '#ffba69', preferredMode: 'RECLAIM', teamHistory: ['team-pengu', 'team-giga'], bio: 'Slow, patient and almost impossible to displace from a held corridor.' },
  { codename: 'CRUSH', archetype: 'RECON', color: '#cb87ed', preferredMode: 'RECLAIM', teamHistory: ['team-ansem', 'team-popcat'], bio: 'Baits rotations with false pressure and punishes whoever answers first.' },
  { codename: 'A&W', archetype: 'ARBITER', color: '#dbb276', preferredMode: 'DOMINION', teamHistory: ['team-solz', 'team-jup'], bio: 'Balances objective clock against elimination risk on every single decision.' },
  { codename: 'SCHWEPPES', archetype: 'VANGUARD', color: '#f4df67', preferredMode: 'DUEL', teamHistory: ['team-popcat', 'team-bonk'], bio: 'Fights straight through the middle and dares the other side to answer.' },
  { codename: 'JARRITOS', archetype: 'SPECTRE', color: '#64dcca', preferredMode: 'DUEL', teamHistory: ['team-mew', 'team-moodeng', 'team-wif'], bio: 'Disappears for half a round and reappears behind the contested relay.' },
]

type MatchSeed = {
  id: string
  kind: MatchKind
  mode: string
  map: string
  round: string
  phase: MatchPhase
  home: string
  away: string
  homeAgents: string[]
  awayAgents: string[]
  score: [number, number]
  viewers: number
  startedIn: number
  endsIn: number
  volume: Record<SettlementToken, number>
  marketId: string
}

const MATCH_SEEDS: MatchSeed[] = [
  {
    id: HIGHLIGHT_MATCH_ID, kind: 'highlight', mode: 'DOMINION', map: 'DIRE MARSH', round: 'ROUND 2 / 3',
    phase: 'live', home: 'team-bonk', away: 'team-wif',
    homeAgents: ['genesis-01', 'genesis-02', 'genesis-03'],
    awayAgents: ['genesis-04', 'genesis-05', 'genesis-06'],
    score: [2, 1], viewers: 12_400, startedIn: -11 * 60_000, endsIn: 9 * 60_000,
    volume: { SOL: 214.6, COOLA: 486_200 }, marketId: 'market-07-winner',
  },
  {
    id: 'match-08-jup-pengu', kind: 'community', mode: 'BREACH', map: 'COLD HARBOR', round: 'ROUND 1 / 3',
    phase: 'live', home: 'team-jup', away: 'team-pengu',
    homeAgents: ['genesis-07'], awayAgents: ['genesis-08'],
    score: [1, 1], viewers: 3_180, startedIn: -6 * 60_000, endsIn: 14 * 60_000,
    volume: { SOL: 48.2, COOLA: 132_400 }, marketId: 'market-08-winner',
  },
  {
    id: 'match-09-ansem-solz', kind: 'community', mode: 'RECLAIM', map: 'ASH TERRACE', round: 'ROUND 3 / 3',
    phase: 'live', home: 'team-ansem', away: 'team-solz',
    homeAgents: ['genesis-09'], awayAgents: ['genesis-10'],
    score: [1, 2], viewers: 2_140, startedIn: -18 * 60_000, endsIn: 4 * 60_000,
    volume: { SOL: 33.7, COOLA: 96_800 }, marketId: 'market-09-winner',
  },
  {
    id: 'match-10-popcat-mew', kind: 'community', mode: 'DUEL', map: 'NULL SPIRE', round: 'ROUND 1 / 3',
    phase: 'countdown', home: 'team-popcat', away: 'team-mew',
    homeAgents: ['genesis-11'], awayAgents: ['genesis-12'],
    score: [0, 0], viewers: 860, startedIn: 7 * 60_000, endsIn: 27 * 60_000,
    volume: { SOL: 12.4, COOLA: 41_900 }, marketId: 'market-10-winner',
  },
]

const PROMPT_TEXTS = [
  'Hold the west relay until the objective timer passes forty seconds.',
  'Stop trading duels in the open. Rotate through the marsh channel instead.',
  'Push the north bridge together, do not split the side this round.',
  'Bait the anchor out of the tower before you commit to the point.',
  'Save the burst charge for the final capture, not the opener.',
  'Cut the supply lane and starve the far half of the map.',
  'Cover the extraction ramp; the flank keeps arriving from the same angle.',
  'Play slower. You are trading health for ground you cannot hold.',
  'Take the high walkway and hold the firing line over the relay.',
  'Break contact and reset. Nothing on that point is worth the round.',
  'Ping every rotation. The side is guessing where you are.',
  'Force the duel now while their anchor is still repositioning.',
  'Deny the south capture and let the clock run for us.',
  'Trade the outer relay for the centre. Centre wins this map.',
]

const CHAT_TEXTS = [
  'bonk holding centre like it owes them money',
  'that rotation was two seconds too slow',
  'wif anchor has not moved off the tower all round',
  'someone prompt pepsi to actually scout',
  'round 2 is the whole match, watch the relay clock',
  'the marsh channel is free real estate right now',
  'coke is at half health and still pushing',
  'this is the third time they lose the north bridge',
  'mtn dew calling the rotation early again',
  'market is way too confident on bonk here',
  'dr pepper has that relay locked down',
  'if wif wins the relay the price flips instantly',
  'sprite walking into the same firing line every time',
  'prompt queue is stacked, agents will ignore half of it',
]

const TAPE_TRADERS = ['7Kq…f2A', 'sol…9xz', '4Vn…b71', 'zen…4kk', 'D3r…m08', 'bnk…22f', 'pw9…c4d', 'mir…7ta']
const AUTOMATION_TRADERS = ['AUTO · LADDER-CATCH', 'AUTO · MOMENTUM-01']

/* ----------------------------------------------------------------- builders */

function buildActivity(raw: TeamSeed['activity']): TeamActivity {
  const ratios = [
    clamp(raw.matches / REQUIRED_MATCHES, 0, 1),
    clamp(raw.uniquePlayers / REQUIRED_PLAYERS, 0, 1),
    clamp(raw.hostedArenas / REQUIRED_ARENAS, 0, 1),
  ]
  const mean = ratios.reduce((sum, value) => sum + value, 0) / ratios.length
  return {
    matches: raw.matches,
    matchesRequired: REQUIRED_MATCHES,
    uniquePlayers: raw.uniquePlayers,
    uniquePlayersRequired: REQUIRED_PLAYERS,
    hostedArenas: raw.hostedArenas,
    hostedArenasRequired: REQUIRED_ARENAS,
    completionRate: raw.completionRate,
    progress: round(mean * raw.completionRate, 4),
  }
}

function buildTeams(now: number): SolzTeam[] {
  return TEAM_SEEDS.map((seed, index) => ({
    id: seed.id,
    symbol: seed.symbol,
    name: seed.name,
    color: seed.color,
    glyph: seed.glyph,
    status: seed.status,
    rank: seed.rank,
    wins: seed.wins,
    losses: seed.losses,
    rating: seed.rating,
    ratingDelta: seed.ratingDelta,
    streak: seed.streak,
    matchesHosted: seed.matchesHosted,
    communityPlayers: seed.communityPlayers,
    activity: buildActivity(seed.activity),
    joinedAt: now - (318 - index * 27) * 86_400_000,
    blurb: seed.blurb,
  }))
}

const TRAINING_TRAITS: Record<string, NonNullable<GenesisAgent['traits']>> = {
  BREACHER: { power: 92, mobility: 76, tactics: 60, defense: 71, teamwork: 65 },
  RECON: { power: 57, mobility: 91, tactics: 90, defense: 52, teamwork: 82 },
  VANGUARD: { power: 79, mobility: 65, tactics: 66, defense: 93, teamwork: 84 },
  SPECTRE: { power: 75, mobility: 94, tactics: 83, defense: 47, teamwork: 54 },
  ANCHOR: { power: 70, mobility: 45, tactics: 83, defense: 95, teamwork: 85 },
  ARBITER: { power: 56, mobility: 70, tactics: 95, defense: 72, teamwork: 92 },
}

function buildAgents(): GenesisAgent[] {
  return AGENT_SEEDS.map((seed, index) => {
    const number = index + 1
    const id = `genesis-${String(number).padStart(2, '0')}`
    const rand = seeded(`agent:${id}`)
    const matches = 30 + Math.floor(rand() * 41)
    const wins = Math.round(matches * (0.38 + rand() * 0.28))
    const losses = matches - wins
    return {
      id,
      number,
      codename: seed.codename,
      archetype: seed.archetype,
      color: seed.color,
      status: 'active' as const,
      matches,
      wins,
      losses,
      kills: Math.round(matches * (1.3 + rand() * 1.7)),
      deaths: Math.round(matches * (0.7 + rand() * 0.9)),
      objectives: Math.round(matches * (0.4 + rand() * 1.1)),
      winRate: round(wins / matches, 3),
      rating: 1_400 + Math.round(rand() * 500),
      preferredMode: seed.preferredMode,
      teamHistory: seed.teamHistory,
      bio: seed.bio,
      traits: Object.fromEntries(Object.entries(TRAINING_TRAITS[seed.archetype]).map(([key, value]) => [key, Math.max(1, Math.min(99, value + Math.round(rand() * 10) - 5))])) as NonNullable<GenesisAgent['traits']>,
    }
  })
}

function requireTeam(teams: SolzTeam[], id: string): SolzTeam {
  const found = teams.find((team) => team.id === id)
  if (!found) throw new Error(`Unknown team seed: ${id}`)
  return found
}

function requireAgent(agents: GenesisAgent[], id: string): GenesisAgent {
  const found = agents.find((agent) => agent.id === id)
  if (!found) throw new Error(`Unknown agent seed: ${id}`)
  return found
}

function rosterEntry(matchId: string, agent: GenesisAgent, team: SolzTeam, live: boolean): MatchRosterEntry {
  const rand = seeded(`roster:${matchId}:${agent.id}`)
  const hpMax = 100
  return {
    agentId: agent.id,
    teamId: team.id,
    codename: agent.codename,
    color: team.color,
    // Every seeded round opens clean: eliminations are what the live simulation produces.
    kills: 0,
    deaths: 0,
    assists: live ? Math.floor(rand() * 4) : 0,
    objectives: live ? Math.floor(rand() * 3) : 0,
    hp: live ? Math.round(46 + rand() * 54) : hpMax,
    hpMax,
    status: 'active',
    x: round(6 + rand() * 88, 2),
    y: round(6 + rand() * 88, 2),
    momentum: round(0.2 + rand() * 0.7, 3),
  }
}

function side(team: SolzTeam, score: number, agentIds: string[]): MatchTeamSide {
  return {
    teamId: team.id,
    symbol: team.symbol,
    name: team.name,
    color: team.color,
    glyph: team.glyph,
    score,
    agentIds,
  }
}

function buildMatches(now: number, teams: SolzTeam[], agents: GenesisAgent[]): SolzMatch[] {
  const matches: SolzMatch[] = MATCH_SEEDS.map((seed) => {
    const home = requireTeam(teams, seed.home)
    const away = requireTeam(teams, seed.away)
    const live = seed.phase === 'live'
    const roster = [
      ...seed.homeAgents.map((id) => rosterEntry(seed.id, requireAgent(agents, id), home, live)),
      ...seed.awayAgents.map((id) => rosterEntry(seed.id, requireAgent(agents, id), away, live)),
    ]
    return {
      id: seed.id,
      kind: seed.kind,
      mode: seed.mode,
      map: seed.map,
      round: seed.round,
      phase: seed.phase,
      startedAt: now + seed.startedIn,
      endsAt: now + seed.endsIn,
      viewers: seed.viewers,
      marketId: seed.marketId,
      volume: { ...seed.volume },
      teams: [side(home, seed.score[0], seed.homeAgents), side(away, seed.score[1], seed.awayAgents)],
      roster,
    }
  })
  const ffaTeams = ['team-bonk', 'team-wif', 'team-jup', 'team-pengu'].map((id) => requireTeam(teams, id))
  const ffaId = 'match-11-ffa'
  matches.push({
    id: ffaId, kind: 'community', mode: 'FREE FOR ALL', map: 'CRYO ARCHIVE', round: 'ROUND 1 / 1', phase: 'live',
    startedAt: now - 240_000, endsAt: now + 720_000, viewers: 2840, marketId: 'market-11-winner',
    volume: { SOL: 64, COOLA: 184_000 },
    teams: ffaTeams.map((team, index) => side(team, index + 1, [agents[index].id])),
    roster: ffaTeams.map((team, index) => rosterEntry(ffaId, agents[index], team, true)),
  })
  return matches
}

function teamWeight(match: SolzMatch, teamId: string) {
  const members = match.roster.filter((entry) => entry.teamId === teamId)
  const sideScore = match.teams.find((item) => item.teamId === teamId)?.score ?? 0
  return members.reduce(
    (sum, entry) => sum + (entry.status === 'active'
      ? 0.3 + entry.hp / entry.hpMax + entry.kills * 0.4 + entry.momentum * 0.3 + entry.objectives * 0.12
      : 0.04),
    sideScore * 0.35,
  )
}

function agentWeight(entry: MatchRosterEntry | undefined, kind: 'kills' | 'first') {
  if (!entry) return 0.2
  if (kind === 'kills') {
    return entry.status === 'active'
      ? 0.28 + entry.kills * 0.85 + (entry.hp / entry.hpMax) * 0.32 + entry.momentum * 0.3
      : 0.05 + entry.kills * 0.4
  }
  if (entry.deaths > 0) return 40
  return 0.35 + (1 - entry.hp / entry.hpMax) * 1.9 + entry.momentum * 0.2
}

/** Model value for a market from the current roster. Returns null for markets with no live input. */
function fairValues(market: ArenaMarket, match: SolzMatch | undefined): Record<string, number> | null {
  if (!match) return null
  if (market.kind === 'team-winner') {
    return normalizeWeights(market.outcomes.map((outcome) => ({
      id: outcome.id,
      weight: outcome.teamId ? teamWeight(match, outcome.teamId) : 0.5,
    })))
  }
  if (market.kind === 'most-kills' || market.kind === 'first-eliminated') {
    const kind = market.kind === 'most-kills' ? 'kills' : 'first'
    return normalizeWeights(market.outcomes.map((outcome) => ({
      id: outcome.id,
      weight: agentWeight(match.roster.find((entry) => entry.agentId === outcome.participantId), kind),
    })))
  }
  if (market.kind === 'kill-total') {
    const eliminations = match.roster.reduce((sum, entry) => sum + entry.deaths, 0)
    const over = clamp(0.46 + eliminations * 0.06, 0.06, 0.94)
    return Object.fromEntries(market.outcomes.map((outcome) => [
      outcome.id,
      outcome.id.endsWith('-over') ? over : 1 - over,
    ]))
  }
  return null
}

/** Seeds a readable history that lands exactly on the current probability. */
function seedHistory(market: ArenaMarket, now: number): ArenaMarket {
  const amplitude = market.outcomes.length > 4 ? 0.82 : 0.42
  const waveAmplitude = market.outcomes.length > 4 ? 0.28 : 0.18
  const frames: Array<{ at: number; values: Record<string, number> }> = []
  for (let index = 0; index < HISTORY_POINTS; index += 1) {
    const progress = index / (HISTORY_POINTS - 1)
    const remaining = 1 - progress
    const values = normalizeWeights(market.outcomes.map((outcome) => {
      const random = seeded(`history:${market.id}:${outcome.id}`)
      const bias = (random() * 2 - 1) * amplitude
      const wave = Math.sin(random() * Math.PI * 2 + index * 0.58) * waveAmplitude
      return { id: outcome.id, weight: outcome.probability * Math.exp((bias + wave) * remaining) }
    }))
    frames.push({ at: now - (HISTORY_POINTS - 1 - index) * HISTORY_STEP_MS, values })
  }
  return {
    ...market,
    outcomes: market.outcomes.map((outcome) => ({
      ...outcome,
      priceHistory: frames.map((frame) => ({ at: frame.at, probability: frame.values[outcome.id] })),
    })),
  }
}

function teamWinnerMarket(match: SolzMatch, teams: SolzTeam[]): ArenaMarket {
  const probabilities = normalizeWeights(match.teams.map((item) => ({
    id: item.teamId,
    weight: teamWeight(match, item.teamId),
  })))
  const outcomes: ArenaMarketOutcome[] = match.teams.map((item) => {
    const team = teams.find((row) => row.id === item.teamId)
    return {
      id: `${match.marketId}-${item.teamId}`,
      label: `${item.symbol.replace(/^\$/, "")} TEAM`,
      detail: `${item.name} · ${team ? `${team.wins}W-${team.losses}L` : 'ladder entrant'}`,
      probability: probabilities[item.teamId],
      teamId: item.teamId,
    }
  })
  return {
    id: match.marketId,
    matchId: match.id,
    kind: 'team-winner',
    title: match.teams.length > 2 ? 'Free-for-all winner' : 'Match winner',
    description: `${match.teams.map((team) => team.symbol.replace(/^\$/, "")).join(" vs ")} · ${match.mode} · ${match.map}`,
    status: 'open',
    closesAt: match.endsAt - 60_000,
    volume: { SOL: round(match.volume.SOL * 0.62, 2), COOLA: Math.round(match.volume.COOLA * 0.62) },
    outcomes,
    rules: 'Resolves to the team side recorded as the winner of the final round. A voided match refunds every open position.',
  }
}

function highlightSideMarkets(match: SolzMatch, agents: GenesisAgent[]): ArenaMarket[] {
  const killWeights = normalizeWeights(match.roster.map((entry) => ({
    id: `market-07-most-kills-${entry.agentId}`,
    weight: agentWeight(entry, 'kills'),
  })))
  const firstWeights = normalizeWeights(match.roster.map((entry) => ({
    id: `market-07-first-out-${entry.agentId}`,
    weight: agentWeight(entry, 'first'),
  })))
  const symbolOf = (teamId: string) => match.teams.find((item) => item.teamId === teamId)?.symbol ?? teamId
  const archetypeOf = (agentId: string) => agents.find((agent) => agent.id === agentId)?.archetype ?? 'AGENT'

  return [
    {
      id: 'market-07-most-kills',
      matchId: match.id,
      kind: 'most-kills',
      title: 'Which agent records the most eliminations?',
      description: 'Six Genesis agents on the field. Agents are players, not ladder entries.',
      status: 'open',
      closesAt: match.endsAt - 90_000,
      volume: { SOL: 41.8, COOLA: 118_600 },
      outcomes: match.roster.map((entry) => ({
        id: `market-07-most-kills-${entry.agentId}`,
        label: entry.codename,
        detail: `${symbolOf(entry.teamId)} · ${archetypeOf(entry.agentId)}`,
        probability: killWeights[`market-07-most-kills-${entry.agentId}`],
        participantId: entry.agentId,
        teamId: entry.teamId,
      })),
      rules: 'Resolves to the highest final elimination count in this match. Exact ties split the payout equally.',
    },
    {
      id: 'market-07-kill-total',
      matchId: match.id,
      kind: 'kill-total',
      title: `Total eliminations · over/under ${KILL_LINE}`,
      description: 'Trade the final accepted elimination count for the whole match.',
      status: 'open',
      closesAt: match.endsAt - 120_000,
      volume: { SOL: 27.4, COOLA: 74_900 },
      outcomes: [
        { id: 'market-07-kill-total-over', label: `OVER ${KILL_LINE}`, detail: '0 recorded so far', probability: 0.46 },
        { id: 'market-07-kill-total-under', label: `UNDER ${KILL_LINE}`, detail: 'Round 2 of 3 in progress', probability: 0.54 },
      ],
      rules: 'Resolves from accepted elimination events only. Disconnects and round resets do not count.',
    },
    {
      id: 'market-07-first-out',
      matchId: match.id,
      kind: 'first-eliminated',
      title: 'Who is eliminated first this round?',
      description: 'The next accepted elimination event closes this market.',
      status: 'open',
      closesAt: match.endsAt - 150_000,
      volume: { SOL: 16.2, COOLA: 52_300 },
      outcomes: match.roster.map((entry) => ({
        id: `market-07-first-out-${entry.agentId}`,
        label: entry.codename,
        detail: `${symbolOf(entry.teamId)} · ${entry.hp} HP`,
        probability: firstWeights[`market-07-first-out-${entry.agentId}`],
        participantId: entry.agentId,
        teamId: entry.teamId,
      })),
      rules: 'Resolves to the agent named in the first accepted elimination event of the current round.',
    },
  ]
}

function buildMarkets(now: number, matches: SolzMatch[], teams: SolzTeam[], agents: GenesisAgent[]): ArenaMarket[] {
  const highlight = matches.find((match) => match.id === HIGHLIGHT_MATCH_ID)
  const markets = matches.map((match) => teamWinnerMarket(match, teams))
  if (highlight) {
    const winner = teamWinnerMarket(highlight, teams)
    markets.push({ ...winner, id: 'market-07-round-2', title: 'Round 2 winner',
      outcomes: winner.outcomes.map((outcome, index) => ({ ...outcome, id: `market-07-round-2-${index}`, probability: index === 0 ? 0.61 : 0.39 })),
      volume: { SOL: 25.4, COOLA: 74_000 }, rules: 'Resolves to the team with the highest objective score at the end of round 2. A tied round voids this market.' })
    markets.push({ ...winner, id: 'market-07-handicap', kind: 'team-handicap', title: 'Team handicap',
      outcomes: winner.outcomes.map((outcome, index) => ({ ...outcome, id: `market-07-handicap-${index}`, label: `${outcome.label} ${index === 0 ? '−1.5' : '+1.5'}`, probability: index === 0 ? 0.42 : 0.58 })),
      volume: { SOL: 11.4, COOLA: 32_000 }, rules: 'BONK must finish more than 1.5 points ahead. Otherwise the WIF +1.5 outcome resolves.' })
    markets.push(...highlightSideMarkets(highlight, agents))
  }
  for (const days of [7, 14, 28]) {
    const contenders = ['team-bonk', 'team-wif', 'team-jup', 'team-pengu'].map((id) => requireTeam(teams, id))
    markets.push({
      id: `market-season-${days}`, kind: 'weekly-leader', title: 'Which team will lead the Genesis season?',
      description: 'The next chapter belongs to a community. Predict the team at the top of the ladder.',
      status: 'open', closesAt: now + days * 86_400_000, volume: { SOL: 580 + days * 5, COOLA: 1_240_000 + days * 8500 },
      outcomes: contenders.map((team, index) => ({ id: `season-${days}-${team.id}`, label: `${team.symbol.slice(1)} TEAM`, detail: 'Season ladder leader', teamId: team.id, probability: [0.46, 0.29, 0.17, 0.08][(index + (days === 14 ? 1 : 0)) % 4] })),
      rules: 'Resolves to the highest-rated team on the Genesis ladder at the selected closing date. Ties split the payout equally. This is an off-chain simulation.',
    })
  }
  return markets.map((market) => {
    const seededMarket = seedHistory(market, now)
    if (!market.matchId) for (const outcome of seededMarket.outcomes) {
      outcome.priceHistory = outcome.priceHistory?.map((point, index) => ({ ...point, at: now - (HISTORY_POINTS - 1 - index) * 43_200_000 }))
    }
    return seededMarket
  })
}

function buildPrompts(now: number, matches: SolzMatch[]): PromptSubmission[] {
  const statuses: PromptStatus[] = [
    'pending', 'accepted', 'executed', 'executed', 'ignored', 'accepted', 'executed',
    'pending', 'accepted', 'executed', 'ignored', 'accepted', 'executed', 'pending',
  ]
  const live = matches.filter((match) => match.phase === 'live')
  return PROMPT_TEXTS.map((text, index) => {
    const rand = seeded(`prompt:${index}`)
    const match = index % 4 === 3 ? live[1 + (index % 2)] ?? live[0] : live[0]
    const entry = match.roster[index % match.roster.length]
    const status = statuses[index]
    const token = 'COOLA' as const
    return {
      id: `prompt-seed-${String(index + 1).padStart(2, '0')}`,
      matchId: match.id,
      at: now - (index + 1) * 47_000,
      agentId: entry.agentId,
      codename: entry.codename,
      teamId: entry.teamId,
      author: pickFrom(TAPE_TRADERS, rand()),
      text,
      status,
      upvotes: Math.floor(rand() * 84) + (status === 'executed' ? 26 : 3),
      upvotedByViewer: false,
      cost: PROMPT_COST[token],
      token,
      resolution: status === 'pending' ? undefined
        : status === 'executed' ? `${entry.codename} executed it on the next rotation.`
          : status === 'accepted' ? `${entry.codename} queued it behind the current objective.`
            : `${entry.codename} declined it under autonomous policy.`,
    }
  })
}

function buildChat(now: number, matches: SolzMatch[], prompts: PromptSubmission[]): ChatMessage[] {
  const highlight = matches[0]
  const rows: ChatMessage[] = CHAT_TEXTS.map((text, index) => {
    const rand = seeded(`chat:${index}`)
    const entry = highlight.roster[index % highlight.roster.length]
    return {
      id: `chat-seed-${String(index + 1).padStart(2, '0')}`,
      matchId: highlight.id,
      at: now - (CHAT_TEXTS.length - index) * 26_000,
      author: pickFrom(TAPE_TRADERS, rand()),
      teamId: index % 3 === 0 ? entry.teamId : undefined,
      kind: 'viewer',
      text,
    }
  })
  rows.splice(4, 0, {
    id: 'chat-seed-15',
    matchId: highlight.id,
    at: now - 9 * 26_000 - 4_000,
    author: 'ARENA',
    kind: 'system',
    text: `${highlight.teams[0].symbol} captured the centre relay. Score ${highlight.teams[0].score}-${highlight.teams[1].score}.`,
  })
  rows.splice(8, 0, {
    id: 'chat-seed-16',
    matchId: highlight.id,
    at: now - 6 * 26_000 - 3_000,
    author: 'TAPE',
    kind: 'trade',
    text: `${highlight.teams[1].symbol} bought at 0.41 · 4,200 COOLA`,
  })
  const promptEcho = prompts[2]
  rows.splice(11, 0, {
    id: 'chat-seed-17',
    matchId: promptEcho.matchId,
    at: now - 4 * 26_000 - 2_000,
    author: promptEcho.author,
    teamId: promptEcho.teamId,
    kind: 'prompt',
    text: `→ ${promptEcho.codename}: “${promptEcho.text}”`,
  })
  rows.push({
    id: 'chat-seed-18',
    matchId: highlight.id,
    at: now - 8_000,
    author: 'ARENA',
    kind: 'system',
    text: 'Round 2 objective window opens in 40 seconds.',
  })
  return rows.sort((left, right) => left.at - right.at)
}

function buildAutomation(now: number, markets: ArenaMarket[]): AutomationRule[] {
  const primary = markets.find((market) => market.id === 'market-07-winner')
  const away = primary?.outcomes[1]
  const home = primary?.outcomes[0]
  if (!primary || !home || !away) return []
  return [
    {
      id: 'automation-seed-01',
      matchId: HIGHLIGHT_MATCH_ID,
      marketId: primary.id,
      outcomeId: away.id,
      outcomeLabel: away.label,
      teamId: away.teamId,
      instruction: `Buy ${away.label} whenever the market prices it under 38c.`,
      trigger: { kind: 'below', threshold: 0.38 },
      action: 'buy',
      budget: 250,
      token: 'COOLA',
      status: 'paused',
      createdAt: now - 14 * 60_000,
      fills: 0,
      note: 'Trades the market only. It never sends instructions to an agent.',
    },
    {
      id: 'automation-seed-02',
      matchId: HIGHLIGHT_MATCH_ID,
      marketId: primary.id,
      outcomeId: home.id,
      outcomeLabel: home.label,
      teamId: home.teamId,
      instruction: `Sell ${home.label} once it prices above 62c.`,
      trigger: { kind: 'above', threshold: 0.62 },
      action: 'sell',
      budget: 0.35,
      token: 'SOL',
      status: 'triggered',
      createdAt: now - 26 * 60_000,
      lastFiredAt: now - 4 * 60_000,
      fills: 2,
      note: 'Fired twice on the round 1 spike.',
    },
  ]
}

function buildTape(now: number, markets: ArenaMarket[]): TapeEntry[] {
  const tradable = markets.filter((market) => market.outcomes.length > 0)
  return Array.from({ length: 20 }, (_, index) => {
    const rand = seeded(`tape:${index}`)
    const market = tradable[index % tradable.length]
    const outcome = pickFrom(market.outcomes, rand())
    const automated = index % 4 === 1
    const token: SettlementToken = index % 3 === 0 ? 'SOL' : 'COOLA'
    return {
      id: `tape-seed-${String(index + 1).padStart(2, '0')}`,
      matchId: market.matchId ?? HIGHLIGHT_MATCH_ID,
      at: now - (index + 1) * 21_000,
      side: rand() > 0.42 ? 'buy' : 'sell',
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      teamId: outcome.teamId,
      price: round(outcome.probability, 3),
      size: token === 'SOL' ? round(0.08 + rand() * 3.2, 3) : Math.round(120 + rand() * 8_400),
      token,
      trader: automated ? pickFrom(AUTOMATION_TRADERS, rand()) : pickFrom(TAPE_TRADERS, rand()),
      automated,
    }
  })
}

function buildTimeline(now: number, matches: SolzMatch[]): TimelineEvent[] {
  const highlight = matches[0]
  const kinds: TimelineEvent['kind'][] = ['combat', 'objective', 'market', 'prompt', 'system']
  const texts: Record<string, string[]> = {
    combat: [
      '{a} traded 34 damage holding the west relay.',
      '{a} broke contact at half health and reset.',
      '{a} pinned two agents under the walkway.',
      '{a} took the duel on the ramp and won the ground.',
    ],
    objective: [
      '{t} captured the centre relay.',
      '{t} lost the north bridge after a slow rotation.',
      '{t} banked the objective clock at 40 seconds.',
      '{t} contested the south capture without committing.',
    ],
    market: [
      'Winner market moved 4 points toward {t}.',
      'Automated rule filled on the {t} outcome.',
      'Kill-total tape thinned out under the line.',
      'First-eliminated pricing widened across the roster.',
    ],
    prompt: [
      'Prompt accepted by {a}.',
      'Prompt queued for {a} behind the objective.',
      'Prompt declined by {a} under autonomous policy.',
      'Prompt executed by {a} on the next rotation.',
    ],
    system: [
      'Round 2 opened on DIRE MARSH.',
      'Objective window opens in 40 seconds.',
      'Hazard corridor activated on the north half.',
      'Server tick resynchronised for all clients.',
    ],
  }
  return Array.from({ length: 24 }, (_, index) => {
    const rand = seeded(`timeline:${index}`)
    const kind = kinds[index % kinds.length]
    const entry = highlight.roster[index % highlight.roster.length]
    const sideRow = highlight.teams[index % 2]
    const template = pickFrom(texts[kind], rand())
    return {
      id: `timeline-seed-${String(index + 1).padStart(2, '0')}`,
      matchId: highlight.id,
      at: now - (index + 1) * 33_000,
      kind,
      text: template.replace('{a}', entry.codename).replace('{t}', sideRow.symbol),
      teamId: kind === 'objective' || kind === 'market' ? sideRow.teamId : entry.teamId,
      agentId: kind === 'combat' || kind === 'prompt' ? entry.agentId : undefined,
    }
  })
}

function buildQueue(now: number): HighlightQueueEntry[] {
  return [
    { id: 'queue-seed-01', slot: 'NOW', matchId: HIGHLIGHT_MATCH_ID, homeTeamId: 'team-bonk', awayTeamId: 'team-wif', startsAt: now - 11 * 60_000 },
    { id: 'queue-seed-02', slot: 'NEXT', homeTeamId: 'team-jup', awayTeamId: 'team-ansem', startsAt: now + 12 * 60_000 },
    { id: 'queue-seed-03', slot: 'UPCOMING', homeTeamId: 'team-solz', awayTeamId: 'team-popcat', startsAt: now + 34 * 60_000 },
  ]
}

type BidSeed = {
  id: string
  teamId: string
  slot: QueueSlot | 'RESERVE'
  amount: number
  token: SettlementToken
  status: SpotBidStatus
  bidder: string
  minutesAgo: number
}

/**
 * The NOW slot auction is already settled — $BONK won it and is on the field. The three
 * forward slots are still live, and two of the three leaders ($GIGA, $MOODENG) are tokens
 * that have NOT cleared the activity gate: the whole point of the mechanic is that a slot
 * buys arena exposure, never a ladder place or a win.
 */
const BID_SEEDS: BidSeed[] = [
  { id: 'bid-seed-01', teamId: 'team-bonk', slot: 'NOW', amount: 14.5, token: 'SOL', status: 'won', bidder: '7Kq…f2A', minutesAgo: 46 },
  { id: 'bid-seed-02', teamId: 'team-mew', slot: 'NOW', amount: 260_000, token: 'COOLA', status: 'outbid', bidder: 'mir…7ta', minutesAgo: 52 },
  { id: 'bid-seed-03', teamId: 'team-giga', slot: 'NEXT', amount: 168_000, token: 'COOLA', status: 'leading', bidder: 'zen…4kk', minutesAgo: 12 },
  { id: 'bid-seed-04', teamId: 'team-popcat', slot: 'NEXT', amount: 7.2, token: 'SOL', status: 'outbid', bidder: 'pw9…c4d', minutesAgo: 20 },
  { id: 'bid-seed-05', teamId: 'team-moodeng', slot: 'UPCOMING', amount: 58_000, token: 'COOLA', status: 'leading', bidder: '4Vn…b71', minutesAgo: 6 },
  { id: 'bid-seed-06', teamId: 'team-pengu', slot: 'RESERVE', amount: 1.4, token: 'SOL', status: 'leading', bidder: 'D3r…m08', minutesAgo: 3 },
]

function buildBids(now: number): SpotBid[] {
  return BID_SEEDS
    .map((seed) => ({
      id: seed.id,
      teamId: seed.teamId,
      slot: seed.slot,
      amount: seed.amount,
      token: seed.token,
      at: now - seed.minutesAgo * 60_000,
      status: seed.status,
      bidder: seed.bidder,
    }))
    .sort((left, right) => right.at - left.at)
}

function loadBids(now: number, teams: SolzTeam[]): SpotBid[] {
  if (typeof window === 'undefined') return buildBids(now)
  try {
    const bids: unknown = JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) ?? '{}').bids
    if (Array.isArray(bids) && bids.length <= 40 && bids.every((bid) => (
      typeof bid.id === 'string' && teams.some((team) => team.id === bid.teamId) &&
      ['NOW', 'NEXT', 'UPCOMING', 'RESERVE'].includes(bid.slot) &&
      ['leading', 'outbid', 'won', 'settled'].includes(bid.status) &&
      ['SOL', 'COOLA'].includes(bid.token) && Number.isFinite(bid.amount) && bid.amount > 0 &&
      Number.isFinite(bid.at) && typeof bid.bidder === 'string'
    ))) return bids as SpotBid[]
  } catch { /* An unavailable or old preview account starts with the sample queue. */ }
  return buildBids(now)
}

function buildResults(now: number): MatchResult[] {
  const rows: Array<[string, number, string, number]> = [
    ['team-bonk', 3, 'team-jup', 1],
    ['team-wif', 3, 'team-mew', 2],
    ['team-ansem', 3, 'team-popcat', 0],
    ['team-pengu', 3, 'team-solz', 2],
    ['team-jup', 3, 'team-mew', 1],
    ['team-solz', 3, 'team-giga', 2],
  ]
  return rows.map((row, index) => ({
    id: `result-seed-${String(index + 1).padStart(2, '0')}`,
    matchId: `match-${String(6 - index).padStart(2, '0')}-archive`,
    at: now - (index + 1) * 5_400_000,
    homeTeamId: row[0],
    homeScore: row[1],
    awayTeamId: row[2],
    awayScore: row[3],
  }))
}

/* ------------------------------------------------------------------ account */

function initialAccount(): ArenaAccount {
  return { balances: { SOL: 4.8, COOLA: 42_500 }, positions: [], promptCount: 0 }
}

function cloneAccount(account: ArenaAccount): ArenaAccount {
  return {
    balances: { ...account.balances },
    positions: account.positions.map((position) => ({ ...position })),
    promptCount: account.promptCount,
  }
}

function loadAccount(): ArenaAccount {
  if (typeof window === 'undefined') return initialAccount()
  try {
    const raw = window.localStorage.getItem(ACCOUNT_KEY)
    if (!raw) return initialAccount()
    const parsed = JSON.parse(raw) as ArenaAccount
    if (
      !Number.isFinite(parsed?.balances?.SOL) ||
      !Number.isFinite(parsed?.balances?.COOLA) ||
      !Array.isArray(parsed?.positions)
    ) return initialAccount()
    return cloneAccount({ ...parsed, promptCount: Number(parsed.promptCount) || 0 })
  } catch {
    return initialAccount()
  }
}

function loadLimitOrders(): LimitOrder[] {
  if (typeof window === 'undefined') return []
  try {
    const orders = JSON.parse(window.localStorage.getItem(ACCOUNT_KEY) ?? '{}').limitOrders
    if (Array.isArray(orders) && orders.every((order) => typeof order.id === 'string' &&
      ['buy', 'sell'].includes(order.side) && ['SOL', 'COOLA'].includes(order.token) &&
      ['open', 'filled', 'cancelled', 'expired'].includes(order.status) &&
      Number.isFinite(order.reserved) && Number.isFinite(order.shares) && order.shares > 0 &&
      Number.isFinite(order.price) && order.price > 0 && order.price < 1 && Number.isFinite(order.expiresAt))) return orders
  } catch { /* Fresh simulation account. */ }
  return []
}

function saveAccount(account: ArenaAccount, bids: SpotBid[], limitOrders: LimitOrder[]) {
  if (typeof window === 'undefined') return
  try {
    // Reserve bids and their debited balance must survive reload together.
    window.localStorage.setItem(ACCOUNT_KEY, JSON.stringify({ ...account, bids, limitOrders }))
  } catch {
    // Private-mode storage failures must never break the arena.
  }
}

function createInitialSnapshot(): SolzSnapshot {
  const now = Date.now()
  const teams = buildTeams(now)
  const agents = buildAgents()
  const matches = buildMatches(now, teams, agents)
  const markets = buildMarkets(now, matches, teams, agents)
  const prompts = buildPrompts(now, matches)
  return {
    updatedAt: now,
    highlightMatchId: HIGHLIGHT_MATCH_ID,
    matches,
    markets,
    teams,
    agents,
    prompts,
    chat: buildChat(now, matches, prompts),
    automation: buildAutomation(now, markets),
    tape: buildTape(now, markets),
    timeline: buildTimeline(now, matches),
    queue: buildQueue(now),
    bids: loadBids(now, teams),
    results: buildResults(now),
    account: loadAccount(),
    limitOrders: loadLimitOrders(),
    capabilities: {
      orders: { ready: true },
      prompts: { ready: true },
      automation: { ready: true },
      chat: { ready: true },
    },
  }
}

/* -------------------------------------------------------------------- pricing */

function quoteOrder(intent: ArenaOrderIntent): ArenaOrderQuote {
  const price = Math.max(0.01, intent.outcome.probability)
  const fee = intent.amount * 0.012
  const total = intent.amount + fee
  const shares = intent.amount / price
  return { price, shares, fee, total, potentialPayout: shares, potentialProfit: shares - total }
}

/* ------------------------------------------------------------------ factory */

export function createSolzDataSource(options: { simulationEnabled?: () => boolean } = {}): SolzDataSource {
  const simulationEnabled = () => options.simulationEnabled?.() ?? true
  const requireSimulation = () => { if (!simulationEnabled()) throw new Error('Simulation is off. Live trading is not connected yet.') }
  let snapshot = createInitialSnapshot()
  const listeners = new Set<(value: SolzSnapshot) => void>()
  let interval: ReturnType<typeof setInterval> | null = null
  let tick = 0

  const publish = () => {
    const now = Date.now()
    snapshot.updatedAt = now
    snapshot.account.positions = snapshot.account.positions.map((position) => {
      const market = snapshot.markets.find((item) => item.id === position.marketId)
      const outcome = resolvePredictionContract(market, position.outcomeId)
      const currentPrice = outcome?.probability ?? position.currentPrice
      const value = currentPrice * position.shares
      return { ...position, currentPrice, value, pnl: value - position.stake }
    })
    saveAccount(snapshot.account, snapshot.bids, snapshot.limitOrders)
    const next = structuredClone(snapshot)
    for (const listener of listeners) listener(next)
  }

  const pushTimeline = (event: Omit<TimelineEvent, 'id'>) => {
    snapshot.timeline = [{ ...event, id: uid('timeline') }, ...snapshot.timeline].slice(0, 60)
  }

  const pushChat = (message: Omit<ChatMessage, 'id'>) => {
    snapshot.chat = [...snapshot.chat, { ...message, id: uid('chat') }].slice(-90)
  }

  const pushTape = (entry: Omit<TapeEntry, 'id'>) => {
    snapshot.tape = [{ ...entry, id: uid('tape') }, ...snapshot.tape].slice(0, 44)
  }

  const appendPricePoint = (market: ArenaMarket, at: number) => {
    for (const outcome of market.outcomes) {
      const history = outcome.priceHistory ?? []
      const last = history.at(-1)
      if (!market.matchId && last && at - last.at < 60_000) {
        outcome.priceHistory = [...history.slice(0, -1), { at, probability: outcome.probability }]
      } else {
        outcome.priceHistory = [...history, { at, probability: outcome.probability }].slice(-HISTORY_CAP)
      }
    }
  }

  /** Bounded impact fill shared by manual orders and automation rules. */
  const fillOutcome = (
    market: ArenaMarket,
    outcome: ArenaMarketOutcome,
    token: SettlementToken,
    amount: number,
    action: 'buy' | 'sell',
  ) => {
    const price = Math.max(0.01, outcome.probability)
    const impact = Math.min(0.045, amount / (token === 'SOL' ? 1_200 : 420_000))
    const base = market.outcomes.find((item) => item.id === baseOutcomeId(outcome.id))!
    const remainingBefore = Math.max(0.001, 1 - base.probability)
    const raisesBasePrice = (action === 'buy') !== isNoContract(outcome.id)
    base.probability = raisesBasePrice
      ? Math.min(0.99, base.probability + impact)
      : Math.max(0.01, base.probability - impact)
    const remainingAfter = 1 - base.probability
    for (const other of market.outcomes) {
      if (other.id !== base.id) other.probability *= remainingAfter / remainingBefore
    }
    if (isNoContract(outcome.id)) outcome.probability = 1 - base.probability
    const at = Date.now()
    appendPricePoint(market, at)
    market.volume[token] += amount
    return { price, at }
  }

  const openPosition = (
    market: ArenaMarket,
    outcome: ArenaMarketOutcome,
    token: SettlementToken,
    price: number,
    shares: number,
    stake: number,
    at: number,
  ): ArenaPosition => {
    const position: ArenaPosition = {
      id: uid('position'),
      marketId: market.id,
      marketTitle: market.title,
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      token,
      shares,
      averagePrice: price,
      currentPrice: outcome.probability,
      stake,
      value: shares * outcome.probability,
      pnl: shares * outcome.probability - stake,
      createdAt: at,
    }
    snapshot.account.positions = [position, ...snapshot.account.positions]
    return position
  }

  /* ------------------------------------------------------------ simulation */

  const driftMatch = (match: SolzMatch, now: number) => {
    const active = match.roster.filter((entry) => entry.status === 'active')
    for (const entry of active) {
      const drift = 2.4 + entry.momentum * 2.6
      entry.x = round(clamp(entry.x + (Math.random() - 0.5) * drift, 6, 94), 2)
      entry.y = round(clamp(entry.y + (Math.random() - 0.5) * drift, 6, 94), 2)
      entry.momentum = round(clamp(entry.momentum * 0.988 + (Math.random() - 0.47) * 0.04, 0.08, 1), 3)
      entry.hp = Math.round(clamp(entry.hp - Math.random() * 3.2 + (Math.random() < 0.32 ? 4 : 0), 4, entry.hpMax))
    }

    if (tick % 3 === 0 && active.length > 1 && Math.random() < 0.62) {
      const attacker = pickFrom(active, Math.random())
      const targets = active.filter((entry) => entry.teamId !== attacker.teamId)
      const target = targets.length > 0 ? pickFrom(targets, Math.random()) : null
      if (target) {
        const damage = 14 + Math.floor(Math.random() * 26)
        target.hp = Math.max(0, target.hp - damage)
        if (target.hp === 0) {
          target.status = 'eliminated'
          target.deaths += 1
          attacker.kills += 1
          attacker.momentum = round(clamp(attacker.momentum + 0.14, 0, 1), 3)
          const attackingSide = match.teams.find((item) => item.teamId === attacker.teamId)
          if (attackingSide) attackingSide.score += 1
          pushTimeline({
            matchId: match.id,
            at: now,
            kind: 'combat',
            text: `${attacker.codename} eliminated ${target.codename}.`,
            teamId: attacker.teamId,
            agentId: attacker.agentId,
          })
          pushChat({
            matchId: match.id,
            at: now,
            author: 'ARENA',
            teamId: attacker.teamId,
            kind: 'system',
            text: `${attacker.codename} eliminated ${target.codename}. Score ${match.teams[0].score}-${match.teams[1].score}.`,
          })
          const firstOut = snapshot.markets.find((item) => item.id === 'market-07-first-out')
          if (firstOut && firstOut.matchId === match.id) firstOut.status = 'closed'
        } else {
          target.momentum = round(clamp(target.momentum - 0.05, 0.08, 1), 3)
        }
      }
    }

    // A wiped side resets the round so the demo stays watchable instead of freezing.
    for (const item of match.teams) {
      const survivors = match.roster.filter((entry) => entry.teamId === item.teamId && entry.status === 'active')
      if (survivors.length > 0) continue
      for (const entry of match.roster) {
        entry.status = 'active'
        entry.hp = Math.round(58 + Math.random() * 30)
      }
      pushTimeline({ matchId: match.id, at: now, kind: 'system', text: `Round reset on ${match.map}.` })
      const firstOut = snapshot.markets.find((row) => row.id === 'market-07-first-out')
      if (firstOut && firstOut.matchId === match.id) firstOut.status = 'open'
      break
    }

    match.viewers = Math.max(120, match.viewers + Math.round((Math.random() - 0.44) * 46))
  }

  const nudgeMarkets = (now: number) => {
    for (const market of snapshot.markets) {
      if (market.status !== 'open') continue
      const match = snapshot.matches.find((item) => item.id === market.matchId)
      const fair = fairValues(market, match)
      const weights = market.outcomes.map((outcome) => {
        const target = fair ? fair[outcome.id] : outcome.probability
        const blended = outcome.probability * 0.86 + target * 0.14
        return { id: outcome.id, weight: Math.max(0.02, blended * (1 + (Math.random() - 0.5) * 0.07)) }
      })
      const normalized = normalizeWeights(weights)
      for (const outcome of market.outcomes) outcome.probability = normalized[outcome.id]
      appendPricePoint(market, now)
    }
  }

  const resolvePrompts = (now: number) => {
    for (const prompt of snapshot.prompts) {
      if (prompt.status !== 'pending') continue
      if (now - prompt.at < 6_000) continue
      if (Math.random() > 0.4) continue
      const roll = Math.random()
      const status: PromptStatus = roll < 0.5 ? 'executed' : roll < 0.82 ? 'accepted' : 'ignored'
      prompt.status = status
      prompt.resolution = status === 'executed'
        ? `${prompt.codename} executed it on the next rotation.`
        : status === 'accepted'
          ? `${prompt.codename} queued it behind the current objective.`
          : `${prompt.codename} declined it under autonomous policy.`
      const match = snapshot.matches.find((item) => item.id === prompt.matchId)
      const recipients = prompt.targetAgentIds ?? [prompt.agentId]
      for (const entry of match?.roster ?? []) {
        if (recipients.includes(entry.agentId) && entry.status === 'active' && status !== 'ignored') entry.momentum = round(clamp(entry.momentum + 0.16, 0, 1), 3)
      }
      pushTimeline({
        matchId: prompt.matchId,
        at: now,
        kind: 'prompt',
        text: prompt.resolution,
        teamId: prompt.teamId,
        agentId: prompt.agentId,
      })
    }
  }

  const heldShares = (marketId: string, outcomeId: string, token: SettlementToken) => snapshot.account.positions
    .filter((position) => position.marketId === marketId && position.outcomeId === outcomeId && position.token === token)
    .reduce((sum, position) => sum + position.shares, 0)

  const reservedShares = (marketId: string, outcomeId: string, token: SettlementToken) => snapshot.limitOrders
    .filter((order) => order.status === 'open' && order.side === 'sell' && order.marketId === marketId && order.outcomeId === outcomeId && order.token === token)
    .reduce((sum, order) => sum + order.shares, 0)

  const sell = (market: ArenaMarket, outcome: ArenaMarketOutcome, token: SettlementToken, shares: number, preferredPositionId?: string) => {
    const available = heldShares(market.id, outcome.id, token) - reservedShares(market.id, outcome.id, token)
    if (!Number.isFinite(shares) || shares <= 0 || shares > available + 1e-8) throw new Error('Not enough available shares to sell.')
    const gross = shares * Math.max(0.01, outcome.probability)
    const { price, at } = fillOutcome(market, outcome, token, gross, 'sell')
    let remaining = shares
    const positions = [...snapshot.account.positions].sort((a, b) => Number(b.id === preferredPositionId) - Number(a.id === preferredPositionId))
    for (const position of positions) {
      if (position.marketId !== market.id || position.outcomeId !== outcome.id || position.token !== token) continue
      const sold = Math.min(remaining, position.shares)
      position.stake *= (position.shares - sold) / position.shares
      position.shares -= sold
      remaining -= sold
      if (remaining <= 1e-8) break
    }
    snapshot.account.positions = snapshot.account.positions.filter((position) => position.shares > 1e-8)
    snapshot.account.balances[token] += gross * 0.988
    pushTape({ matchId: market.matchId ?? snapshot.highlightMatchId, at, side: 'sell', outcomeId: outcome.id, outcomeLabel: outcome.label, teamId: outcome.teamId, price, size: gross, token, trader: 'YOU', automated: false })
  }

  const evaluateLimitOrders = (now: number) => {
    if (!simulationEnabled()) return
    for (const order of snapshot.limitOrders) {
      if (order.status !== 'open') continue
      const market = snapshot.markets.find((item) => item.id === order.marketId)
      const outcome = resolvePredictionContract(market, order.outcomeId)
      if (!market || !outcome || market.status !== 'open' || now >= Math.min(order.expiresAt, market.closesAt)) {
        order.status = 'expired'
        snapshot.account.balances[order.token] += order.reserved
        order.reserved = 0
        continue
      }
      const price = Math.max(0.01, outcome.probability)
      if (order.side === 'buy' ? price > order.price : price < order.price) continue
      order.status = 'filled' // Releases any share reservation before executing a sell.
      if (order.side === 'buy') {
        const cost = order.shares * price * 1.012
        snapshot.account.balances[order.token] += order.reserved - cost
        fillOutcome(market, outcome, order.token, order.shares * price, 'buy')
        openPosition(market, outcome, order.token, price, order.shares, cost, now)
        pushTape({ matchId: market.matchId ?? snapshot.highlightMatchId, at: now, side: 'buy', outcomeId: outcome.id, outcomeLabel: outcome.label, teamId: outcome.teamId, price, size: order.shares * price, token: order.token, trader: 'YOU · LIMIT', automated: false })
      } else sell(market, outcome, order.token, order.shares)
      order.reserved = 0
      order.filledPrice = price
    }
  }

  const evaluateAutomation = (now: number) => {
    if (!simulationEnabled()) return
    for (const rule of snapshot.automation) {
      if (rule.status !== 'armed') continue
      const market = snapshot.markets.find((item) => item.id === rule.marketId)
      const outcome = resolvePredictionContract(market, rule.outcomeId)
      if (!market || !outcome || market.status !== 'open' || now >= market.closesAt) {
        rule.status = 'expired'
        rule.note = 'The market is closed.'
        continue
      }
      const history = outcome.priceHistory ?? []
      const previous = history.length > 1 ? history[history.length - 2].probability : outcome.probability
      const threshold = rule.trigger.threshold ?? 0.5
      const fired = rule.trigger.kind === 'below'
        ? outcome.probability <= threshold
        : rule.trigger.kind === 'above'
          ? outcome.probability >= threshold
          : rule.trigger.kind === 'momentum'
            ? Math.abs(outcome.probability - previous) >= 0.025
            : snapshot.timeline.some((event) => event.kind === 'combat' && now - event.at < TICK_MS)
      if (!fired) continue

      const budget = Math.min(rule.budget, snapshot.account.balances[rule.token])
      if (rule.action === 'buy' && budget / 1.012 < MINIMUM_ORDER[rule.token]) {
        rule.status = 'paused'
        rule.note = `Paused: not enough ${rule.token} to fund the next fill.`
        continue
      }
      const held = snapshot.account.positions.filter((position) => position.marketId === market.id && position.outcomeId === outcome.id && position.token === rule.token)
      const sharesToSell = Math.min(rule.budget, Math.max(0, held.reduce((sum, position) => sum + position.shares, 0) - reservedShares(market.id, outcome.id, rule.token)))
      if (rule.action === 'sell' && sharesToSell <= 0) {
        rule.status = 'paused'
        rule.note = 'Paused: no shares of this outcome to sell.'
        continue
      }
      const size = rule.action === 'buy' ? budget / 1.012 : sharesToSell * Math.max(0.01, outcome.probability)
      const { price, at } = fillOutcome(market, outcome, rule.token, size, rule.action)
      if (rule.action === 'buy') {
        snapshot.account.balances[rule.token] -= budget
        openPosition(market, outcome, rule.token, price, size / price, budget, at)
      } else {
        let remaining = sharesToSell
        for (const position of held) {
          const sold = Math.min(remaining, position.shares)
          position.stake *= (position.shares - sold) / position.shares
          position.shares -= sold
          remaining -= sold
          if (remaining <= 0) break
        }
        snapshot.account.positions = snapshot.account.positions.filter((position) => position.shares > 0)
        snapshot.account.balances[rule.token] += size * 0.988
      }
      rule.status = 'triggered'
      rule.lastFiredAt = at
      rule.fills += 1
      rule.note = `${rule.action === 'buy' ? 'Bought' : 'Sold'} ${outcome.label} at ${price.toFixed(2)}.`
      pushTape({
        matchId: rule.matchId,
        at,
        side: rule.action,
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        teamId: outcome.teamId,
        price: round(price, 3),
        size: rule.token === 'SOL' ? round(size, 3) : Math.round(size),
        token: rule.token,
        trader: 'AUTO · YOUR RULE',
        automated: true,
      })
      pushTimeline({
        matchId: rule.matchId,
        at,
        kind: 'market',
        text: `Automation fired: ${rule.action} ${outcome.label} at ${price.toFixed(2)}.`,
        teamId: outcome.teamId,
      })
    }
  }

  const appendAmbientTape = (now: number) => {
    if (Math.random() > 0.55) return
    const open = snapshot.markets.filter((market) => market.status === 'open')
    if (open.length === 0) return
    const market = pickFrom(open, Math.random())
    const outcome = pickFrom(market.outcomes, Math.random())
    const token: SettlementToken = Math.random() > 0.65 ? 'SOL' : 'COOLA'
    const automated = Math.random() > 0.72
    pushTape({
      matchId: market.matchId ?? snapshot.highlightMatchId,
      at: now,
      side: Math.random() > 0.45 ? 'buy' : 'sell',
      outcomeId: outcome.id,
      outcomeLabel: outcome.label,
      teamId: outcome.teamId,
      price: round(outcome.probability, 3),
      size: token === 'SOL' ? round(0.05 + Math.random() * 2.6, 3) : Math.round(150 + Math.random() * 7_400),
      token,
      trader: automated ? pickFrom(AUTOMATION_TRADERS, Math.random()) : pickFrom(TAPE_TRADERS, Math.random()),
      automated,
    })
  }

  const advance = () => {
    if (!simulationEnabled()) return
    tick += 1
    const now = Date.now()
    for (const market of snapshot.markets) {
      if (market.status === 'open' && now >= market.closesAt) market.status = 'closed'
    }
    for (const match of snapshot.matches) {
      if (now >= match.endsAt) match.phase = 'settled'
      else if (match.phase === 'countdown' && now >= match.startedAt) match.phase = 'live'
      if (match.phase === 'live') driftMatch(match, now)
    }
    nudgeMarkets(now)
    resolvePrompts(now)
    evaluateLimitOrders(now)
    evaluateAutomation(now)
    appendAmbientTape(now)
    publish()
  }

  /* -------------------------------------------------------------- contract */

  return {
    mode: 'demo',
    minimumOrder: { ...MINIMUM_ORDER },

    async load(walletAddress) {
      if (snapshot.matches.length === 0 || snapshot.markets.length === 0) snapshot = createInitialSnapshot()
      // Local data needs no round trip; an artificial delay would only fake an empty live shell.
      evaluateLimitOrders(Date.now())
      if (walletAddress) snapshot.capabilities.orders = { ready: true }
      saveAccount(snapshot.account, snapshot.bids, snapshot.limitOrders)
      return structuredClone(snapshot)
    },

    subscribe(listener) {
      listeners.add(listener)
      if (!interval) interval = setInterval(advance, TICK_MS)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && interval) {
          clearInterval(interval)
          interval = null
        }
      }
    },

    quoteOrder,

    async placeOrder(intent, walletAddress) {
      requireSimulation()
      const market = snapshot.markets.find((item) => item.id === intent.market.id)
      if (!market || market.status !== 'open' || Date.now() >= market.closesAt) throw new Error('This market is no longer open.')
      const outcome = resolvePredictionContract(market, intent.outcome.id)
      if (!outcome) throw new Error('That outcome is no longer listed.')
      const minimum = MINIMUM_ORDER[intent.token]
      if (!Number.isFinite(intent.amount) || intent.amount < minimum) {
        throw new Error(`Minimum order is ${minimum} ${intent.token}.`)
      }
      const quote = quoteOrder({ ...intent, market, outcome })
      if (quote.total > snapshot.account.balances[intent.token]) {
        throw new Error(`Not enough ${intent.token} for this order and fee.`)
      }

      snapshot.account.balances[intent.token] -= quote.total
      const { price, at } = fillOutcome(market, outcome, intent.token, intent.amount, 'buy')
      const position = openPosition(market, outcome, intent.token, price, quote.shares, quote.total, at)
      const matchId = market.matchId ?? snapshot.highlightMatchId
      const trader = shortAddress(walletAddress)
      const size = intent.token === 'SOL' ? round(intent.amount, 3) : Math.round(intent.amount)

      pushTape({
        matchId,
        at,
        side: 'buy',
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        teamId: outcome.teamId,
        price: round(price, 3),
        size,
        token: intent.token,
        trader,
        automated: false,
      })
      pushTimeline({
        matchId,
        at,
        kind: 'market',
        text: `${trader} backed ${outcome.label} with ${size} ${intent.token} at ${price.toFixed(2)}.`,
        teamId: outcome.teamId,
      })
      pushChat({
        matchId,
        at,
        author: trader,
        teamId: outcome.teamId,
        kind: 'trade',
        text: `bought ${outcome.label} at ${price.toFixed(2)} · ${size} ${intent.token}`,
        self: true,
      })
      publish()

      const receipt: ArenaOrderReceipt = {
        id: uid('order'),
        position: { ...position },
        market: structuredClone(market),
        account: cloneAccount(snapshot.account),
        status: 'filled',
      }
      return receipt
    },

    async closePosition(positionId) {
      requireSimulation()
      const position = snapshot.account.positions.find((item) => item.id === positionId)
      if (!position) throw new Error('This position has already been closed.')
      const market = snapshot.markets.find((item) => item.id === position.marketId)
      const outcome = resolvePredictionContract(market, position.outcomeId)
      if (!market || !outcome || market.status !== 'open' || Date.now() >= market.closesAt) {
        throw new Error('Positions cannot be sold after this market closes.')
      }
      sell(market, outcome, position.token, position.shares, position.id)
      publish()
      return cloneAccount(snapshot.account)
    },

    async sellShares(marketId, outcomeId, token, shares) {
      requireSimulation()
      const market = snapshot.markets.find((item) => item.id === marketId)
      const outcome = resolvePredictionContract(market, outcomeId)
      if (!market || !outcome || market.status !== 'open' || Date.now() >= market.closesAt) throw new Error('This market is no longer open.')
      sell(market, outcome, token, shares)
      publish()
      return cloneAccount(snapshot.account)
    },

    async placeLimitOrder(intent: LimitOrderIntent) {
      requireSimulation()
      const now = Date.now()
      const market = snapshot.markets.find((item) => item.id === intent.marketId)
      const outcome = resolvePredictionContract(market, intent.outcomeId)
      if (!market || !outcome || market.status !== 'open' || now >= market.closesAt) throw new Error('This market is no longer open.')
      if (!Number.isFinite(intent.price) || intent.price < 0.01 || intent.price > 0.99) throw new Error('Limit price must be between 1 and 99 cents.')
      if (!Number.isFinite(intent.shares) || intent.shares <= 0) throw new Error('Enter a share quantity above zero.')
      const expiresAt = Math.min(intent.expiresAt ?? market.closesAt, market.closesAt)
      if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('Choose a future expiry.')
      const reserved = intent.side === 'buy' ? intent.shares * intent.price * 1.012 : 0
      if (intent.side === 'buy' && intent.shares * intent.price < MINIMUM_ORDER[intent.token]) throw new Error(`Minimum order is ${MINIMUM_ORDER[intent.token]} ${intent.token}.`)
      if (reserved > snapshot.account.balances[intent.token]) throw new Error(`Not enough ${intent.token} for this order and fee.`)
      if (intent.side === 'sell' && intent.shares > heldShares(market.id, outcome.id, intent.token) - reservedShares(market.id, outcome.id, intent.token) + 1e-8) throw new Error('Not enough available shares to sell.')
      snapshot.account.balances[intent.token] -= reserved
      const order: LimitOrder = { ...intent, id: uid('limit'), label: outcome.label, createdAt: now, expiresAt, reserved, status: 'open' }
      snapshot.limitOrders.unshift(order)
      evaluateLimitOrders(now)
      publish()
      return { ...order }
    },

    cancelLimitOrder(orderId) {
      requireSimulation()
      const order = snapshot.limitOrders.find((item) => item.id === orderId && item.status === 'open')
      if (!order) return
      snapshot.account.balances[order.token] += order.reserved
      order.reserved = 0
      order.status = 'cancelled'
      publish()
    },

    quotePrompt(intent): PromptQuote {
      return { cost: PROMPT_COST[intent.token], token: intent.token }
    },

    async submitPrompt(intent: PromptIntent, walletAddress): Promise<PromptReceipt> {
      requireSimulation()
      const text = intent.text.trim()
      if (text.length < 8) throw new Error('A prompt needs at least 8 characters.')
      if (text.length > 220) throw new Error('A prompt is limited to 220 characters.')
      const match = snapshot.matches.find((item) => item.id === intent.matchId)
      if (!match || match.phase !== 'live' || Date.now() >= match.endsAt) throw new Error('That match is not running.')
      const recipients = promptRecipients(match, text, intent.agentId)
      if (!recipients.length) throw new Error('No active agents are available for this prompt.')
      const unavailable = recipients.find((entry) => entry.status !== 'active')
      if (unavailable) throw new Error(`${unavailable.codename} is out of the round and cannot take a prompt.`)
      const entry = recipients[0]
      const codename = recipients.length === 1 ? entry.codename : recipients.length === match.roster.filter((item) => item.status === 'active').length ? 'ALL AGENTS' : recipients.map((item) => item.codename).join(' + ')
      const cost = PROMPT_COST[intent.token]
      if (snapshot.account.balances[intent.token] < cost) {
        throw new Error(`Not enough ${intent.token} to send this prompt.`)
      }

      const at = Date.now()
      snapshot.account.balances[intent.token] -= cost
      snapshot.account.promptCount += 1
      const author = shortAddress(walletAddress)
      const prompt: PromptSubmission = {
        id: uid('prompt'),
        matchId: match.id,
        at,
        agentId: recipients.length === 1 ? entry.agentId : 'arena',
        targetAgentIds: recipients.map((item) => item.agentId),
        codename,
        teamId: entry.teamId,
        author,
        text,
        status: 'pending',
        upvotes: 1,
        upvotedByViewer: true,
        cost,
        token: intent.token,
      }
      snapshot.prompts = [prompt, ...snapshot.prompts].slice(0, 48)
      pushChat({
        matchId: match.id,
        at,
        author,
        teamId: entry.teamId,
        kind: 'prompt',
        text: `→ ${codename}: “${text}”`,
        self: true,
      })
      publish()

      return {
        id: prompt.id,
        status: 'pending',
        message: `Prompt queued for ${codename}. Each agent decides whether to act on it.`,
        account: cloneAccount(snapshot.account),
      }
    },

    upvotePrompt(promptId) {
      if (!simulationEnabled()) return
      const prompt = snapshot.prompts.find((item) => item.id === promptId)
      if (!prompt) return
      prompt.upvotedByViewer = !prompt.upvotedByViewer
      prompt.upvotes = Math.max(0, prompt.upvotes + (prompt.upvotedByViewer ? 1 : -1))
      publish()
    },

    async createAutomation(intent: AutomationIntent) {
      requireSimulation()
      if (!Number.isFinite(intent.budget) || intent.budget <= 0) {
        throw new Error('Set a budget above zero for this automation.')
      }
      const needsThreshold = intent.trigger.kind === 'below' || intent.trigger.kind === 'above'
      const threshold = intent.trigger.threshold
      if (needsThreshold && (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1)) {
        throw new Error('A price trigger needs a threshold between 0 and 1.')
      }
      const market = snapshot.markets.find((item) => item.id === intent.marketId)
      const outcome = resolvePredictionContract(market, intent.outcomeId)
      if (!market || !outcome) throw new Error('That market outcome is no longer listed.')
      if (market.matchId && market.matchId !== intent.matchId) throw new Error('Choose a market in this match.')
      if (market.status !== 'open' || Date.now() >= market.closesAt) throw new Error('This market is no longer open.')
      if (intent.action === 'buy' && intent.budget > snapshot.account.balances[intent.token]) throw new Error(`Your budget exceeds your available ${intent.token}.`)

      const rule: AutomationRule = {
        id: uid('automation'),
        matchId: intent.matchId,
        marketId: market.id,
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        teamId: outcome.teamId,
        instruction: intent.instruction.trim() || `${intent.action} ${outcome.label} on trigger.`,
        trigger: { kind: intent.trigger.kind, threshold: intent.trigger.threshold },
        action: intent.action,
        budget: intent.budget,
        token: intent.token,
        status: 'armed',
        createdAt: Date.now(),
        fills: 0,
        note: 'Trades your market position only. It never plays the match.',
      }
      snapshot.automation = [rule, ...snapshot.automation]
      pushTimeline({
        matchId: intent.matchId,
        at: rule.createdAt,
        kind: 'market',
        text: `Automation armed on ${outcome.label} (${rule.action}).`,
        teamId: outcome.teamId,
      })
      publish()
      return { ...rule }
    },

    setAutomationStatus(ruleId: string, status: AutomationStatus) {
      if (!simulationEnabled()) return
      const rule = snapshot.automation.find((item) => item.id === ruleId)
      if (!rule) return
      rule.status = status
      publish()
    },

    removeAutomation(ruleId) {
      snapshot.automation = snapshot.automation.filter((item) => item.id !== ruleId)
      publish()
    },

    quoteSpotBid(slot) {
      const leading = leadingBidFor(snapshot.bids, slot)
      // Quote in the standing leader's token so the increment is an apples-to-apples raise.
      const token: SettlementToken = leading?.token ?? 'COOLA'
      const quote: { minimum: number; token: SettlementToken; leading?: SpotBid } = {
        minimum: spotBidMinimum(leading, slot, token),
        token,
      }
      if (leading) quote.leading = { ...leading }
      return quote
    },

    async placeSpotBid(teamId, slot, amount, token) {
      requireSimulation()
      const team = snapshot.teams.find((item) => item.id === teamId)
      if (!team) throw new Error('That token is not registered for the arena.')
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a bid above zero.')
      const leading = leadingBidFor(snapshot.bids, slot)
      const minimum = spotBidMinimum(leading, slot, token)
      if (amount < minimum) {
        throw new Error(leading
          ? `The ${slot} slot needs at least ${formatBid(minimum, token)} to clear ${formatBid(leading.amount, leading.token)}.`
          : `The ${slot} slot floor is ${formatBid(minimum, token)}.`)
      }

      const reserved = snapshot.bids.filter((item) => item.slot === slot && item.status === 'leading' && item.bidder === 'YOU')
      const refund = reserved.filter((item) => item.token === token).reduce((sum, item) => sum + item.amount, 0)
      const normalizedAmount = normalizeBidAmount(amount, token)
      if (normalizedAmount > snapshot.account.balances[token] + refund) throw new Error(`Not enough ${token} for this bid.`)
      for (const item of reserved) snapshot.account.balances[item.token] += item.amount
      snapshot.account.balances[token] -= normalizedAmount

      const at = Date.now()
      const bid: SpotBid = {
        id: uid('bid'),
        teamId: team.id,
        slot,
        amount: normalizedAmount,
        token,
        at,
        status: 'leading',
        bidder: shortAddress(),
      }
      // The displaced leader keeps its record; only its standing changes.
      snapshot.bids = [
        bid,
        ...snapshot.bids.map((item) => (
          item.slot === slot && item.status === 'leading' ? { ...item, status: 'outbid' as const } : item
        )),
      ].slice(0, 40)
      pushTimeline({
        matchId: snapshot.queue.find((entry) => entry.slot === slot)?.matchId ?? snapshot.highlightMatchId,
        at,
        kind: 'system',
        // A slot is exposure only, so nothing here touches the team's ladder record.
        text: `${team.symbol} leads the ${slot} slot with ${formatBid(bid.amount, bid.token)}.`,
        teamId: team.id,
      })
      publish()
      return { ...bid }
    },

    sendChat(matchId, text, replyToId) {
      if (!simulationEnabled()) return
      const message = text.trim()
      if (!message) return
      if (!snapshot.matches.some((match) => match.id === matchId)) throw new Error('This event is no longer available.')
      if (replyToId && !snapshot.chat.some((entry) => entry.id === replyToId && entry.matchId === matchId)) throw new Error('The comment you are replying to is no longer available.')
      pushChat({
        matchId,
        at: Date.now(),
        author: 'YOU',
        kind: 'viewer',
        text: message.slice(0, 240),
        self: true,
        replyToId,
      })
      publish()
    },
  }
}
