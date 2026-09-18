import type { Client, Room } from 'colyseus.js'
import type { DirectiveCapability } from '../solz/directiveRelay'

/**
 * WHERE A DIRECTIVE'S MATCH ID COMES FROM.
 *
 * The relay will not take this site's word for which match a directive belongs
 * to. A capability is minted by the match's own spectator room, signed by the
 * game, valid for twenty seconds, and it carries the match id the game uses -
 * the on-chain id when the match has one, the source room id otherwise. The
 * market ids this site builds for its own boards (`arena-...`) are display
 * identity and are never sent.
 *
 * The room is joined at submit time and left again, rather than held open. A
 * capability that expires in twenty seconds is worthless minutes before it is
 * needed, so an idle viewer would be paying for a websocket that can only go
 * stale. One join per directive is the honest cost.
 */

const CAPABILITY_TIMEOUT_MS = 8_000

type Options = { colyseusUrl: string; sourceRoomId: string; matchId: string; timeoutMs?: number }

export async function requestDirectiveCapability({ colyseusUrl, sourceRoomId, matchId, timeoutMs = CAPABILITY_TIMEOUT_MS }: Options): Promise<DirectiveCapability> {
  if (!colyseusUrl || !sourceRoomId) throw new Error('This match is not accepting directives.')
  const { Client: Colyseus } = await import('colyseus.js')
  const client: Client = new Colyseus(colyseusUrl)
  let room: Room | null = null
  try {
    room = await client.joinOrCreate('spectator_broadcast', { sourceRoomId, matchId })
    const joined = room
    const capability = await new Promise<DirectiveCapability>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('The match did not answer in time. Try the directive again.')), timeoutMs)
      joined.onMessage('action:capability', (value: Partial<DirectiveCapability> & { unavailable?: boolean }) => {
        clearTimeout(timer)
        if (value?.unavailable || !value?.capability || !value?.matchId) {
          reject(new Error('This match is not accepting directives right now.'))
          return
        }
        resolve({
          capability: value.capability,
          matchId: value.matchId,
          sourceRoomId: String(value.sourceRoomId ?? sourceRoomId),
          endsAt: Number(value.endsAt ?? 0),
          expiresAt: Number(value.expiresAt ?? 0),
          actions: Array.isArray(value.actions) ? value.actions.map(String) : [],
        })
      })
      joined.onLeave(() => { clearTimeout(timer); reject(new Error('The match connection closed before the directive was priced.')) })
      joined.send('action:capability:request')
    })
    if (!capability.actions.includes('prompt')) throw new Error('This match is not running agent directives right now.')
    return capability
  } finally {
    if (room) await room.leave().catch(() => undefined)
  }
}

/** The arena's Colyseus origin, read from this host's own overview route. It
 *  changes only when the deployment does, so one read per page is enough. */
let cached: { at: number; url: string } | null = null
export async function arenaColyseusUrl(endpoint = '/api/solz/overview'): Promise<string> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.url
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } })
  const payload = await response.json().catch(() => null) as { colyseusUrl?: unknown } | null
  const url = typeof payload?.colyseusUrl === 'string' ? payload.colyseusUrl : ''
  if (!url) throw new Error('The SOLZ arena is unreachable, so a directive cannot be priced.')
  cached = { at: Date.now(), url }
  return url
}
