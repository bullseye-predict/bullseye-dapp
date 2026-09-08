import type { Fill, Market, Order } from '../../packages/prediction-core/types'
import type { MarketExecutionQuote } from '../../packages/prediction-core/execution'
import type { MarketExecutionRecord } from './execution'
import { marketScopeKey, type MarketScope, type PlannedSettlement } from './settlement'

export interface MatcherState {
  market: Market
  nextSequence: number
  nextSettlementSequence: number
  orders: Order[]
  settlements: PlannedSettlement[]
  fills: Fill[]
  /** Optional for backwards-compatible loading of existing limit-order matcher state. */
  executionQuotes?: MarketExecutionQuote[]
  executions?: MarketExecutionRecord[]
}

/**
 * Implementations must serialize transactions per scope across every worker, commit
 * only when operation succeeds, and return detached snapshots. A database adapter
 * should use a transaction/row lock; process-local locking alone is not durable.
 * The callback is deliberately synchronous so all reservation changes commit at once.
 */
export interface MatcherStore {
  transaction<T>(
    scope: MarketScope,
    operation: (current: MatcherState | undefined) => { state: MatcherState; result: T },
  ): Promise<T>
  read(scope: MarketScope): Promise<MatcherState | undefined>
}

/** Local development store. Production workers must inject a durable MatcherStore. */
export class InMemoryMatcherStore implements MatcherStore {
  private readonly records = new Map<string, MatcherState>()
  private readonly locks = new Map<string, Promise<void>>()

  async transaction<T>(
    scope: MarketScope,
    operation: (current: MatcherState | undefined) => { state: MatcherState; result: T },
  ): Promise<T> {
    const key = marketScopeKey(scope)
    const prior = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    this.locks.set(key, current)
    await prior
    try {
      const { state, result } = operation(structuredClone(this.records.get(key)))
      this.records.set(key, structuredClone(state))
      return structuredClone(result)
    } finally {
      release()
      if (this.locks.get(key) === current) this.locks.delete(key)
    }
  }

  async read(scope: MarketScope): Promise<MatcherState | undefined> {
    const key = marketScopeKey(scope)
    await this.locks.get(key)
    return structuredClone(this.records.get(key))
  }
}
