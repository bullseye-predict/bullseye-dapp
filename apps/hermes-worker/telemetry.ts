import { PRICE_SCALE, type MatchTelemetry, type OrderBook } from '../../packages/prediction-core/types'

export type ReasoningTrigger = 'INITIAL' | 'KILL' | 'SCORE' | 'OBJECTIVE' | 'ELIMINATION' | 'HP_SWING' | 'PRICE_MOVE' | 'TIMER_THRESHOLD'
export interface EventFilterOptions {
  minimumIntervalMs?: number
  hpChangeFraction?: number
  priceChange?: bigint
  timerThresholdsMs?: number[]
}

function midpoint(book: OrderBook, outcomeId: number): bigint | undefined {
  const outcome = book.outcomes.find((entry) => entry.outcomeId === outcomeId)
  const bid = outcome?.bids[0]?.price
  const ask = outcome?.asks[0]?.price
  return bid !== undefined && ask !== undefined ? (bid + ask) / 2n : outcome?.lastTradePrice ?? bid ?? ask
}
function changed(a: Record<string, number>, b: Record<string, number>): boolean {
  return new Set([...Object.keys(a), ...Object.keys(b)]).size > 0 &&
    [...new Set([...Object.keys(a), ...Object.keys(b)])].some((key) => a[key] !== b[key])
}

/** Baselines advance only on reasoning triggers, so small cumulative changes count. */
export class HermesEventFilter {
  private previous?: { telemetry: MatchTelemetry; book: OrderBook; at: number }
  private readonly minimumIntervalMs: number
  private readonly hpChangeFraction: number
  private readonly priceChange: bigint
  private readonly timerThresholdsMs: readonly number[]

  constructor(options: EventFilterOptions = {}) {
    this.minimumIntervalMs = options.minimumIntervalMs ?? 1000
    this.hpChangeFraction = options.hpChangeFraction ?? 0.15
    this.priceChange = options.priceChange ?? 30_000n
    this.timerThresholdsMs = Object.freeze([...(options.timerThresholdsMs ?? [120_000, 60_000, 30_000, 10_000])])
    if (!Number.isSafeInteger(this.minimumIntervalMs) || this.minimumIntervalMs < 0 || !Number.isFinite(this.hpChangeFraction) ||
      this.hpChangeFraction <= 0 || this.hpChangeFraction > 1 || this.priceChange <= 0n || this.priceChange > PRICE_SCALE ||
      this.timerThresholdsMs.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid Hermes event thresholds')
  }

  observe(telemetry: MatchTelemetry, book: OrderBook, now: number): ReasoningTrigger[] {
    const prior = this.previous
    if (prior && (prior.telemetry.matchId !== telemetry.matchId || prior.book.marketId !== book.marketId || prior.book.venue !== book.venue || prior.book.chainId !== book.chainId)) {
      throw new Error('Event filter cannot change match or venue')
    }
    if (prior && (now < prior.at || telemetry.sequence < prior.telemetry.sequence || telemetry.timestamp < prior.telemetry.timestamp)) return []
    const triggers: ReasoningTrigger[] = []
    if (!prior) triggers.push('INITIAL')
    else {
      if (now - prior.at < this.minimumIntervalMs) return []
      const kills = new Set(prior.telemetry.kills.map((kill) => kill.id))
      if (telemetry.kills.some((kill) => !kills.has(kill.id))) triggers.push('KILL')
      if (changed(prior.telemetry.score, telemetry.score)) triggers.push('SCORE')
      if (changed(prior.telemetry.objectives, telemetry.objectives)) triggers.push('OBJECTIVE')
      for (const participant of telemetry.participants) {
        const before = prior.telemetry.participants.find((entry) => entry.id === participant.id)
        if (!before) continue
        if (before.alive && !participant.alive) triggers.push('ELIMINATION')
        if (participant.maxHp > 0 && before.maxHp > 0 && Math.abs(participant.hp / participant.maxHp - before.hp / before.maxHp) >= this.hpChangeFraction) triggers.push('HP_SWING')
      }
      for (const outcome of book.outcomes) {
        const current = midpoint(book, outcome.outcomeId)
        const before = midpoint(prior.book, outcome.outcomeId)
        if (current !== undefined && before !== undefined && (current > before ? current - before : before - current) >= this.priceChange) triggers.push('PRICE_MOVE')
      }
      if (this.timerThresholdsMs.some((threshold) => prior.telemetry.remainingMs > threshold && telemetry.remainingMs <= threshold)) triggers.push('TIMER_THRESHOLD')
    }
    if (triggers.length) this.previous = { telemetry: structuredClone(telemetry), book: structuredClone(book), at: now }
    return [...new Set(triggers)]
  }
}
