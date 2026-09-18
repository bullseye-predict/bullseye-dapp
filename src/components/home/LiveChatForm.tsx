import { ArrowRight } from 'lucide-react'
import { useId, useState } from 'react'
import type { SolzDataSource } from '../solz/model'
import { sendLiveChat } from './liveChatRoom'
import { useLiveChat } from './useLiveChat'

type Props = {
  source: SolzDataSource
  matchId: string
  /** Rendered under the field. The console rail and the stage corner word this differently. */
  note?: string
  autoFocus?: boolean
}

/**
 * The spectator-channel send field on its own. The homepage floats this in the
 * stage's bottom-left cutout while the message log stays in the CHAT HIGHLIGHTS
 * rail below it; the event page keeps it under the log in the console rail.
 *
 * The field stays live on every market source. Chat never touches a venue, so
 * the simulation switch has no say here. It used to gate this field, which left
 * a dead arrow button on SOLANA and SOMNIA.
 *
 * A message goes to the arena's public `lobby_chat` room when that room is
 * connected, and the room's own broadcast is what puts it in the log. When the
 * room is unreachable the message is kept on this device through the data
 * source instead, so the field never silently loses what was typed.
 */
export function LiveChatForm({ source, matchId, note, autoFocus = false }: Props) {
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string>()
  const room = useLiveChat()
  const fieldId = useId()
  const online = room.status === 'online'

  return (
    <>
      <form
        className="sh-chat-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (!message.trim()) return
          // The room echoes what it accepts, so a delivered message must not
          // also be written locally - that would show it twice.
          if (sendLiveChat(message)) {
            setMessage('')
            setError(undefined)
            return
          }
          try {
            source.sendChat(matchId, message)
            setMessage('')
            setError(undefined)
          } catch (reason) {
            // sendChat throws when the match has rotated out of the snapshot.
            setError(reason instanceof Error ? reason.message : 'Your message could not be sent.')
          }
        }}
      >
        <label className="sr-only" htmlFor={fieldId}>
          Message the spectator channel
        </label>
        <input
          id={fieldId}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Make your call…"
          maxLength={240}
          required
          autoFocus={autoFocus}
        />
        <button aria-label="Send chat message" disabled={!message.trim()}>
          <ArrowRight size={18} />
        </button>
      </form>
      {error || room.error ? (
        <p className="sh-form-note sh-form-note--error" role="alert">{error ?? room.error}</p>
      ) : (
        <p className="sh-form-note">
          {online
            ? `Arena chat${room.online ? ` · ${room.online} online` : ''}`
            : room.status === 'connecting'
              ? 'Connecting to arena chat…'
              : note}
        </p>
      )}
    </>
  )
}
