import { describe, expect, test } from 'bun:test'
import { mergeLiveChat, toChatMessage } from '../src/components/home/liveChatRoom'
import { mergeMatchChat } from '../src/components/home/useLiveChat'
import type { ChatMessage } from '../src/components/solz/model'

/** One entry exactly as the deployed arena broadcast it on `chat:new`. */
const LOBBY_ENTRY = {
  id: 'mu6cxojh-mn974s',
  t: 1789699604093,
  playerId: 'guest-probe01',
  name: 'guest-prob',
  identityKind: 'guest',
  label: 'Guest',
  text: 'solz-prediction-market connectivity check',
}

const local = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'chat-1', matchId: 'arena-room-404', at: 2_000, author: 'YOU', kind: 'viewer', text: 'local line', self: true, ...over,
})

describe('arena lobby chat', () => {
  test('maps a room entry onto the site chat shape and marks our own', () => {
    const mine = toChatMessage(LOBBY_ENTRY, 'guest-probe01')
    expect(mine).toEqual({
      id: 'lobby:mu6cxojh-mn974s',
      matchId: '',
      at: 1789699604093,
      author: 'YOU',
      kind: 'viewer',
      text: 'solz-prediction-market connectivity check',
      self: true,
    })
    const theirs = toChatMessage(LOBBY_ENTRY, 'guest-someone-else')
    expect(theirs?.author).toBe('guest-prob')
    expect(theirs?.self).toBe(false)
  })

  test('refuses an entry that is not a message', () => {
    expect(toChatMessage(null, 'me')).toBeNull()
    expect(toChatMessage({ id: 'a' }, 'me')).toBeNull()
    expect(toChatMessage({ id: 'a', text: '   ' }, 'me')).toBeNull()
  })

  test('replaying the history does not duplicate a message', () => {
    const first = toChatMessage(LOBBY_ENTRY, 'me')!
    const again = toChatMessage(LOBBY_ENTRY, 'me')!
    const merged = mergeLiveChat(mergeLiveChat([], [first]), [again])
    expect(merged).toHaveLength(1)
  })

  test('orders the room and this device into one log', () => {
    const remote = toChatMessage({ ...LOBBY_ENTRY, id: 'r1', t: 1_000 }, 'me')!
    const merged = mergeMatchChat([local(), local({ id: 'chat-2', matchId: 'other-match', at: 3_000 })], [remote], 'arena-room-404')
    // The other match's line is dropped; the lobby line has no match and stays.
    expect(merged.map((entry) => entry.id)).toEqual(['lobby:r1', 'chat-1'])
  })

  test('keeps every local kind, because the console rail shows trade lines', () => {
    const merged = mergeMatchChat([local({ id: 'chat-3', kind: 'trade', self: false, at: 4_000 })], [], 'arena-room-404')
    expect(merged.map((entry) => entry.kind)).toEqual(['trade'])
  })
})
