import type { MatchingEngine } from './matching-engine'
import { pendingSettlement, type MarketScope, type SettlementTransport } from './settlement'

export interface MatchingWorkerOptions {
  engine: MatchingEngine
  listScopes(): Promise<MarketScope[]>
  transportFor(scope: MarketScope): Promise<SettlementTransport> | SettlementTransport
  signal: AbortSignal
  intervalMs?: number
  maxNewPlansPerMarket?: number
  onError?: (error: unknown, scope?: MarketScope) => Promise<void> | void
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
    const timer = setTimeout(finish, milliseconds)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/** Separate process entry point; host supplies durable storage and actual chain transports. */
export async function runMatchingWorker(options: MatchingWorkerOptions): Promise<void> {
  const interval = options.intervalMs ?? 1000
  const limit = options.maxNewPlansPerMarket ?? 10
  if (!Number.isSafeInteger(interval) || interval < 10 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid matcher worker limits')
  while (!options.signal.aborted) {
    let scopes: MarketScope[]
    try { scopes = await options.listScopes() } catch (error) {
      if (!options.onError) throw error
      await options.onError(error)
      await delay(interval, options.signal)
      continue
    }
    for (const scope of scopes) {
      if (options.signal.aborted) break
      try {
        const transport = await options.transportFor(scope)
        const outstanding = (await options.engine.getSettlements(scope)).filter((plan) => pendingSettlement(plan.status))
        let definitiveFailure = false
        for (const plan of outstanding) {
          if (options.signal.aborted) break
          const outcome = plan.status === 'PLANNED'
            ? await options.engine.settle(scope, plan.id, transport)
            : await options.engine.reconcile(scope, plan.id, transport)
          if (outcome.status === 'FAILED') definitiveFailure = true
        }
        // A reverted pair needs fresh host/indexer state before another cycle.
        if (definitiveFailure) continue
        for (let index = 0; index < limit && !options.signal.aborted; index++) {
          const plan = await options.engine.planNext(scope)
          if (!plan) break
          const outcome = await options.engine.settle(scope, plan.id, transport)
          if (outcome.status === 'FAILED') break
        }
      } catch (error) {
        if (!options.onError) throw error
        await options.onError(error, scope)
      }
    }
    await delay(interval, options.signal)
  }
}
