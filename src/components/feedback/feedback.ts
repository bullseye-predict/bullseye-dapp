/** PRESS FEEDBACK — one engine for the tick a control makes when you press it
 *  and the tone a result makes when it lands.
 *
 *  ONE MOUNT POINT, NOT ONE CALL PER BUTTON. Controls opt in by carrying
 *  `data-fx`, and a single delegated listener — installed once by OverlayLayer,
 *  which already owns the app's toasts — reads it. A new button gets feedback by
 *  gaining an attribute, not by importing anything, and there is exactly one
 *  place where a press becomes a tick.
 *
 *  NOTHING HERE MAY BREAK A TRADE. Audio, vibration and storage are all
 *  permission-gated or absent somewhere, so every one of them is wrapped: the
 *  worst failure this file is allowed to produce is silence.
 *
 *  THE SOUND IS SYNTHESISED, NOT SHIPPED. Four ticks as audio files would be
 *  four network requests and four licences for about 600ms of sound; WebAudio
 *  draws them from oscillators at load-time cost of nothing, and the shape of
 *  each one is readable here as numbers rather than opaque in a binary. */

/** `step` is not a quieter `success`: a first trade confirms four transactions
 *  before the order itself, and chiming five times for one trade turns the one
 *  chime that means "you are filled" into noise. Steps tick; results ring. */
export type FeedbackKind = 'select' | 'commit' | 'step' | 'success' | 'error'

export type FeedbackPrefs = { sound: boolean; haptics: boolean }

const STORAGE_KEY = 'solz:feedback'
/** Sound on by default is a product decision, so the mute has to be reachable
 *  wherever the sound is made — see the control in the trade ticket. */
const DEFAULTS: FeedbackPrefs = { sound: true, haptics: true }

/* ── PREFERENCES ─────────────────────────────────────────────────────────── */

let prefs: FeedbackPrefs | null = null
const listeners = new Set<(next: FeedbackPrefs) => void>()

function read(): FeedbackPrefs {
  if (prefs) return prefs
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<FeedbackPrefs> : null
    prefs = {
      sound: typeof parsed?.sound === 'boolean' ? parsed.sound : DEFAULTS.sound,
      haptics: typeof parsed?.haptics === 'boolean' ? parsed.haptics : DEFAULTS.haptics,
    }
  } catch {
    // Private windows and blocked storage both throw here. A preference that
    // cannot be saved is not a reason to lose the feature for the session.
    prefs = { ...DEFAULTS }
  }
  return prefs
}

export function feedbackPrefs(): FeedbackPrefs { return read() }

export function setFeedbackPrefs(next: Partial<FeedbackPrefs>): FeedbackPrefs {
  const merged = { ...read(), ...next }
  prefs = merged
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)) } catch { /* not persisted; still applied */ }
  for (const listener of listeners) listener(merged)
  return merged
}

export function subscribeFeedbackPrefs(listener: (next: FeedbackPrefs) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/* ── HAPTICS ─────────────────────────────────────────────────────────────── */

/** web-haptics carries the part navigator.vibrate cannot: iOS Safari has no
 *  Vibration API, and the library reaches the Taptic Engine through the switch
 *  control's own haptic instead. Constructed on first use — it puts an element
 *  in the document, which must not happen during server render or page load. */
type Haptics = { trigger(input?: unknown, options?: unknown): Promise<void>; cancel(): void }
let haptics: Haptics | null = null
let hapticsFailed = false

const HAPTIC: Record<FeedbackKind, string> = {
  select: 'selection',  // 8ms @ .3 — the lightest thing the library draws
  commit: 'medium',     // 25ms @ .7 — a press you meant
  step: 'light',        // 15ms @ .4 — one transaction of several landed
  success: 'success',   // two taps, rising
  error: 'error',       // three sharp taps
}

async function vibrate(kind: FeedbackKind) {
  if (hapticsFailed || !read().haptics) return
  try {
    if (!haptics) {
      const { WebHaptics } = await import('web-haptics')
      haptics = new WebHaptics() as unknown as Haptics
    }
    await haptics.trigger(HAPTIC[kind])
  } catch {
    // One failure is enough: a device without vibration will fail every time,
    // and retrying the dynamic import on every press is the expensive way to
    // learn the same thing.
    hapticsFailed = true
  }
}

/* ── SOUND ───────────────────────────────────────────────────────────────── */

/** Each voice is (start frequency, end frequency, seconds, peak gain, wave).
 *  Peaks stay under .25: loud enough to hear over a laptop fan, quiet enough
 *  that it is still the sound of a key rather than a notification. */
type Voice = { from: number; to: number; seconds: number; gain: number; wave: OscillatorType; at?: number }

const VOICES: Record<FeedbackKind, Voice[]> = {
  // A tick. Short enough that holding a key down and sliding across the pair
  // sounds like a row of detents rather than a chord.
  select: [{ from: 1180, to: 940, seconds: .028, gain: .15, wave: 'sine' }],
  // Lower and longer than select, because it commits something.
  commit: [{ from: 320, to: 560, seconds: .085, gain: .22, wave: 'triangle' }],
  // One transaction of several confirmed. Above select so it is not mistaken
  // for a press of your own, below success so it is not mistaken for the fill.
  step: [{ from: 880, to: 880, seconds: .05, gain: .12, wave: 'sine' }],
  // A rising third. Two voices rather than one glide: an interval reads as
  // "done" where a sweep reads as "working".
  success: [
    { from: 660, to: 660, seconds: .085, gain: .2, wave: 'sine' },
    { from: 990, to: 990, seconds: .16, gain: .18, wave: 'sine', at: .075 },
  ],
  // Falling and rough. Never harsh — a failed trade is already bad news and the
  // sound's job is to be noticed, not to punish.
  error: [
    { from: 300, to: 150, seconds: .22, gain: .2, wave: 'sawtooth' },
    { from: 150, to: 138, seconds: .2, gain: .11, wave: 'sine', at: .04 },
  ],
}

let audio: AudioContext | null = null
let audioFailed = false

function context(): AudioContext | null {
  if (audioFailed) return null
  try {
    if (!audio) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) { audioFailed = true; return null }
      audio = new Ctor()
    }
    // Autoplay policy suspends a context created before the first gesture, and
    // suspends it again when the tab sleeps. Resuming is idempotent.
    if (audio.state === 'suspended') void audio.resume()
    return audio
  } catch { audioFailed = true; return null }
}

function play(kind: FeedbackKind) {
  if (!read().sound) return
  const ctx = context()
  if (!ctx) return
  try {
    for (const voice of VOICES[kind]) {
      const start = ctx.currentTime + (voice.at ?? 0)
      const end = start + voice.seconds
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = voice.wave
      osc.frequency.setValueAtTime(voice.from, start)
      if (voice.to !== voice.from) osc.frequency.exponentialRampToValueAtTime(voice.to, end)
      // A gain that starts at its peak clicks. Ramp in over 4ms, then decay to
      // silence — exponentially, because linear fades sound like they stop.
      gain.gain.setValueAtTime(.0001, start)
      gain.gain.exponentialRampToValueAtTime(voice.gain, start + .004)
      gain.gain.exponentialRampToValueAtTime(.0001, end)
      osc.connect(gain).connect(ctx.destination)
      osc.start(start)
      osc.stop(end + .02)
      // Nodes are single-use; releasing them here keeps a long session from
      // accumulating one oscillator per press.
      osc.onended = () => { try { osc.disconnect(); gain.disconnect() } catch { /* already gone */ } }
    }
  } catch { /* a press that makes no sound is still a press */ }
}

/* ── THE ONE CALL ────────────────────────────────────────────────────────── */

export function feedback(kind: FeedbackKind): void {
  if (typeof window === 'undefined') return
  play(kind)
  void vibrate(kind)
}

/* ── DELEGATION ──────────────────────────────────────────────────────────── */

function kindOf(target: EventTarget | null): FeedbackKind | null {
  if (!(target instanceof Element)) return null
  const host = target.closest<HTMLElement>('[data-fx]')
  if (!host) return null
  // A disabled button gets no pointer events, but an aria-disabled one does,
  // and it is not going to do anything — so it must not sound like it will.
  if (host.matches(':disabled') || host.getAttribute('aria-disabled') === 'true') return null
  // Only press kinds are reachable from a press. `step`, `success` and `error`
  // describe what came back from the chain and are raised by notify.ts.
  const kind = host.dataset.fx
  return kind === 'select' || kind === 'commit' ? kind : null
}

let installed = false

/** Installs the one listener. Idempotent: two hosts mounting at once (a modal
 *  over a page) must not double every tick. */
export function installFeedbackDelegation(): () => void {
  if (typeof document === 'undefined' || installed) return () => {}
  installed = true

  // pointerdown, not click: a control should answer the press, the way a
  // physical key does, rather than the release.
  const onPointerDown = (event: PointerEvent) => {
    const kind = kindOf(event.target)
    if (kind) feedback(kind)
  }
  // Keyboard activation never produces a pointer event, and a trader on keys
  // deserves the same answer. Repeats are ignored: holding Enter is one press.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    const kind = kindOf(event.target)
    if (kind) feedback(kind)
  }

  document.addEventListener('pointerdown', onPointerDown, { passive: true })
  document.addEventListener('keydown', onKeyDown, { passive: true })
  return () => {
    document.removeEventListener('pointerdown', onPointerDown)
    document.removeEventListener('keydown', onKeyDown)
    installed = false
  }
}
