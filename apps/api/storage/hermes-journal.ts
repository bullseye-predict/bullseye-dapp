import { executionScopeKey, type ExecutionJournalState, type ExecutionScope, type HermesExecutionJournal } from '../../hermes-worker/execution-journal'
import { decodeStored, encodeStored } from '../../../packages/prediction-core/serialization'
import type { PredictionDatabase } from './database'

/** Reservations persist before signing/broadcast, including after a worker restart. */
export class SqliteHermesJournal implements HermesExecutionJournal {
  constructor(private readonly database: PredictionDatabase) {}

  async read(scope: ExecutionScope): Promise<ExecutionJournalState | undefined> {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM hermes_execution_journals WHERE scope = ?').get(executionScopeKey(scope))
    return row ? decodeStored<ExecutionJournalState>(row.payload) : undefined
  }

  async transaction<T>(scope: ExecutionScope, operation: (current: ExecutionJournalState | undefined) => { state: ExecutionJournalState; result: T }): Promise<T> {
    return this.database.transaction(() => {
      const key = executionScopeKey(scope)
      const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM hermes_execution_journals WHERE scope = ?').get(key)
      const { state, result } = operation(row ? decodeStored<ExecutionJournalState>(row.payload) : undefined)
      this.database.sql.query('INSERT INTO hermes_execution_journals VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload').run(key, encodeStored(state))
      return structuredClone(result)
    })
  }
}
