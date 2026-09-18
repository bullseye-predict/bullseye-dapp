import { useEffect, useState } from 'react'
import type { ChatMessage } from '../solz/model'
import { subscribeLiveChat, type LiveChatState } from './liveChatRoom'

const IDLE: LiveChatState = { status: 'idle', messages: [], error: '', online: 0 }

/**
 * The arena's public chat, as React state. Every caller shares one socket - see
 * src/components/home/liveChatRoom.ts - so the send field and the feeds can all
 * call this without opening a connection each.
 */
export function useLiveChat(): LiveChatState {
  const [state, setState] = useState<LiveChatState>(IDLE)
  useEffect(() => subscribeLiveChat(setState), [])
  return state
}

/**
 * The log a feed should render: the arena's public messages and this device's
 * own ones for the match on screen, newest last.
 *
 * Both streams are kept. A lobby message carries no match id and belongs to
 * every match; a local one is scoped to its match and is all the viewer has
 * while the room is unreachable. Message kinds are the caller's business - the
 * console rail shows trade and system lines that the hero rail does not - so
 * this filters on the match alone.
 */
export function mergeMatchChat(local: ChatMessage[], remote: ChatMessage[], matchId: string): ChatMessage[] {
  const scoped = local.filter((entry) => entry.matchId === matchId)
  return [...scoped, ...remote].sort((left, right) => left.at - right.at)
}
