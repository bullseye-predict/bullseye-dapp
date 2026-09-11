import { Client, Room } from 'colyseus.js'
import type { RoomBinding } from '../../packages/telemetry/normalizer'
import { invariant } from '../../packages/prediction-core/validation'

export interface SpectatorTransport {
  observe(binding: RoomBinding, event: (type: string, value: unknown) => void, signal: AbortSignal): Promise<void>
}
/** A separate SDK client per session makes cancellation close pending handshakes as well as joined rooms. */
class ObserverClient extends Client {
  room?: Room<unknown>
  constructor(url: string, private readonly signal: AbortSignal) { super(url) }
  protected override createRoom<T = unknown>(name: string): Room<T> {
    this.signal.throwIfAborted()
    const room = new Room<T>(name)
    this.room = room as Room<unknown>
    return room
  }
}

/** Only joinById is used. No gameplay send, room creation, player wallet or result signer is exposed. */
export class ColyseusSpectatorTransport implements SpectatorTransport {
  constructor(private readonly url: string, private readonly connectTimeoutMs = 10_000) {}
  async observe(binding: RoomBinding, event: (type: string, value: unknown) => void, signal: AbortSignal): Promise<void> {
    const joining = new AbortController()
    const joinSignal = AbortSignal.any([signal, joining.signal])
    const client = new ObserverClient(this.url, joinSignal)
    const post = client.http.post.bind(client.http)
    client.http.post = (path, options) => post(path, { ...options, signal: joinSignal, timeout: this.connectTimeoutMs, redirect: false })
    const timeout = setTimeout(() => joining.abort(new Error('Colyseus join timed out.')), this.connectTimeoutMs)
    const close = () => client.room?.connection?.close(1000, 'Observer session stopped')
    const onAbort = () => close()
    joinSignal.addEventListener('abort', onAbort, { once: true })
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    const onStop = () => { close(); finish() }
    signal.addEventListener('abort', onStop, { once: true })
    try {
      joinSignal.throwIfAborted()
      const id = `prediction_observer_${crypto.randomUUID().replaceAll('-', '')}`
      const join = client.joinById<unknown>(binding.roomId, {
        accountId: id, playerId: id, ...(binding.casualGuest ? { casualGuestId: id } : {}),
        spectator: true, observer: true, mode: 'spectator', joinMode: 'spectator',
      })
      // Closing a socket during its handshake does not always reject the SDK promise.
      const abort = new Promise<never>((_resolve, reject) => {
        if (joinSignal.aborted) reject(joinSignal.reason)
        else joinSignal.addEventListener('abort', () => reject(joinSignal.reason), { once: true })
      })
      const room = await Promise.race([join, abort])
      clearTimeout(timeout)
      joinSignal.removeEventListener('abort', onAbort)
      signal.throwIfAborted()
      invariant(room.roomId === binding.roomId, 'WRONG_ROOM', 'Colyseus returned a different room.')
      room.onLeave(finish)
      room.onError(() => { close(); finish() })
      const state = (value: unknown) => {
        if (value && typeof value === 'object') {
          const serializable = 'toJSON' in value && typeof value.toJSON === 'function' ? value.toJSON() as unknown : value
          event('$state', serializable)
        }
      }
      room.onStateChange(state)
      room.onMessage('*', (type: string | number, value: unknown) => { if (typeof type === 'string') event(type, value) })
      state(room.state)
      await done
    } finally {
      clearTimeout(timeout)
      joining.abort()
      joinSignal.removeEventListener('abort', onAbort)
      signal.removeEventListener('abort', onStop)
      close()
      client.room?.removeAllListeners()
    }
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}
