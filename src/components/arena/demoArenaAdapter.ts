import type {
  ArenaAccount,
  ArenaAdapter,
  ArenaFeedEvent,
  ArenaMarket,
  ArenaMarketOutcome,
  ArenaMatch,
  ArenaOrderIntent,
  ArenaOrderQuote,
  ArenaParticipant,
  ArenaPricePoint,
  ArenaSnapshot,
  LeaderboardRow,
  SettlementToken,
} from './model'

const DEMO_ACCOUNT_KEY = 'solz-arena.demo-account.v2'
const SIMULATION_STEP_MS = 3_200

const teamCatalog = [
  { id: 'ion', name: 'ION SYNDICATE', color: '#c8ff55' },
  { id: 'nova', name: 'NOVA UNION', color: '#ff8b73' },
  { id: 'void', name: 'VOID RUNNERS', color: '#82a9ff' },
]

const agentNames = [
  'ATLAS-01', 'KIRA-02', 'BOLT-03', 'NYX-04',
  'VANTA-05', 'ORBIT-06', 'HELIX-07', 'RUNE-08',
  'ECHO-09', 'MIRA-10', 'PULSE-11', 'GHOST-12',
]

function cloneAccount(account: ArenaAccount): ArenaAccount {
  return {
    balances: { ...account.balances },
    positions: account.positions.map((position) => ({ ...position })),
    promptCount: account.promptCount,
  }
}

function initialAccount(): ArenaAccount {
  return {
    balances: { SOL: 4.8, SOLZ: 42_500 },
    positions: [],
    promptCount: 0,
  }
}

function loadAccount() {
  if (typeof window === 'undefined') return initialAccount()
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DEMO_ACCOUNT_KEY) ?? '') as ArenaAccount
    if (
      !Number.isFinite(parsed?.balances?.SOL) ||
      !Number.isFinite(parsed?.balances?.SOLZ) ||
      !Array.isArray(parsed?.positions)
    ) return initialAccount()
    return cloneAccount(parsed)
  } catch {
    return initialAccount()
  }
}

function saveAccount(account: ArenaAccount) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(DEMO_ACCOUNT_KEY, JSON.stringify(account))
}

function participant(index: number): ArenaParticipant {
  const team = teamCatalog[index % teamCatalog.length]
  const angle = (index / agentNames.length) * Math.PI * 2
  return {
    id: `genesis-${index + 1}`,
    name: agentNames[index],
    kind: 'genesis-agent',
    teamId: team.id,
    teamName: team.name,
    color: team.color,
    kills: index === 1 ? 2 : index === 7 ? 1 : 0,
    deaths: 0,
    hp: 72 + ((index * 17) % 29),
    hpMax: 100,
    status: 'active',
    x: 50 + Math.cos(angle) * (24 + (index % 3) * 5),
    y: 50 + Math.sin(angle) * (24 + (index % 3) * 5),
    momentum: 0.35 + ((index * 13) % 45) / 100,
  }
}

function normalizeWeights(rows: Array<{ id: string; weight: number }>) {
  const safe = rows.map((row) => ({ ...row, weight: Math.max(0.01, row.weight) }))
  const total = safe.reduce((sum, row) => sum + row.weight, 0)
  return Object.fromEntries(safe.map((row) => [row.id, row.weight / total]))
}

function seedFromId(value: string) {
  return Array.from(value).reduce((seed, character) => ((seed * 31) + character.charCodeAt(0)) >>> 0, 2166136261)
}

function practiceMarketHistory(market: ArenaMarket, now: number): Record<string, ArenaPricePoint[]> {
  const histories = Object.fromEntries(market.outcomes.map((outcome) => [outcome.id, [] as ArenaPricePoint[]]))
  const outcomeCount = market.outcomes.length
  const openingAmplitude = outcomeCount > 4 ? 0.9 : outcomeCount > 2 ? 0.58 : 0.44
  const waveAmplitude = outcomeCount > 4 ? 0.3 : 0.2

  // Six shared minutes make Practice readable on first paint; normalizing every timestamp keeps a market's visible history mathematically tradeable.
  for (let index = 0; index < 25; index += 1) {
    const progress = index / 24
    const remaining = 1 - progress
    const weights = market.outcomes.map((outcome) => {
      const seed = seedFromId(`${market.id}:${outcome.id}`)
      const openingBias = ((((seed >>> 4) % 2_001) / 1_000) - 1) * openingAmplitude
      const wave = Math.sin((seed % 628) / 100 + index * 0.62) * waveAmplitude
      return {
        id: outcome.id,
        weight: outcome.probability * Math.exp((openingBias + wave) * remaining),
      }
    })
    const normalized = normalizeWeights(weights)
    const at = now - (24 - index) * 15_000
    for (const outcome of market.outcomes) {
      histories[outcome.id].push({ at, probability: normalized[outcome.id] })
    }
  }

  return histories
}

function withPriceHistory(market: ArenaMarket, previous: ArenaMarket | undefined, now: number): ArenaMarket {
  const canReusePrevious = market.outcomes.every((outcome) => (
    previous?.outcomes.find((item) => item.id === outcome.id)?.priceHistory?.length
  ))
  const generated = canReusePrevious ? null : practiceMarketHistory(market, now)
  return {
    ...market,
    outcomes: market.outcomes.map((outcome) => {
      const previousOutcome = previous?.outcomes.find((item) => item.id === outcome.id)
      const history = canReusePrevious
        ? previousOutcome?.priceHistory?.slice(-47) ?? []
        : generated?.[outcome.id] ?? []
      const last = history.at(-1)
      if (!last || now > last.at || Math.abs(last.probability - outcome.probability) >= 0.0001) {
        history.push({ at: now, probability: outcome.probability })
      }
      return { ...outcome, priceHistory: history.slice(-48) }
    }),
  }
}

function participantOutcomes(participants: ArenaParticipant[], kind: 'winner' | 'kills' | 'first') {
  const probabilities = normalizeWeights(participants.map((player) => {
    const alive = player.status === 'active' ? 1 : 0.015
    const weight = kind === 'winner'
      ? alive * (0.3 + player.hp / player.hpMax + player.kills * 0.42 + player.momentum * 0.35)
      : kind === 'kills'
        ? alive * (0.24 + player.kills * 0.85 + player.hp / player.hpMax * 0.25 + player.momentum * 0.3)
        : player.deaths > 0
          ? 100
          : 0.4 + (1 - player.hp / player.hpMax) * 1.8
    return { id: player.id, weight }
  }))

  return participants.map<ArenaMarketOutcome>((player) => ({
    id: player.id,
    label: player.name,
    detail: `${player.teamName} · ${player.kills}K/${player.deaths}D`,
    probability: probabilities[player.id],
    participantId: player.id,
  }))
}

function buildMarkets(match: ArenaMatch, previous?: ArenaMarket[]): ArenaMarket[] {
  const now = Date.now()
  const teamProbabilities = normalizeWeights(match.teams.map((team) => {
    const members = match.participants.filter((player) => player.teamId === team.id)
    return {
      id: team.id,
      weight: members.reduce(
        (sum, player) => sum + (player.status === 'active' ? player.hp / player.hpMax + player.kills * 0.45 + 0.2 : 0.02),
        0
      ),
    }
  }))
  const previousVolume = (id: string) => previous?.find((market) => market.id === id)?.volume ?? { SOL: 0, SOLZ: 0 }
  const favoriteTeam = [...match.teams].sort((left, right) => teamProbabilities[right.id] - teamProbabilities[left.id])[0]
  const favoriteProbability = favoriteTeam ? teamProbabilities[favoriteTeam.id] : 0.5
  const finalKillLine = 8.5
  const recordedEliminations = match.participants.reduce((sum, player) => sum + player.deaths, 0)
  // The practice total starts near even so both sides are useful to trade; accepted eliminations move it toward the over.
  const overKillProbability = Math.min(0.88, Math.max(0.18, 0.54 + recordedEliminations * 0.045))

  const markets: ArenaMarket[] = [
    {
      id: 'genesis-team-winner',
      matchId: match.id,
      kind: 'team-winner',
      title: 'Genesis Match 07 · Team moneyline',
      description: 'Which squad owns the terminal win state?',
      status: 'open',
      closesAt: match.endsAt - 45_000,
      volume: previousVolume('genesis-team-winner').SOL > 0 ? previousVolume('genesis-team-winner') : { SOL: 52.1, SOLZ: 118_400 },
      outcomes: match.teams.map((team) => ({
        id: team.id,
        label: team.name,
        detail: `${match.participants.filter((player) => player.teamId === team.id && player.status === 'active').length} active`,
        probability: teamProbabilities[team.id],
        teamId: team.id,
      })),
      rules: 'Resolves to winnerTeamId. A void result refunds every open position.',
    },
    {
      id: 'genesis-overall-winner',
      matchId: match.id,
      kind: 'match-winner',
      title: 'Which Genesis agent-athlete wins Match 07?',
      description: 'Twelve autonomous competitors. One terminal winner.',
      status: 'open',
      closesAt: match.endsAt - 45_000,
      volume: previousVolume('genesis-overall-winner').SOL > 0 ? previousVolume('genesis-overall-winner') : { SOL: 86.4, SOLZ: 284_200 },
      outcomes: participantOutcomes(match.participants, 'winner'),
      rules: 'Resolves to the server-authoritative winnerId in the terminal SOLZ match result.',
    },
    {
      id: 'genesis-survival-handicap',
      matchId: match.id,
      kind: 'team-handicap',
      title: 'Survivors handicap · Favorite -1.5',
      description: 'The favorite must finish with at least two more active agents than the field leader.',
      status: 'open',
      closesAt: match.endsAt - 75_000,
      volume: previousVolume('genesis-survival-handicap').SOL > 0 ? previousVolume('genesis-survival-handicap') : { SOL: 27.6, SOLZ: 74_200 },
      outcomes: favoriteTeam ? [
        {
          id: `${favoriteTeam.id}-minus-1-5`,
          label: `${favoriteTeam.name} -1.5`,
          detail: 'Wins by 2+ surviving agents',
          probability: Math.min(0.78, Math.max(0.22, favoriteProbability * 0.92)),
          teamId: favoriteTeam.id,
        },
        {
          id: 'field-plus-1-5',
          label: 'FIELD +1.5',
          detail: 'Any other result',
          probability: 1 - Math.min(0.78, Math.max(0.22, favoriteProbability * 0.92)),
        },
      ] : [],
      rules: 'Resolves from the terminal active roster. The favorite covers only with a survivor margin of two or more.',
    },
    {
      id: 'genesis-total-kills',
      matchId: match.id,
      kind: 'kill-total',
      title: `Total eliminations · ${finalKillLine}`,
      description: 'Trade the final accepted elimination count for this match.',
      status: 'open',
      closesAt: match.endsAt - 90_000,
      volume: previousVolume('genesis-total-kills').SOL > 0 ? previousVolume('genesis-total-kills') : { SOL: 44.8, SOLZ: 132_600 },
      outcomes: [
        { id: 'over-8-5', label: `OVER ${finalKillLine}`, detail: `${recordedEliminations} recorded`, probability: overKillProbability },
        { id: 'under-8-5', label: `UNDER ${finalKillLine}`, detail: `${12 - recordedEliminations} agents remain`, probability: 1 - overKillProbability },
      ],
      rules: 'Resolves from the count of accepted terminal kill events. Exactly eight eliminations settles under; nine settles over.',
    },
    {
      id: 'genesis-kill-leader',
      matchId: match.id,
      kind: 'most-kills',
      title: 'Who records the most eliminations?',
      description: 'Live kills move the signal after every accepted server event.',
      status: 'open',
      closesAt: match.endsAt - 90_000,
      volume: previousVolume('genesis-kill-leader').SOL > 0 ? previousVolume('genesis-kill-leader') : { SOL: 31.8, SOLZ: 94_750 },
      outcomes: participantOutcomes(match.participants, 'kills'),
      rules: 'Resolves from the highest final kills value. Exact ties split the payout equally.',
    },
    {
      id: 'genesis-first-down',
      matchId: match.id,
      kind: 'first-eliminated',
      title: 'Who is eliminated first?',
      description: 'The first authoritative death event closes this market.',
      status: match.participants.some((player) => player.deaths > 0) ? 'closed' : 'open',
      closesAt: Math.min(match.endsAt, now + 240_000),
      volume: previousVolume('genesis-first-down').SOL > 0 ? previousVolume('genesis-first-down') : { SOL: 18.2, SOLZ: 61_100 },
      outcomes: participantOutcomes(match.participants, 'first'),
      rules: 'Resolves to the targetId of the first accepted kill event. Disconnects alone do not count.',
    },
    {
      id: 'weekly-genesis-leader',
      kind: 'weekly-leader',
      title: 'Who tops the Genesis weekly leaderboard?',
      description: 'Season-form market across every sanctioned SOLZ agent match this week.',
      status: 'open',
      closesAt: now + 3 * 86_400_000,
      volume: previousVolume('weekly-genesis-leader').SOL > 0 ? previousVolume('weekly-genesis-leader') : { SOL: 121.7, SOLZ: 612_800 },
      outcomes: participantOutcomes(match.participants, 'kills'),
      rules: 'Resolves from the published weekly ranking after the final sanctioned match is indexed.',
    },
    {
      id: 'weekly-solz-reward-total',
      kind: 'weekly-volume',
      title: 'Will weekly SOLZ match rewards exceed 500K SOLZ?',
      description: 'Tracks the aggregate terminal reward records for the current league week.',
      status: 'open',
      closesAt: now + 3 * 86_400_000,
      volume: previousVolume('weekly-solz-reward-total').SOL > 0 ? previousVolume('weekly-solz-reward-total') : { SOL: 77.3, SOLZ: 355_400 },
      outcomes: [
        { id: 'over-500k', label: 'YES · Over 500K', detail: 'Current pace 538K SOLZ', probability: 0.62 },
        { id: 'under-500k', label: 'NO · 500K or less', detail: 'Includes voided match adjustments', probability: 0.38 },
      ],
      rules: 'Resolves from the sum of server-authoritative reward records finalized before the weekly cutoff.',
    },
  ]

  return markets.map((market) => withPriceHistory(
    market,
    previous?.find((item) => item.id === market.id),
    now
  ))
}

function demoLeaderboard(participants: ArenaParticipant[]): LeaderboardRow[] {
  return participants
    .map((player, index) => ({
      id: player.id,
      name: player.name,
      wins: 18 - (index % 7),
      kills: 102 - index * 4 + player.kills,
      deaths: 41 + index * 2 + player.deaths,
      matches: 48 + (index % 5) * 3,
      earnedSol: 12.4 - index * 0.37,
      earnedSolz: 84_200 - index * 2_850,
    }))
    .sort((left, right) => right.wins - left.wins || right.kills - left.kills)
}

function createInitialSnapshot(): ArenaSnapshot {
  const now = Date.now()
  const participants = agentNames.map((_, index) => participant(index))
  const match: ArenaMatch = {
    id: 'genesis-match-07',
    title: 'Genesis Agent League · Match 07',
    subtitle: '12 agent-athletes · autonomous combat',
    format: 'agent-league',
    phase: 'live',
    source: 'simulation',
    arena: 'SOLZ Matrix 01',
    startedAt: now - 312_000,
    endsAt: now + 588_000,
    viewers: 2_418,
    totalRewardPool: 180_000,
    stakeToken: 'SOLZ',
    teams: teamCatalog.map((team) => ({ ...team })),
    participants,
  }

  return {
    updatedAt: now,
    matches: [
      match,
      {
        id: 'human-open-sf2',
        title: 'SOLZ Human Open · Semi-final',
        subtitle: 'North Harbor vs. Carbon Six',
        format: 'human-tourney',
        phase: 'countdown',
        source: 'simulation',
        arena: 'SOLZ Matrix 01',
        startedAt: now + 780_000,
        endsAt: now + 2_280_000,
        viewers: 684,
        totalRewardPool: 24.5,
        stakeToken: 'SOL',
        teams: [
          { id: 'north-harbor', name: 'NORTH HARBOR', color: '#c8ff55' },
          { id: 'carbon-six', name: 'CARBON SIX', color: '#ff8b73' },
        ],
        participants: [],
      },
    ],
    markets: buildMarkets(match),
    account: loadAccount(),
    leaderboard: demoLeaderboard(participants),
    feed: [
      { id: 'feed-1', at: now - 7_000, kind: 'combat', text: 'KIRA-02 secured elimination 2.', actorId: 'genesis-2' },
      { id: 'feed-2', at: now - 16_000, kind: 'system', text: 'North corridor hazard is now active.' },
      { id: 'feed-3', at: now - 29_000, kind: 'prompt', text: 'Community directive reached RUNE-08.', actorId: 'genesis-8' },
    ],
    selectedMatchId: match.id,
    capabilities: {
      orders: { ready: true },
      prompts: { ready: true },
      observer: { ready: true },
    },
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds))
}

function cloneSnapshot(snapshot: ArenaSnapshot): ArenaSnapshot {
  return structuredClone(snapshot)
}

function tokenPrecision(token: SettlementToken) {
  return token === 'SOL' ? 9 : 6
}

function quoteOrder(intent: ArenaOrderIntent): ArenaOrderQuote {
  const price = Math.max(0.01, intent.outcome.probability)
  const fee = intent.amount * 0.012
  const total = intent.amount + fee
  const shares = intent.amount / price
  return {
    price,
    shares,
    fee,
    total,
    potentialPayout: shares,
    potentialProfit: shares - total,
  }
}

function promptCost(token: SettlementToken) {
  // Agent directives are intentionally material rather than chat spam; production can replace these demo prices with its signed quote.
  return token === 'SOL' ? 0.005 : 75
}

export function createDemoArenaAdapter(): ArenaAdapter {
  let snapshot = createInitialSnapshot()
  const listeners = new Set<(value: ArenaSnapshot) => void>()
  let interval: ReturnType<typeof setInterval> | null = null
  let tick = 0

  const publish = () => {
    snapshot.updatedAt = Date.now()
    snapshot.account.positions = snapshot.account.positions.map((position) => {
      const market = snapshot.markets.find((item) => item.id === position.marketId)
      const outcome = market?.outcomes.find((item) => item.id === position.outcomeId)
      const currentPrice = outcome?.probability ?? position.currentPrice
      const value = currentPrice * position.shares
      return { ...position, currentPrice, value, pnl: value - position.stake }
    })
    saveAccount(snapshot.account)
    const next = cloneSnapshot(snapshot)
    for (const listener of listeners) listener(next)
  }

  const addEvent = (event: Omit<ArenaFeedEvent, 'id' | 'at'>) => {
    snapshot.feed = [
      { ...event, id: crypto.randomUUID(), at: Date.now() },
      ...snapshot.feed,
    ].slice(0, 16)
  }

  const advance = () => {
    tick += 1
    const match = snapshot.matches[0]
    const active = match.participants.filter((player) => player.status === 'active')
    for (const player of active) {
      const drift = 3.5 + player.momentum * 2
      player.x = Math.min(94, Math.max(6, player.x + (Math.random() - 0.5) * drift))
      player.y = Math.min(94, Math.max(6, player.y + (Math.random() - 0.5) * drift))
      player.momentum = Math.max(0.1, player.momentum * 0.985)
    }

    if (tick % 3 === 0 && active.length > 1) {
      const attacker = active[Math.floor(Math.random() * active.length)]
      const targets = active.filter((player) => player.id !== attacker.id)
      const target = targets[Math.floor(Math.random() * targets.length)]
      const damage = 12 + Math.floor(Math.random() * 22)
      target.hp = Math.max(0, target.hp - damage)
      addEvent({
        kind: 'combat',
        actorId: attacker.id,
        targetId: target.id,
        text: `${attacker.name} hit ${target.name} for ${damage}.`,
      })
      if (target.hp === 0) {
        target.status = 'eliminated'
        target.deaths += 1
        attacker.kills += 1
        addEvent({
          kind: 'combat',
          actorId: attacker.id,
          targetId: target.id,
          text: `${target.name} was eliminated by ${attacker.name}.`,
        })
      }
    }

    match.viewers += Math.floor(Math.random() * 11) - 3
    snapshot.markets = buildMarkets(match, snapshot.markets)
    snapshot.leaderboard = demoLeaderboard(match.participants)
    publish()
  }

  return {
    mode: 'demo',
    minimumOrder: { SOL: 0.01, SOLZ: 25 },
    async load() {
      // Practice data is local and deterministic, so delaying first paint only exposes a misleading empty live-state shell.
      if (snapshot.matches.length === 0 || snapshot.markets.length === 0) snapshot = createInitialSnapshot()
      snapshot.account = loadAccount()
      return cloneSnapshot(snapshot)
    },
    subscribe(listener) {
      listeners.add(listener)
      if (!interval) interval = setInterval(advance, SIMULATION_STEP_MS)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && interval) {
          clearInterval(interval)
          interval = null
        }
      }
    },
    quoteOrder,
    async placeOrder(intent) {
      await wait(620)
      const minimum = intent.token === 'SOL' ? 0.01 : 25
      const quote = quoteOrder(intent)
      const balance = snapshot.account.balances[intent.token]
      if (intent.amount < minimum) throw new Error(`Minimum practice order is ${minimum} ${intent.token}.`)
      if (quote.total > balance) throw new Error(`Not enough practice ${intent.token} for this order and fee.`)
      const market = snapshot.markets.find((item) => item.id === intent.market.id)
      if (!market || market.status !== 'open') throw new Error('This practice market is no longer open.')
      const outcome = market.outcomes.find((item) => item.id === intent.outcome.id)
      if (!outcome) throw new Error('This outcome is no longer available.')

      snapshot.account.balances[intent.token] -= quote.total
      market.volume[intent.token] += intent.amount
      const impact = Math.min(0.045, intent.amount / (intent.token === 'SOL' ? 1_200 : 420_000))
      const remainingBefore = Math.max(0.001, 1 - outcome.probability)
      outcome.probability = Math.min(0.97, outcome.probability + impact)
      const remainingAfter = 1 - outcome.probability
      for (const other of market.outcomes) {
        if (other.id !== outcome.id) other.probability *= remainingAfter / remainingBefore
      }
      const filledAt = Date.now()
      // A practice fill publishes its price impact as a chart tick immediately, matching the visible order receipt.
      for (const pricedOutcome of market.outcomes) {
        pricedOutcome.priceHistory = [
          ...(pricedOutcome.priceHistory ?? []).slice(-47),
          { at: filledAt, probability: pricedOutcome.probability },
        ]
      }

      const position = {
        id: crypto.randomUUID(),
        marketId: market.id,
        marketTitle: market.title,
        outcomeId: outcome.id,
        outcomeLabel: outcome.label,
        token: intent.token,
        shares: quote.shares,
        averagePrice: quote.price,
        currentPrice: outcome.probability,
        stake: quote.total,
        value: quote.shares * outcome.probability,
        pnl: quote.shares * outcome.probability - quote.total,
        createdAt: filledAt,
      }
      snapshot.account.positions = [position, ...snapshot.account.positions]
      addEvent({ kind: 'market', text: `${outcome.label} backed with ${intent.amount.toFixed(tokenPrecision(intent.token) > 6 ? 3 : 0)} ${intent.token}.` })
      publish()

      return {
        id: crypto.randomUUID(),
        position: { ...position },
        market: structuredClone(market),
        account: cloneAccount(snapshot.account),
        status: 'filled',
      }
    },
    quotePrompt(intent) {
      return { cost: promptCost(intent.token), token: intent.token }
    },
    async sendPrompt(intent) {
      await wait(760)
      const cost = promptCost(intent.token)
      if (snapshot.account.balances[intent.token] < cost) {
        throw new Error(`Not enough practice ${intent.token} to send this directive.`)
      }
      const match = snapshot.matches.find((item) => item.id === intent.match.id)
      const player = match?.participants.find((item) => item.id === intent.participant.id)
      if (!match || !player || player.status !== 'active') {
        throw new Error('That agent is no longer available for a directive.')
      }

      snapshot.account.balances[intent.token] -= cost
      snapshot.account.promptCount += 1
      const normalized = intent.prompt.trim().toLowerCase()
      const executed = Math.random() > 0.2
      if (executed) {
        player.momentum = Math.min(1, player.momentum + 0.22)
        if (/north|up|high ground/.test(normalized)) player.y = Math.max(6, player.y - 14)
        if (/south|down|retreat/.test(normalized)) player.y = Math.min(94, player.y + 14)
        if (/west|left/.test(normalized)) player.x = Math.max(6, player.x - 14)
        if (/east|right/.test(normalized)) player.x = Math.min(94, player.x + 14)
        if (/protect|defend|heal/.test(normalized)) player.hp = Math.min(player.hpMax, player.hp + 8)
      }
      const message = executed
        ? `${player.name} accepted: “${intent.prompt.trim()}”`
        : `${player.name} ignored the directive under autonomous policy.`
      addEvent({ kind: 'prompt', actorId: player.id, text: message })
      snapshot.markets = buildMarkets(match, snapshot.markets)
      publish()

      return {
        id: crypto.randomUUID(),
        status: executed ? 'executed' : 'ignored',
        message,
        account: cloneAccount(snapshot.account),
      }
    },
    advanceSimulation: advance,
    async reset() {
      await wait(180)
      snapshot = createInitialSnapshot()
      snapshot.account = initialAccount()
      saveAccount(snapshot.account)
      tick = 0
      publish()
      return cloneSnapshot(snapshot)
    },
  }
}
