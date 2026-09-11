import type { SignedMatchResult } from '../../packages/prediction-core/types'
import { invariant, marketKey, PredictionError, record } from '../../packages/prediction-core/validation'
import { RoomTelemetryNormalizer, type RoomBinding } from '../../packages/telemetry/normalizer'
import { PredictionPublisher, PublishError } from '../../packages/telemetry/publisher'
import { sleep, type SpectatorTransport } from './colyseus'
import type { TelemetryWorkerConfig } from './config'
import { TelemetryWorkerStore } from './store'

export interface WorkerDependencies {
  store: TelemetryWorkerStore
  publisher: PredictionPublisher
  transport: SpectatorTransport
  parseResult?: (input: unknown) => SignedMatchResult
  verifyResult?: (result: SignedMatchResult) => Promise<boolean>
  fetch?: typeof fetch
  now?: () => number
  random?: () => number
  log?: (event: string, details: Record<string, unknown>) => void
}

/** Only already-configured rooms can become eligible; discovery never invents a market mapping. */
export function discoverBoundRooms(input: unknown, bindings: RoomBinding[]): Set<string> {
  const snapshot = record(input)
  const matches: unknown[] = []
  const collect = (value: unknown) => {
    if (value === undefined) return
    invariant(Array.isArray(value) && value.length <= 1000, 'INVALID_ACTIVITY', 'Invalid activity match list.')
    matches.push(...value)
  }
  collect(snapshot.matches)
  if (snapshot.tokens !== undefined) {
    invariant(Array.isArray(snapshot.tokens) && snapshot.tokens.length <= 1000, 'INVALID_ACTIVITY', 'Invalid activity token list.')
    for (const token of snapshot.tokens) collect(record(token).matches)
  }
  if (snapshot.casual !== undefined) {
    const casual = record(snapshot.casual)
    for (const mode of ['unlimited', 'survival']) if (casual[mode] !== undefined) collect(record(casual[mode]).matches)
  }
  invariant(matches.length <= 5000, 'INVALID_ACTIVITY', 'Activity response is too large.')
  const eligible = new Set<string>()
  for (const value of matches) {
    const row = record(value)
    const binding = bindings.find(binding => binding.roomId === row.roomId)
    if (binding && row.watchable !== false && (row.id === undefined || row.id === binding.sourceMatchId)) eligible.add(binding.roomId)
  }
  return eligible
}

export class TelemetryObserverWorker {
  private readonly abort = new AbortController()
  private readonly now: () => number
  private eligible: Set<string>
  private readonly sessions = new Map<string, AbortController>()
  private readonly reports = new Map<string, number>()
  private tasks: Promise<void>[] = []
  private readonly resultTasks = new Set<Promise<void>>()
  private readonly resultTails = new Map<string, Promise<void>>()
  private started = false
  constructor(readonly config: TelemetryWorkerConfig, private readonly dependencies: WorkerDependencies) {
    this.now = dependencies.now ?? Date.now
    this.eligible = new Set(config.activityUrl ? [] : config.rooms.map(room => room.roomId))
    invariant(!config.rooms.some(room => room.resultMarkets.length) || (dependencies.parseResult && dependencies.verifyResult), 'INVALID_CONFIG', 'Signed-result parser and authority verifier are required.')
  }
  start() {
    invariant(!this.started, 'ALREADY_STARTED', 'Telemetry worker has already started.')
    this.started = true
    this.tasks = [this.publish(), ...this.config.rooms.map(room => this.observe(room))]
    if (this.config.activityUrl) this.tasks.push(this.discover())
  }
  async stop() {
    this.abort.abort()
    for (const session of this.sessions.values()) session.abort()
    await Promise.allSettled([...this.tasks, ...this.resultTasks])
  }
  private report(event: string, error: unknown, roomId?: string) {
    const code = error instanceof PredictionError || error instanceof PublishError ? error.code : 'TRANSPORT_ERROR'
    const key = `${event}:${roomId ?? ''}:${code}`, time = this.now()
    if (time - (this.reports.get(key) ?? -Infinity) < 15_000) return
    this.reports.set(key, time)
    // Do not log raw messages, signed bodies, URLs with query data, or secrets.
    this.dependencies.log?.(event, { code, ...(roomId ? { roomId } : {}) })
  }
  private backoff(attempt: number) {
    const base = Math.min(this.config.reconnectMaxMs, this.config.reconnectMinMs * 2 ** Math.max(0, Math.min(attempt, 20)))
    return Math.round(base * (0.8 + (this.dependencies.random ?? Math.random)() * 0.2))
  }
  private async observe(binding: RoomBinding) {
    let failures = 0
    const signal = this.abort.signal
    while (!signal.aborted) {
      if (!this.eligible.has(binding.roomId)) { await sleep(this.config.discoveryIntervalMs, signal); continue }
      const controller = new AbortController()
      const sessionSignal = AbortSignal.any([signal, controller.signal])
      this.sessions.set(binding.roomId, controller)
      const started = this.now()
      try {
        // Reconcile before connecting after restart; failures prevent publishing against an unknown cursor.
        const latest = await this.dependencies.publisher.latest(binding.matchId, sessionSignal)
        if (latest) {
          invariant(latest.matchId === binding.matchId, 'WRONG_MATCH', 'The prediction API returned a different match.')
          this.dependencies.store.reconcile(latest)
        }
        const normalizer = new RoomTelemetryNormalizer(binding, this.dependencies.store.cursor(binding.matchId))
        await this.dependencies.transport.observe(binding, (type, value) => {
          if (sessionSignal.aborted) return
          if (type === binding.schema.resultMessage) { this.acceptResult(binding, value); return }
          try {
            const normalized = normalizer.accept(type, value)
            if (!normalized) return
            const age = this.now() - normalized.telemetry.timestamp
            invariant(age >= -2000 && age <= this.config.sourceMaxAgeMs, 'STALE_TELEMETRY', 'Source telemetry is stale or in the future.')
            this.dependencies.store.enqueue(normalized)
          } catch (error) { this.report('telemetry_rejected', error, binding.roomId) }
        }, sessionSignal)
      } catch (error) { if (!sessionSignal.aborted) this.report('observer_disconnected', error, binding.roomId) }
      finally { this.sessions.delete(binding.roomId); controller.abort() }
      failures = this.now() - started > 30_000 ? 0 : failures + 1
      await sleep(this.backoff(failures - 1), signal)
    }
  }
  private acceptResult(binding: RoomBinding, input: unknown) {
    if (!binding.resultMarkets.length) return
    let result: SignedMatchResult
    try {
      invariant(this.resultTasks.size < 128, 'RESULT_BACKPRESSURE', 'Result verification queue is full; the authority publisher must retry.')
      result = this.dependencies.parseResult!(input)
      invariant(result.matchId === binding.matchId && binding.resultMarkets.some(market => market.venue === result.venue && market.chainId === result.chainId && market.marketId === result.marketId), 'WRONG_RESULT_MARKET', 'The signed result is not allowed for this observer binding.')
    } catch (error) { this.report('result_rejected', error, binding.roomId); return }
    const key = marketKey(result.venue, result.chainId, result.marketId)
    const previous = this.resultTails.get(key) ?? Promise.resolve()
    const task = previous.then(async () => {
      try {
        if (this.abort.signal.aborted) return
        invariant(result.winningOutcomeId >= 0 && result.winningOutcomeId < binding.outcomes.length && result.matchEndedAt <= this.now() && result.expiresAt > this.now(), 'INVALID_RESULT', 'The result is stale or references an invalid outcome.')
        invariant(await this.dependencies.verifyResult!(result), 'INVALID_RESULT_SIGNATURE', 'Result authority verification failed.')
        if (!this.abort.signal.aborted) this.dependencies.store.enqueueResult(result)
      } catch (error) { this.report('result_rejected', error, binding.roomId) }
    })
    this.resultTails.set(key, task)
    this.resultTasks.add(task)
    void task.finally(() => {
      this.resultTasks.delete(task)
      if (this.resultTails.get(key) === task) this.resultTails.delete(key)
    })
  }
  private async discover() {
    const signal = this.abort.signal
    while (!signal.aborted) {
      try {
        const response = await (this.dependencies.fetch ?? fetch)(this.config.activityUrl!, { signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.connectTimeoutMs)]), redirect: 'error' })
        invariant(response.ok, 'ACTIVITY_UNAVAILABLE', 'Game activity endpoint is unavailable.')
        const body = await response.text()
        invariant(Buffer.byteLength(body) <= 1024 * 1024, 'INVALID_ACTIVITY', 'Activity response is too large.')
        this.eligible = discoverBoundRooms(JSON.parse(body), this.config.rooms)
        for (const [room, controller] of this.sessions) if (!this.eligible.has(room)) controller.abort()
      } catch (error) { if (!signal.aborted) this.report('discovery_failed', error) }
      await sleep(this.config.discoveryIntervalMs, signal)
    }
  }
  private async publish() {
    const signal = this.abort.signal
    let failures = 0
    while (!signal.aborted) {
      let failed = false
      for (const row of this.dependencies.store.pending()) {
        if (signal.aborted) break
        if (this.now() - row.timestamp > this.config.sourceMaxAgeMs) { this.dependencies.store.ack(row); continue }
        try { await this.dependencies.publisher.telemetry(row.body, signal); this.dependencies.store.ack(row) }
        catch (error) {
          if (signal.aborted) break
          if (error instanceof PublishError && error.code === 'REPLAYED_TELEMETRY') {
            try {
              const latest = await this.dependencies.publisher.latest(row.matchId, signal)
              invariant(latest?.matchId === row.matchId, 'MISSING_TELEMETRY', 'Could not reconcile the rejected snapshot.')
              this.dependencies.store.reconcile(latest)
            } catch (failure) { this.report('telemetry_reconcile_failed', failure); failed = true }
          } else if (error instanceof PublishError && error.code === 'STALE_TELEMETRY') this.dependencies.store.ack(row)
          else { this.report('telemetry_publish_failed', error); failed = true }
        }
      }
      for (const row of this.dependencies.store.results()) {
        if (signal.aborted) break
        if (row.expiresAt <= this.now()) { this.dependencies.store.finishResult(row.key, 'RESULT_EXPIRED'); this.report('result_expired', new PredictionError('RESULT_EXPIRED', 'Expired')); continue }
        try { await this.dependencies.publisher.result(row.body, signal); this.dependencies.store.finishResult(row.key) }
        catch (error) { if (!signal.aborted) { this.report('result_publish_failed', error); failed = true } }
      }
      failures = failed ? failures + 1 : 0
      await sleep(failed ? this.backoff(failures - 1) : this.config.publishIntervalMs, signal)
    }
  }
}
