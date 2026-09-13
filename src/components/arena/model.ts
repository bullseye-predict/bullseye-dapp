export type ArenaMode = 'demo' | 'live'
export type SettlementToken = 'SOL' | 'SOLZ'

export type ArenaParticipant = {
  id: string
  name: string
  kind: 'genesis-agent' | 'human'
  teamId: string
  teamName: string
  color: string
  kills: number
  deaths: number
  hp: number
  hpMax: number
  status: 'active' | 'eliminated' | 'evacuated'
  x: number
  y: number
  momentum: number
}

export type ArenaTeam = {
  id: string
  name: string
  color: string
}

export type ArenaMatch = {
  id: string
  title: string
  subtitle: string
  format: 'agent-league' | 'human-tourney'
  phase: 'waiting' | 'countdown' | 'live' | 'finished'
  source: 'simulation' | 'colyseus'
  arena: string
  startedAt: number
  endsAt: number
  viewers: number
  totalRewardPool: number
  stakeToken: SettlementToken
  roomId?: string
  streamUrl?: string
  teams: ArenaTeam[]
  participants: ArenaParticipant[]
}

export type ArenaMarketKind =
  | 'match-winner'
  | 'team-winner'
  | 'team-handicap'
  | 'kill-total'
  | 'most-kills'
  | 'first-eliminated'
  | 'weekly-leader'
  | 'weekly-volume'

export type ArenaMarketOutcome = {
  id: string
  label: string
  detail: string
  probability: number
  priceHistory?: ArenaPricePoint[]
  /** Observed exchange quotes, kept distinct from executed trade prices. */
  quoteHistory?: ArenaPricePoint[]
  historyStatus?: 'ready' | 'unavailable'
  participantId?: string
  teamId?: string
}

export type ArenaPricePoint = {
  at: number
  probability: number
}

export type ArenaMarket = {
  id: string
  matchId?: string
  kind: ArenaMarketKind
  title: string
  description: string
  status: 'open' | 'closed' | 'indicative'
  closesAt: number
  volume: Record<SettlementToken, number>
  outcomes: ArenaMarketOutcome[]
  rules: string
  /** Verified public identity for a venue-backed question; never contains a signer or key. */
  onchain?: { chainId: '5031' | '50312'; marketId: `0x${string}`; oracleQuestionId: string; tradingStartsAt: number; tradingLocksAt: number; voidPolicy: 0 | 2; indexerUrl: string; wsRpcUrl: string; creationTxHash?: string; sponsoredTransactions?: { label: string; hash: string }[]; volume24h?: { amount: string; decimals: number; trades: number } }
}

export type ArenaFeedEvent = {
  id: string
  at: number
  kind: 'system' | 'combat' | 'prompt' | 'market'
  text: string
  actorId?: string
  targetId?: string
}

export type ArenaPosition = {
  id: string
  marketId: string
  marketTitle: string
  outcomeId: string
  outcomeLabel: string
  token: SettlementToken
  shares: number
  averagePrice: number
  currentPrice: number
  stake: number
  value: number
  pnl: number
  createdAt: number
}

export type ArenaAccount = {
  balances: Record<SettlementToken, number>
  positions: ArenaPosition[]
  promptCount: number
}

export type LeaderboardRow = {
  id: string
  name: string
  wins: number
  kills: number
  deaths: number
  matches: number
  earnedSol: number
  earnedSolz: number
}

export type ArenaCapability = {
  ready: boolean
  reason?: string
}

export type ArenaSnapshot = {
  updatedAt: number
  matches: ArenaMatch[]
  markets: ArenaMarket[]
  account: ArenaAccount
  leaderboard: LeaderboardRow[]
  feed: ArenaFeedEvent[]
  selectedMatchId?: string
  capabilities: {
    orders: ArenaCapability
    prompts: ArenaCapability
    observer: ArenaCapability
  }
}

export type ArenaOrderIntent = {
  market: ArenaMarket
  outcome: ArenaMarketOutcome
  token: SettlementToken
  amount: number
}

export type ArenaOrderQuote = {
  price: number
  shares: number
  fee: number
  total: number
  potentialPayout: number
  potentialProfit: number
}

export type ArenaOrderReceipt = {
  id: string
  position: ArenaPosition
  market: ArenaMarket
  account: ArenaAccount
  status: 'filled' | 'submitted'
  signature?: string
}

export type ArenaPromptIntent = {
  match: ArenaMatch
  participant: ArenaParticipant
  token: SettlementToken
  prompt: string
}

export type ArenaPromptQuote = {
  cost: number
  token: SettlementToken
}

export type ArenaPromptReceipt = {
  id: string
  status: 'executed' | 'ignored' | 'submitted'
  message: string
  account: ArenaAccount
  signature?: string
}

export type ArenaAdapter = {
  mode: ArenaMode
  minimumOrder: Record<SettlementToken, number>
  load: (walletAddress?: string) => Promise<ArenaSnapshot>
  subscribe?: (listener: (snapshot: ArenaSnapshot) => void) => () => void
  quoteOrder: (intent: ArenaOrderIntent) => ArenaOrderQuote
  placeOrder: (intent: ArenaOrderIntent, walletAddress?: string) => Promise<ArenaOrderReceipt>
  quotePrompt: (intent: ArenaPromptIntent) => ArenaPromptQuote
  sendPrompt: (intent: ArenaPromptIntent, walletAddress?: string) => Promise<ArenaPromptReceipt>
  advanceSimulation?: () => void
  reset?: () => Promise<ArenaSnapshot>
}
