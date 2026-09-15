import { Volume2, VolumeX } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { feedbackPrefs, setFeedbackPrefs, subscribeFeedbackPrefs } from './feedback'

/** The mute, in the panel that makes the sound.
 *
 *  It governs sound only, not the vibration: a speaker icon that also silenced
 *  the haptics would be lying about what it does, and on a phone the two are
 *  wanted separately more often than together — the tick in your hand is
 *  private, the tone in the room is not. Haptics are set through
 *  setFeedbackPrefs, for whatever settings surface eventually wants them. */
export function SoundToggle() {
  const on = useSyncExternalStore(
    subscribeFeedbackPrefs,
    () => feedbackPrefs().sound,
    () => true,
  )
  return (
    <button
      type="button"
      className="ch-sound-toggle"
      aria-pressed={on}
      aria-label={on ? 'Mute trade sounds' : 'Unmute trade sounds'}
      title={on ? 'Trade sounds on' : 'Trade sounds off'}
      onClick={() => setFeedbackPrefs({ sound: !on })}
    >
      {on ? <Volume2 size={13} /> : <VolumeX size={13} />}
    </button>
  )
}
