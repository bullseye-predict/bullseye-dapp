import { LAMPORTS_PER_SOL, PublicKey, type Connection } from '@solana/web3.js'
import { SOLZ_TOKEN_MINT } from '../solz/tokenInfo'
import type { ISolana } from '@dynamic-labs/solana-core'
import type { Client, Room } from 'colyseus.js'
import type {
  ArenaAccount,
  ArenaAdapter,
  ArenaCapability,
  ArenaFeedEvent,
  ArenaMarket,
  ArenaMatch,
  ArenaOrderIntent,
  ArenaOrderQuote,
  ArenaParticipant,
  ArenaPromptIntent,
  ArenaSnapshot,
  LeaderboardRow,
  SettlementToken,
} from './model'

const SOLZ_MINT = new PublicKey(SOLZ_TOKEN_MINT)

export type LiveArenaWalletPort = {
  address: string
  getConnection: () => Promise<Connection>
  getSigner: () => Promise<ISolana>
}

type ActivityMatch = {
  id: string
  roomId: string
  kind?: string
  mode?: string
  phase: string
  stakeAmount?: number
  stakeSymbol?: string
  configuredPlayers: number
  currentPlayers: number
  spectators: number
  startedAt: number
  createdAt: number
  totalRewardPool: number
  watchable?: boolean
}

type ActivitySnapshot = {
  generatedAt: number
  tokens?: Array<{
    symbol: string
    matches?: ActivityMatch[]
  }>
  casual?: {
    unlimited?: { matches?: ActivityMatch[] }
    survival?: { matches?: ActivityMatch[] }
  }
}

type OverviewResponse = {
  generatedAt: number
  colyseusUrl: string
  gameOrigin: string | null
  activity: ActivitySnapshot
  leaderboard?: {
    kills?: unknown
    wins?: unknown
  }
  capabilities: {
    orders: ArenaCapability
    prompts: ArenaCapability
  }
}

type RoomPlayer = {
  id: string
  name?: string
  color?: string
  teamId?: string
  x?: number
  z?: number
  hp?: number
  hpMax?: number
  kills?: number
  deaths?: number
  lifeState?: string
  observer?: boolean
  spectator?: boolean
}

type RoomMatch = {
  phase?: string
  startedAt?: number
  startsAt?: number
  endsAt?: number
  winnerId?: string
  winnerTeamId?: string
}

type RoomSnapshot = {
  roomId?: string
  players?: RoomPlayer[]
  match?: RoomMatch
}

function emptyAccount(): ArenaAccount {
  return { balances: { SOL: Number.NaN, SOLZ: Number.NaN }, positions: [], promptCount: 0 }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function playerColor(value: string | undefined, index: number) {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value
  return ['#c8ff55', '#ff8b73', '#82a9ff', '#f6d66f'][index % 4]
}

function participantFrom(player: RoomPlayer, index: number): ArenaParticipant {
  const name = String(player.name || `PLAYER-${String(index + 1).padStart(2, '0')}`).trim()
  const teamId = String(player.teamId || 'ffa')
  const hpMax = Math.max(1, Number(player.hpMax ?? 100))
  const hp = clamp(Number(player.hp ?? hpMax), 0, hpMax)
  const state = String(player.lifeState ?? '').toLowerCase()
  return {
    id: player.id,
    name,
    kind: /agent|bot|genesis/i.test(name) ? 'genesis-agent' : 'human',
    teamId,
    teamName: teamId === 'ffa' ? 'FREE AGENT' : `TEAM ${teamId.toUpperCase()}`,
    color: playerColor(player.color, index),
    kills: Math.max(0, Math.floor(Number(player.kills ?? 0))),
    deaths: Math.max(0, Math.floor(Number(player.deaths ?? 0))),
    hp,
    hpMax,
    status: state.includes('evac') ? 'evacuated' : hp <= 0 || state.includes('dead') || state.includes('defeat') ? 'eliminated' : 'active',
    // The observer panel is a normalized tactical map, never an authority for gameplay transforms.
    x: clamp(50 + Number(player.x ?? 0) * 1.7, 5, 95),
    y: clamp(50 + Number(player.z ?? 0) * 1.7, 5, 95),
    momentum: 0.5,
  }
}

function normalizedProbabilities(players: ArenaParticipant[], mode: 'winner' | 'kills' | 'first') {
  const weights = players.map((player) => {
    const alive = player.status === 'active' ? 1 : 0.01
    const weight = mode === 'winner'
      ? alive * (0.15 + player.hp / player.hpMax + player.kills * 0.4)
      : mode === 'kills'
        ? alive * (0.18 + player.kills * 0.9 + player.hp / player.hpMax * 0.2)
        : player.deaths > 0
          ? 100
          : 0.25 + (1 - player.hp / player.hpMax) * 1.5
    return { id: player.id, weight: Math.max(0.01, weight) }
  })
  const total = weights.reduce((sum, row) => sum + row.weight, 0)
  return Object.fromEntries(weights.map((row) => [row.id, row.weight / total]))
}

function withObservedHistory(market: ArenaMarket, previous: ArenaMarket | undefined, observedAt: number): ArenaMarket {
  return {
    ...market,
    outcomes: market.outcomes.map((outcome) => {
      const prior = previous?.outcomes.find((item) => item.id === outcome.id)?.priceHistory?.slice(-47) ?? []
      const last = prior.at(-1)
      if (!last || observedAt > last.at || Math.abs(last.probability - outcome.probability) >= 0.0001) {
        prior.push({ at: observedAt, probability: outcome.probability })
      }
      return { ...outcome, priceHistory: prior.slice(-48) }
    }),
  }
}

function indicativeMarkets(match: ArenaMatch, previous: ArenaMarket[] = []): ArenaMarket[] {
  if (match.participants.length < 2) return []
  const makeOutcomes = (mode: 'winner' | 'kills' | 'first') => {
    const probabilities = normalizedProbabilities(match.participants, mode)
    return match.participants.map((player) => ({
      id: player.id,
      label: player.name,
      detail: `${player.kills}K/${player.deaths}D · ${Math.round((player.hp / player.hpMax) * 100)}% HP`,
      probability: probabilities[player.id],
      participantId: player.id,
    }))
  }
  const markets: ArenaMarket[] = [
    {
      id: `${match.id}:winner`,
      matchId: match.id,
      kind: 'match-winner',
      title: `Who wins ${match.title}?`,
      description: 'Observer-derived signal from the authoritative live roster.',
      status: 'indicative',
      closesAt: match.endsAt,
      volume: { SOL: 0, SOLZ: 0 },
      outcomes: makeOutcomes('winner'),
      rules: 'This signal is read-only until the SOLZ prediction escrow authority is deployed.',
    },
    {
      id: `${match.id}:kills`,
      matchId: match.id,
      kind: 'most-kills',
      title: 'Who finishes with the most kills?',
      description: 'Live kills and HP update this indicative probability.',
      status: 'indicative',
      closesAt: match.endsAt,
      volume: { SOL: 0, SOLZ: 0 },
      outcomes: makeOutcomes('kills'),
      rules: 'Would resolve from the terminal players array; ties require an explicit split policy.',
    },
    {
      id: `${match.id}:first-down`,
      matchId: match.id,
      kind: 'first-eliminated',
      title: 'Who is eliminated first?',
      description: 'Driven only by accepted SOLZ kill events.',
      status: 'indicative',
      closesAt: match.endsAt,
      volume: { SOL: 0, SOLZ: 0 },
      outcomes: makeOutcomes('first'),
      rules: 'Would resolve from the first authoritative kill targetId, never from client animation state.',
    },
  ]
  const observedAt = Date.now()
  // Live charts retain only probabilities observed during this browser session; no synthetic history crosses the authority boundary.
  return markets.map((market) => withObservedHistory(
    market,
    previous.find((item) => item.id === market.id),
    observedAt
  ))
}

function flattenMatches(overview: OverviewResponse): ArenaMatch[] {
  const rows: Array<{ match: ActivityMatch; token: SettlementToken; type: 'agent-league' | 'human-tourney' }> = []
  for (const token of overview.activity.tokens ?? []) {
    if (token.symbol !== 'SOL' && token.symbol !== 'SOLZ') continue
    for (const match of token.matches ?? []) rows.push({ match, token: token.symbol, type: 'agent-league' })
  }
  for (const match of overview.activity.casual?.unlimited?.matches ?? []) rows.push({ match, token: 'SOLZ', type: 'human-tourney' })
  for (const match of overview.activity.casual?.survival?.matches ?? []) rows.push({ match, token: 'SOLZ', type: 'human-tourney' })

  return rows
    .filter((row) => row.match.watchable !== false)
    .map(({ match, token, type }) => ({
      id: match.roomId,
      roomId: match.roomId,
      title: type === 'agent-league' ? `SOLZ Ranked · ${match.roomId.slice(0, 8)}` : `SOLZ Live Match · ${match.roomId.slice(0, 8)}`,
      subtitle: `${match.currentPlayers}/${match.configuredPlayers} competitors · ${match.spectators} watching`,
      format: type,
      phase: match.phase === 'finished' ? 'finished' : match.phase === 'waiting' ? 'waiting' : 'live',
      source: 'colyseus',
      arena: 'SOLZ live arena',
      startedAt: match.startedAt || match.createdAt || overview.generatedAt,
      endsAt: (match.startedAt || overview.generatedAt) + 20 * 60_000,
      viewers: match.spectators,
      totalRewardPool: Number(match.totalRewardPool ?? 0),
      stakeToken: token,
      streamUrl: overview.gameOrigin ? `${overview.gameOrigin}/game/watch/${encodeURIComponent(match.roomId)}` : undefined,
      teams: [],
      participants: [],
    }))
}

function leaderboardRows(value: unknown): LeaderboardRow[] {
  if (!value || typeof value !== 'object') return []
  const rows = (value as { rows?: unknown }).rows
  if (!Array.isArray(rows)) return []
  return rows.map((item, index) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      id: String(row.playerId ?? `leader-${index}`),
      name: String(row.playerName ?? row.name ?? `PLAYER-${index + 1}`),
      wins: Number(row.rankedWins ?? row.wins ?? 0),
      kills: Number(row.rankedKills ?? row.kills ?? 0),
      deaths: Number(row.rankedDeaths ?? row.deaths ?? 0),
      matches: Number(row.rankedMatches ?? row.matches ?? 0),
      earnedSol: Number(row.paidOutSol ?? 0),
      earnedSolz: Number(row.paidOutSolz ?? row.paidOutAmount ?? 0),
    }
  })
}

async function fetchOverview(overviewUrl: string): Promise<OverviewResponse> {
  const response = await fetch(overviewUrl, { headers: { accept: 'application/json' } })
  const payload = await response.json().catch(() => ({})) as OverviewResponse & { message?: string }
  if (!response.ok) throw new Error(payload.message || 'The SOLZ live match feed is unavailable.')
  return payload
}

async function walletBalances(wallet: LiveArenaWalletPort | null): Promise<ArenaAccount> {
  if (!wallet) return emptyAccount()
  const connection = await wallet.getConnection()
  const owner = new PublicKey(wallet.address)
  const [lamports, tokenAccounts] = await Promise.all([
    connection.getBalance(owner, 'confirmed'),
    connection.getParsedTokenAccountsByOwner(owner, { mint: SOLZ_MINT }, 'confirmed'),
  ])
  const solz = tokenAccounts.value.reduce((sum, tokenAccount) => {
    const info = tokenAccount.account.data.parsed.info as { tokenAmount?: { uiAmountString?: string } }
    return sum + Number(info.tokenAmount?.uiAmountString ?? 0)
  }, 0)
  return { balances: { SOL: lamports / LAMPORTS_PER_SOL, SOLZ: solz }, positions: [], promptCount: 0 }
}

function quoteOrder(intent: ArenaOrderIntent): ArenaOrderQuote {
  const price = Math.max(0.01, intent.outcome.probability)
  const shares = intent.amount / price
  return { price, shares, fee: 0, total: intent.amount, potentialPayout: shares, potentialProfit: shares - intent.amount }
}

function promptCost(token: SettlementToken) {
  return token === 'SOL' ? 0.005 : 75
}

export function createLiveArenaAdapter(
  wallet: LiveArenaWalletPort | null,
  { overviewUrl = '/api/solz/overview' }: { overviewUrl?: string } = {},
): ArenaAdapter {
  let snapshot: ArenaSnapshot = {
    updatedAt: Date.now(),
    matches: [],
    markets: [],
    account: emptyAccount(),
    leaderboard: [],
    feed: [],
    capabilities: {
      orders: { ready: false, reason: 'Live prediction authority is not configured.' },
      prompts: { ready: false, reason: 'Live agent directives are not configured.' },
      observer: { ready: false, reason: 'Waiting for the SOLZ activity feed.' },
    },
  }
  let overview: OverviewResponse | null = null
  let room: Room | null = null
  const listeners = new Set<(value: ArenaSnapshot) => void>()

  const publish = () => {
    snapshot.updatedAt = Date.now()
    const next = structuredClone(snapshot)
    for (const listener of listeners) listener(next)
  }

  const addEvent = (event: Omit<ArenaFeedEvent, 'id' | 'at'> & { id?: string; at?: number }) => {
    snapshot.feed = [{ ...event, id: event.id || crypto.randomUUID(), at: event.at || Date.now() }, ...snapshot.feed].slice(0, 20)
  }

  const rebuildForPlayers = (players: RoomPlayer[], matchState?: RoomMatch) => {
    const activeMatch = snapshot.matches[0]
    if (!activeMatch) return
    activeMatch.participants = players
      .filter((player) => !player.observer && !player.spectator)
      .map(participantFrom)
    activeMatch.teams = Array.from(new Map(activeMatch.participants.map((player) => [player.teamId, {
      id: player.teamId,
      name: player.teamName,
      color: player.color,
    }])).values())
    if (matchState?.startedAt || matchState?.startsAt) activeMatch.startedAt = Number(matchState.startedAt ?? matchState.startsAt)
    if (matchState?.endsAt) activeMatch.endsAt = Number(matchState.endsAt)
    if (matchState?.phase) activeMatch.phase = matchState.phase === 'finished' ? 'finished' : matchState.phase === 'waiting' ? 'waiting' : 'live'
    snapshot.markets = indicativeMarkets(activeMatch, snapshot.markets)
    publish()
  }

  const connectObserver = async () => {
    const activeMatch = snapshot.matches[0]
    if (!overview || !activeMatch?.roomId || room) return
    try {
      const { Client } = await import('colyseus.js')
      const client: Client = new Client(overview.colyseusUrl)
      const watchId = `prediction_watch_${crypto.randomUUID().replaceAll('-', '').slice(0, 18)}`
      const casual = activeMatch.format === 'human-tourney'
      room = await client.joinById(activeMatch.roomId, {
        accountId: watchId,
        playerId: watchId,
        casualGuestId: casual ? watchId : undefined,
        spectator: true,
        observer: true,
        mode: 'spectator',
        joinMode: 'spectator',
      })
      snapshot.capabilities.observer = { ready: true }
      addEvent({ kind: 'system', text: `Observer linked to room ${activeMatch.roomId.slice(0, 8)}.` })

      room.onMessage('snapshot', (value: RoomSnapshot) => rebuildForPlayers(value.players ?? [], value.match))
      room.onMessage('player:update', (value: RoomPlayer) => {
        const match = snapshot.matches[0]
        if (!match) return
        const current: RoomPlayer[] = match.participants.map((player) => ({
          id: player.id,
          name: player.name,
          color: player.color,
          teamId: player.teamId,
          x: (player.x - 50) / 1.7,
          z: (player.y - 50) / 1.7,
          hp: player.hp,
          hpMax: player.hpMax,
          kills: player.kills,
          deaths: player.deaths,
          lifeState: player.status,
        }))
        const index = current.findIndex((player) => player.id === value.id)
        if (index >= 0) current[index] = { ...current[index], ...value }
        else current.push(value)
        rebuildForPlayers(current)
      })
      room.onMessage('player:join', (value: RoomPlayer) => {
        const current: RoomPlayer[] = snapshot.matches[0]?.participants.map((player) => ({ ...player, z: player.y })) ?? []
        rebuildForPlayers([...current, value])
      })
      room.onMessage('match:update', (value: RoomMatch) => rebuildForPlayers(snapshot.matches[0]?.participants.map((player) => ({ ...player, z: player.y })) ?? [], value))
      room.onMessage('match:feed', (value: { id?: string; t?: number; kind?: string; text?: string; actorId?: string; targetId?: string }) => {
        addEvent({
          id: value.id,
          at: value.t,
          kind: value.kind === 'kill' || value.kind === 'damage' ? 'combat' : 'system',
          text: String(value.text || value.kind || 'SOLZ match event'),
          actorId: value.actorId,
          targetId: value.targetId,
        })
        publish()
      })
      room.onMessage('match:result', (value: { players?: RoomPlayer[] }) => {
        if (snapshot.matches[0]) snapshot.matches[0].phase = 'finished'
        if (value.players) rebuildForPlayers(value.players, { phase: 'finished' })
        else publish()
      })
      room.onLeave(() => {
        room = null
        snapshot.capabilities.observer = { ready: false, reason: 'The match observer disconnected.' }
        publish()
      })
      publish()
    } catch (error) {
      snapshot.capabilities.observer = {
        ready: false,
        reason: error instanceof Error ? error.message : 'Could not join the SOLZ room as an observer.',
      }
      addEvent({ kind: 'system', text: 'Room summary is live, but the detailed spectator feed could not connect.' })
      publish()
    }
  }

  return {
    mode: 'live',
    minimumOrder: { SOL: 0.01, SOLZ: 25 },
    async load() {
      const [overviewResult, accountResult] = await Promise.allSettled([
        fetchOverview(overviewUrl),
        walletBalances(wallet),
      ])
      if (overviewResult.status === 'rejected') {
        const reason = overviewResult.reason instanceof Error
          ? overviewResult.reason.message
          : 'The SOLZ live match source is unavailable.'
        snapshot = {
          ...snapshot,
          updatedAt: Date.now(),
          account: accountResult.status === 'fulfilled' ? accountResult.value : emptyAccount(),
          feed: [{ id: crypto.randomUUID(), at: Date.now(), kind: 'system', text: reason }],
          capabilities: {
            orders: { ready: false, reason: 'The SOLZ prediction escrow program is not deployed yet. Live orders stay locked.' },
            prompts: { ready: false, reason: 'The paid agent-directive relay is not connected yet. Live prompts stay locked.' },
            observer: { ready: false, reason },
          },
        }
        return structuredClone(snapshot)
      }
      overview = overviewResult.value
      const matches = flattenMatches(overview)
      const leaders = [
        ...leaderboardRows(overview.leaderboard?.wins),
        ...leaderboardRows(overview.leaderboard?.kills),
      ]
      snapshot = {
        updatedAt: overview.generatedAt,
        matches,
        markets: [],
        account: accountResult.status === 'fulfilled' ? accountResult.value : emptyAccount(),
        leaderboard: Array.from(new Map(leaders.map((row) => [row.id, row])).values()),
        feed: matches.length > 0
          ? [{ id: crypto.randomUUID(), at: Date.now(), kind: 'system', text: `${matches.length} watchable SOLZ match${matches.length === 1 ? '' : 'es'} found.` }]
          : [{ id: crypto.randomUUID(), at: Date.now(), kind: 'system', text: 'No SOLZ matches are live in this region right now.' }],
        selectedMatchId: matches[0]?.id,
        capabilities: {
          orders: overview.capabilities.orders,
          prompts: overview.capabilities.prompts,
          observer: matches.length > 0 ? { ready: false, reason: 'Connecting to the selected match…' } : { ready: false, reason: 'No watchable match is live.' },
        },
      }
      queueMicrotask(() => void connectObserver())
      return structuredClone(snapshot)
    },
    subscribe(listener) {
      listeners.add(listener)
      void connectObserver()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && room) {
          const leaving = room
          room = null
          void leaving.leave()
        }
      }
    },
    quoteOrder,
    async placeOrder() {
      throw new Error(snapshot.capabilities.orders.reason || 'Live SOLZ prediction orders are not available.')
    },
    quotePrompt(intent: ArenaPromptIntent) {
      return { cost: promptCost(intent.token), token: intent.token }
    },
    async sendPrompt() {
      throw new Error(snapshot.capabilities.prompts.reason || 'Live agent directives are not available.')
    },
  }
}
