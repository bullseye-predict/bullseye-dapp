import type {
  ArenaCapability, ArenaMarketOutcome, ArenaPricePoint, ArenaOrderQuote,
  ArenaMarket as SharedMarket, ArenaPosition as SharedPosition,
} from '../arena/model'

export type { ArenaCapability, ArenaMarketOutcome, ArenaPricePoint, ArenaOrderQuote }

// The homepage simulation has its own currency and account. Legacy arena contracts stay portable.
export type SettlementToken = 'SOL' | 'COOLA'
export type ArenaMarket = Omit<SharedMarket, 'volume'> & { volume: Record<SettlementToken, number> }
export type ArenaPosition = Omit<SharedPosition, 'token'> & { token: SettlementToken }
export type ArenaAccount = {
  balances: Record<SettlementToken, number>
  positions: ArenaPosition[]
  promptCount: number
}
export type ArenaOrderIntent = { market: ArenaMarket; outcome: ArenaMarketOutcome; token: SettlementToken; amount: number }
export type ArenaOrderReceipt = { id: string; position: ArenaPosition; market: ArenaMarket; account: ArenaAccount; status: 'filled' | 'submitted' }
export type LimitOrderIntent = {
  marketId: string; outcomeId: string; side: 'buy' | 'sell'; token: SettlementToken
  price: number; shares: number; expiresAt?: number
}
export type LimitOrder = LimitOrderIntent & {
  id: string; label: string; createdAt: number; expiresAt: number; reserved: number
  status: 'open' | 'filled' | 'cancelled' | 'expired'; filledPrice?: number
}

/**
 * COOLA separates six entities on purpose. AGENT plays, TEAM is the token community an agent
 * represents for one match, MATCH is the game, MARKET is what spectators trade, PROMPT is an
 * instruction sent to a playing agent, and AUTOMATION is an agent trading the market for a user.
 * Nothing in this file collapses those into each other.
 */

export type TeamLadderStatus = 'qualified' | 'qualifying' | 'unranked'

/** Gameplay activity a token accumulates before it earns a leaderboard slot. */
export type TeamActivity = {
  matches: number
  matchesRequired: number
  uniquePlayers: number
  uniquePlayersRequired: number
  hostedArenas: number
  hostedArenasRequired: number
  completionRate: number
  /** 0..1 across every requirement. 1 means the token is eligible for the ladder. */
  progress: number
}

/** A token/community competing in the arena. Teams are ranked; Genesis agents are not. */
export type SolzTeam = {
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
  activity: TeamActivity
  joinedAt: number
  blurb: string
}

export type AgentStatus = 'active' | 'reserve' | 'retired'

/** A persistent Genesis agent. These are the players; their stats accumulate across matches. */
export type AgentTraits = { power: number; mobility: number; tactics: number; defense: number; teamwork: number }

export type GenesisAgent = {
  id: string
  number: number
  codename: string
  archetype: string
  color: string
  status: AgentStatus
  matches: number
  wins: number
  losses: number
  kills: number
  deaths: number
  objectives: number
  winRate: number
  rating: number
  preferredMode: string
  /** Team ids this agent has represented, most recent first. */
  teamHistory: string[]
  bio: string
  /** Illustrative training traits in the sample data adapter, on a 0–100 scale. */
  traits?: AgentTraits
}

export type RosterStatus = 'active' | 'downed' | 'eliminated' | 'extracted'

/** Live in-match state for one agent. Distinct from the agent's persistent record. */
export type MatchRosterEntry = {
  agentId: string
  teamId: string
  codename: string
  color: string
  kills: number
  deaths: number
  assists: number
  objectives: number
  hp: number
  hpMax: number
  status: RosterStatus
  x: number
  y: number
  momentum: number
}

export type MatchTeamSide = {
  teamId: string
  symbol: string
  name: string
  color: string
  glyph: string
  score: number
  agentIds: string[]
}

export type MatchPhase = 'queued' | 'countdown' | 'live' | 'settled'
export type MatchKind = 'highlight' | 'community'

export type SolzMatch = {
  id: string
  /** Human-readable match label assigned by the game service, when available. */
  displayMatchId?: string
  kind: MatchKind
  mode: string
  map: string
  round: string
  phase: MatchPhase
  startedAt: number
  endsAt: number
  viewers: number
  streamUrl?: string
  marketId: string
  volume: Record<SettlementToken, number>
  /** Two or more teams, including free-for-all matches. */
  teams: MatchTeamSide[]
  roster: MatchRosterEntry[]
}

export type PromptStatus = 'pending' | 'accepted' | 'executed' | 'ignored'

/** A public instruction addressed to an agent competing inside the arena. */
export type PromptSubmission = {
  targetAgentIds?: string[]
  id: string
  matchId: string
  at: number
  agentId: string
  codename: string
  teamId: string
  author: string
  text: string
  status: PromptStatus
  upvotes: number
  upvotedByViewer: boolean
  cost: number
  token: SettlementToken
  resolution?: string
}

export type ChatKind = 'viewer' | 'system' | 'trade' | 'prompt'

export type ChatMessage = {
  id: string
  matchId: string
  at: number
  author: string
  teamId?: string
  kind: ChatKind
  text: string
  self?: boolean
  replyToId?: string
}

export type AutomationTriggerKind = 'below' | 'above' | 'momentum' | 'telemetry'
export type AutomationStatus = 'armed' | 'triggered' | 'paused' | 'expired'

/** A trading agent operating the market on a spectator's behalf. It never plays the game. */
export type AutomationRule = {
  id: string
  matchId: string
  marketId: string
  outcomeId: string
  outcomeLabel: string
  teamId?: string
  instruction: string
  trigger: { kind: AutomationTriggerKind; threshold?: number }
  action: 'buy' | 'sell'
  budget: number
  token: SettlementToken
  status: AutomationStatus
  createdAt: number
  lastFiredAt?: number
  fills: number
  note?: string
}

export type TapeEntry = {
  id: string
  matchId: string
  at: number
  side: 'buy' | 'sell'
  outcomeId: string
  outcomeLabel: string
  teamId?: string
  price: number
  size: number
  token: SettlementToken
  trader: string
  automated: boolean
}

export type TimelineKind = 'combat' | 'objective' | 'market' | 'prompt' | 'system'

export type TimelineEvent = {
  id: string
  matchId: string
  at: number
  kind: TimelineKind
  text: string
  teamId?: string
  agentId?: string
}

export type QueueSlot = 'NOW' | 'NEXT' | 'UPCOMING'

export type HighlightQueueEntry = {
  id: string
  slot: QueueSlot
  matchId?: string
  homeTeamId: string
  awayTeamId: string
  startsAt: number
}

export type SpotBidStatus = 'leading' | 'outbid' | 'won' | 'settled'

/**
 * A token community can also BID for a highlight-queue slot instead of waiting for the
 * activity ladder to promote it. Bidding buys arena exposure; it never buys a W/L record.
 */
export type SpotBid = {
  id: string
  teamId: string
  slot: QueueSlot | 'RESERVE'
  amount: number
  token: SettlementToken
  at: number
  status: SpotBidStatus
  bidder: string
}

export type MatchResult = {
  id: string
  matchId: string
  at: number
  homeTeamId: string
  homeScore: number
  awayTeamId: string
  awayScore: number
}

export type SolzSnapshot = {
  updatedAt: number
  highlightMatchId: string
  matches: SolzMatch[]
  markets: ArenaMarket[]
  teams: SolzTeam[]
  agents: GenesisAgent[]
  prompts: PromptSubmission[]
  chat: ChatMessage[]
  automation: AutomationRule[]
  tape: TapeEntry[]
  timeline: TimelineEvent[]
  queue: HighlightQueueEntry[]
  bids: SpotBid[]
  results: MatchResult[]
  account: ArenaAccount
  limitOrders: LimitOrder[]
  capabilities: {
    orders: ArenaCapability
    prompts: ArenaCapability
    automation: ArenaCapability
    chat: ArenaCapability
  }
}

export type PromptIntent = {
  matchId: string
  agentId?: string
  text: string
  token: SettlementToken
}

export type PromptQuote = {
  cost: number
  token: SettlementToken
}

export type PromptReceipt = {
  id: string
  status: PromptStatus
  message: string
  account: ArenaAccount
}

export type AutomationIntent = {
  matchId: string
  marketId: string
  outcomeId: string
  instruction: string
  trigger: { kind: AutomationTriggerKind; threshold?: number }
  action: 'buy' | 'sell'
  budget: number
  token: SettlementToken
}

export type SolzDataSource = {
  mode: 'demo' | 'live'
  minimumOrder: Record<SettlementToken, number>
  load: (walletAddress?: string) => Promise<SolzSnapshot>
  subscribe: (listener: (snapshot: SolzSnapshot) => void) => () => void
  quoteOrder: (intent: ArenaOrderIntent) => ArenaOrderQuote
  placeOrder: (intent: ArenaOrderIntent, walletAddress?: string) => Promise<ArenaOrderReceipt>
  closePosition: (positionId: string) => Promise<ArenaAccount>
  sellShares: (marketId: string, outcomeId: string, token: SettlementToken, shares: number) => Promise<ArenaAccount>
  placeLimitOrder: (intent: LimitOrderIntent) => Promise<LimitOrder>
  cancelLimitOrder: (orderId: string) => void
  quotePrompt: (intent: PromptIntent) => PromptQuote
  submitPrompt: (intent: PromptIntent, walletAddress?: string) => Promise<PromptReceipt>
  upvotePrompt: (promptId: string) => void
  createAutomation: (intent: AutomationIntent) => Promise<AutomationRule>
  setAutomationStatus: (ruleId: string, status: AutomationStatus) => void
  removeAutomation: (ruleId: string) => void
  sendChat: (matchId: string, text: string, replyToId?: string) => void
  quoteSpotBid: (slot: QueueSlot | 'RESERVE') => { minimum: number; token: SettlementToken; leading?: SpotBid }
  placeSpotBid: (teamId: string, slot: QueueSlot | 'RESERVE', amount: number, token: SettlementToken) => Promise<SpotBid>
}

/** Navigation is owned by the host so features stay router-agnostic. */
export type SolzNavigation = {
  matchHref: (matchId: string) => string
  teamHref: (teamId: string) => string
  agentHref: (agentId: string) => string
  marketsHref: string
  leaderboardHref: string
  teamsHref: string
  agentsHref: string
  arenaHref: string
}
