import type { PlaceOrderInput, VenueId } from '../../packages/prediction-core/types'

export interface ExecutionScope { account: string; venue: VenueId; chainId: string }
export interface PendingExecution {
  id: string
  input: PlaceOrderInput
  createdAt: number
  status: 'SUBMITTING' | 'ACCEPTED' | 'UNKNOWN'
  orderId?: string
}
export interface ExecutionJournalState {
  revision: number
  enabled: boolean
  nextSequence: number
  entries: PendingExecution[]
}

/** Persist before any external order mutation; serialize per account across workers. */
export interface HermesExecutionJournal {
  read(scope: ExecutionScope): Promise<ExecutionJournalState | undefined>
  transaction<T>(scope: ExecutionScope, operation: (state: ExecutionJournalState | undefined) =>
    { state: ExecutionJournalState; result: T }): Promise<T>
}

export const emptyExecutionState = (): ExecutionJournalState => ({ revision: 0, enabled: true, nextSequence: 1, entries: [] })
export const executionScopeKey = (scope: ExecutionScope): string =>
  JSON.stringify([scope.venue, scope.chainId, scope.venue === 'SOLANA' ? scope.account : scope.account.toLowerCase()])

/** For local development only; a live worker must inject a durable journal. */
export class InMemoryExecutionJournal implements HermesExecutionJournal {
  private readonly records = new Map<string, ExecutionJournalState>()
  private readonly locks = new Map<string, Promise<void>>()

  async read(scope: ExecutionScope): Promise<ExecutionJournalState | undefined> {
    const key = executionScopeKey(scope)
    await this.locks.get(key)
    return structuredClone(this.records.get(key))
  }

  async transaction<T>(scope: ExecutionScope, operation: (state: ExecutionJournalState | undefined) =>
    { state: ExecutionJournalState; result: T }): Promise<T> {
    const key = executionScopeKey(scope)
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    this.locks.set(key, held)
    await previous
    try {
      const result = operation(structuredClone(this.records.get(key)))
      this.records.set(key, structuredClone(result.state))
      return structuredClone(result.result)
    } finally {
      release()
      if (this.locks.get(key) === held) this.locks.delete(key)
    }
  }
}

/**
 * Only the trusted chain indexer calls this after the final order outcome AND its
 * portfolio effect are reflected in the account snapshot. Mere broadcast success,
 * absence from the open-order endpoint, or a model claim is not a sufficient proof.
 */
export async function releaseIndexedExecution(journal: HermesExecutionJournal, scope: ExecutionScope, executionId: string): Promise<void> {
  await journal.transaction(scope, (existing) => {
    const state = existing ?? emptyExecutionState()
    const index = state.entries.findIndex((entry) => entry.id === executionId)
    if (index < 0) throw new Error('Unknown execution reservation')
    state.entries.splice(index, 1)
    state.revision += 1
    return { state, result: undefined }
  })
}
