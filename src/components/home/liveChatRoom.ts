import type { Client, Room } from 'colyseus.js'
import type { ChatMessage } from '../solz/model'

/**
 * THE SPECTATOR CHANNEL'S ONLY CONNECTION.
 *
 * LIVE CHAT is the arena's public lobby room (`lobby_chat`, defined in
 * /Users/Shared/march-2026/_solz-colyseus/src/index.ts:174 and implemented in
 * src/rooms/LobbyRoom.ts of that repo). The room takes no admission: its
 * `onAuth` accepts every socket and only derives a hashed network key for rate
 * limiting, so this site joins as a guest and needs no wallet or account.
 *
 * One socket per tab, not one per component. The send field and the two feeds
 * that display the log all call `subscribeLiveChat`, and they share this single
 * module-level room; a second mount only adds a listener. That is also why the
 * state lives here rather than in a React context: the homepage and the event
 * page mount different trees around the same channel.
 *
 * The protocol matches the game client's own transport, kept in
 * /Users/Shared/march-2026/_reference/_solz_game/src/platform/chat/transports/ColyseusLobbyChatTransport.ts:
 *   send `chat:history:request` -> receive `chat:history` { messages }
 *   send `chat:send` { text }   -> receive `chat:new` (broadcast, including our own)
 *   receive `chat:rejected`     when the room's rate limiter refuses a message
 */

export type LiveChatStatus = 'idle' | 'connecting' | 'online' | 'offline'

export type LiveChatState = {
  status: LiveChatStatus
  /** Newest last, capped to the room's own history length. */
  messages: ChatMessage[]
  /** Why the room is offline. Empty while it is reachable. */
  error: string
  /** Lobby occupancy as the room reports it, or 0 before the first `lobby:stats`. */
  online: number
}

const ROOM_NAME = 'lobby_chat'
const MAX_TEXT_LEN = 280
const HISTORY_CAP = 120
const RETRY_MIN_MS = 4_000
const RETRY_MAX_MS = 60_000
const IDENTITY_KEY = 'solz.chat.identity.v1'

type Identity = { playerId: string; presenceId: string; name: string }

type SeatReservation = {
  room: { roomId: string; name: string; processId: string; publicAddress?: string }
  sessionId: string
  reconnectionToken?: string
  devMode?: boolean
  protocol?: string
}

/**
 * The deployed arena answers matchmaking with a FLAT seat reservation -
 * `{ name, roomId, processId, sessionId, publicAddress }` - while colyseus.js
 * 0.16 expects it nested under `room`. Calling `client.joinOrCreate` directly
 * therefore dies on `response.room.name` before a socket is ever opened.
 *
 * So the reservation is taken over HTTP and normalized before it is consumed,
 * which is what the game's own client does; see `joinOrCreateCompat` in
 * /Users/Shared/march-2026/_reference/_solz_game/src/platform/chat/transports/ColyseusLobbyChatTransport.ts.
 * Both shapes are accepted so this keeps working when the server is upgraded.
 */
function normalizeSeat(input: unknown, roomName: string): SeatReservation | null {
  if (!input || typeof input !== 'object') return null
  const data = input as Record<string, any>
  const nested = data.room && typeof data.room === 'object' ? data.room : null
  const source = nested ?? data
  if (typeof source.roomId !== 'string' || typeof source.processId !== 'string') return null
  const sessionId = typeof data.sessionId === 'string' ? data.sessionId : ''
  if (!sessionId) return null
  return {
    room: {
      roomId: source.roomId,
      processId: source.processId,
      name: typeof source.name === 'string' ? source.name : roomName,
      publicAddress: typeof source.publicAddress === 'string' ? source.publicAddress : undefined,
    },
    sessionId,
    reconnectionToken: typeof data.reconnectionToken === 'string' ? data.reconnectionToken : undefined,
    devMode: Boolean(data.devMode),
    protocol: typeof data.protocol === 'string' ? data.protocol : undefined,
  }
}

async function joinOrCreateCompat(client: Client, roomName: string, options: Record<string, unknown>): Promise<Room> {
  const http = (client as unknown as { http?: { post?: (path: string, init: { headers: Record<string, string>; body: string }) => Promise<{ data: unknown }> } }).http
  if (!http?.post) return await client.joinOrCreate(roomName, options)
  const response = await http.post(`matchmake/joinOrCreate/${roomName}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  const seat = normalizeSeat(response?.data, roomName)
  if (!seat) {
    const error = (response?.data as { error?: unknown; message?: unknown })?.message
    throw new Error(typeof error === 'string' ? error : 'The arena chat room refused the connection.')
  }
  return await client.consumeSeatReservation(seat as never)
}

function randomToken(length: number) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  const bytes = new Uint8Array(length)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
  else for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

/**
 * A guest alias, stable for this browser. The lobby room requires a presence id
 * shaped `browser_<16-96 chars>` and falls back to the session id otherwise,
 * which would give the same person a new identity on every reconnect.
 */
export function liveChatIdentity(): Identity {
  const fallback = (): Identity => {
    const token = randomToken(20)
    return { playerId: `guest-${token.slice(0, 8)}`, presenceId: `browser_${token}`, name: `guest-${token.slice(0, 4)}` }
  }
  if (typeof window === 'undefined') return fallback()
  try {
    const stored = window.localStorage.getItem(IDENTITY_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<Identity>
      if (parsed.playerId && parsed.presenceId && parsed.name) {
        return { playerId: parsed.playerId, presenceId: parsed.presenceId, name: parsed.name }
      }
    }
  } catch {
    // A blocked or corrupt store is not a reason to refuse chat.
  }
  const identity = fallback()
  try {
    window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  } catch {
    // Unstorable means a new alias next reload, which is still usable.
  }
  return identity
}

/**
 * The room's entries carry no match id: the lobby is one public channel for the
 * whole arena, not a per-match thread. They are mapped onto the site's own chat
 * shape with an empty `matchId` so a feed can tell a lobby message apart from a
 * locally simulated one and still render both with a single component.
 */
export function toChatMessage(raw: unknown, selfPlayerId: string): ChatMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.text !== 'string') return null
  const text = entry.text.trim()
  if (!text) return null
  const playerId = typeof entry.playerId === 'string' ? entry.playerId : ''
  const self = Boolean(playerId) && playerId === selfPlayerId
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : 'guest'
  return {
    id: `lobby:${entry.id}`,
    matchId: '',
    at: Number(entry.t) || Date.now(),
    author: self ? 'YOU' : name,
    kind: 'viewer',
    text,
    self,
  }
}

/** Newest last, de-duplicated by id, capped. The room replays its history on
 *  every join and reconnect, so an append has to be idempotent. */
export function mergeLiveChat(previous: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (!incoming.length) return previous
  const byId = new Map(previous.map((entry) => [entry.id, entry]))
  for (const entry of incoming) byId.set(entry.id, entry)
  return [...byId.values()].sort((left, right) => left.at - right.at).slice(-HISTORY_CAP)
}

let state: LiveChatState = { status: 'idle', messages: [], error: '', online: 0 }
const listeners = new Set<(value: LiveChatState) => void>()
let room: Room | null = null
let connecting: Promise<void> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryDelay = RETRY_MIN_MS
let identity: Identity | null = null
let endpoint = '/api/solz/overview'

function publish(next: Partial<LiveChatState>) {
  state = { ...state, ...next }
  for (const listener of listeners) listener(state)
}

/** The chat origin, read from this host's own overview route. It is a separate
 *  field from `colyseusUrl` so the public channel and the match feed can point
 *  at different deployments - see src/pages/api/solz/overview.ts. */
async function chatServerUrl(): Promise<string> {
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
  const payload = await response.json().catch(() => null) as { chatUrl?: unknown; colyseusUrl?: unknown } | null
  const url = typeof payload?.chatUrl === 'string' && payload.chatUrl
    ? payload.chatUrl
    : typeof payload?.colyseusUrl === 'string' ? payload.colyseusUrl : ''
  if (!url) throw new Error('The arena chat server is not configured.')
  return url
}

function scheduleRetry() {
  if (retryTimer || !listeners.size) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void connect()
  }, retryDelay)
  retryDelay = Math.min(RETRY_MAX_MS, retryDelay * 2)
}

async function connect() {
  if (room || connecting || typeof window === 'undefined') return
  publish({ status: 'connecting', error: '' })
  connecting = (async () => {
    try {
      const url = await chatServerUrl()
      const who = identity ?? (identity = liveChatIdentity())
      const { Client: Colyseus } = await import('colyseus.js')
      const client: Client = new Colyseus(url)
      const joined = await joinOrCreateCompat(client, ROOM_NAME, {
        playerId: who.playerId,
        name: who.name,
        presenceId: who.presenceId,
      })
      // A listener that left while the socket was opening must not be given a
      // room nobody is watching.
      if (!listeners.size) {
        await joined.leave().catch(() => undefined)
        publish({ status: 'idle' })
        return
      }
      room = joined
      retryDelay = RETRY_MIN_MS
      bind(joined, who)
      publish({ status: 'online', error: '' })
      joined.send('chat:history:request')
    } catch (reason) {
      // The browser reports a blocked origin as an opaque network failure, so
      // this cannot name CORS specifically - only that the server refused.
      publish({
        status: 'offline',
        error: reason instanceof Error ? reason.message : 'The arena chat server is unreachable.',
      })
      scheduleRetry()
    } finally {
      connecting = null
    }
  })()
  await connecting
}

function bind(joined: Room, who: Identity) {
  joined.onMessage('chat:history', (payload: { messages?: unknown }) => {
    const list = Array.isArray(payload?.messages) ? payload.messages : []
    const mapped = list.flatMap((entry) => {
      const message = toChatMessage(entry, who.playerId)
      return message ? [message] : []
    })
    publish({ messages: mergeLiveChat(state.messages, mapped) })
  })
  joined.onMessage('chat:new', (payload: unknown) => {
    const message = toChatMessage(payload, who.playerId)
    // An accepted message also ends a rate-limit warning; otherwise the
    // cooldown note stayed under the field long after the cooldown.
    if (message) publish({ messages: mergeLiveChat(state.messages, [message]), error: '' })
  })
  joined.onMessage('chat:rejected', (payload: { reason?: unknown; retryAfterMs?: unknown }) => {
    const seconds = Math.ceil((Number(payload?.retryAfterMs) || 0) / 1000)
    publish({
      error: payload?.reason === 'rate_limited'
        ? `Too many messages. Wait ${seconds || 1}s.`
        : 'The arena refused that message.',
    })
  })
  joined.onMessage('lobby:stats', (payload: { onlineUsers?: unknown }) => {
    const online = Number(payload?.onlineUsers)
    if (Number.isFinite(online)) publish({ online: Math.max(0, online) })
  })
  // The lobby also broadcasts join, leave and marketplace traffic this site has
  // no use for. Without a catch-all, colyseus.js logs a console warning for
  // every one of them.
  joined.onMessage('*', () => undefined)
  joined.onError((code, message) => publish({ error: `The arena chat room reported ${code}: ${message ?? 'an error'}.` }))
  joined.onLeave(() => {
    room = null
    publish({ status: 'offline' })
    scheduleRetry()
  })
}

/**
 * Join the channel and watch it. The first subscriber opens the socket; the
 * last one to leave closes it. The returned function must be called on unmount.
 */
export function subscribeLiveChat(listener: (value: LiveChatState) => void, overviewEndpoint?: string) {
  if (overviewEndpoint) endpoint = overviewEndpoint
  listeners.add(listener)
  listener(state)
  void connect()
  return () => {
    listeners.delete(listener)
    if (listeners.size) return
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    const open = room
    room = null
    retryDelay = RETRY_MIN_MS
    state = { ...state, status: 'idle' }
    if (open) void open.leave().catch(() => undefined)
  }
}

/**
 * Post to the channel. Returns false when the room is not connected, which is
 * the caller's signal to keep the message on this device instead of losing it.
 */
export function sendLiveChat(text: string): boolean {
  const payload = text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LEN)
  if (!payload || !room) return false
  try {
    room.send('chat:send', { text: payload })
    return true
  } catch {
    return false
  }
}
