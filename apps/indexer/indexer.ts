import type { Balance, Market, Position, VenueId } from '../../packages/prediction-core/types'
import { atomic, invariant, marketKey, textField, validateMarket } from '../../packages/prediction-core/validation'
import type { PredictionDatabase } from '../api/storage/database'

export type ProjectionEvent = { id: string } & (
  | { type: 'MARKET'; value: Market }
  | { type: 'POSITION'; value: Position }
  | { type: 'BALANCE'; value: Balance }
)

export interface FinalizedBatch {
  venue: VenueId
  chainId: string
  cursor: string
  finality: 'FINALIZED'
  events: ProjectionEvent[]
}

/** RPC-specific adapters must decode their own program/contract IDs and finalized events. */
export interface ChainEventSource {
  readonly id: string
  readonly venue: VenueId
  readonly chainId: string
  readAfter(cursor: string | undefined): Promise<FinalizedBatch | undefined>
}

/** Atomic cursor + event deduplication keeps retries and worker restarts from duplicating balances. */
export class ChainIndexer {
  constructor(private readonly database: PredictionDatabase, private readonly source: ChainEventSource) {}

  async tick(): Promise<number> {
    const sourceKey = JSON.stringify([this.source.venue, this.source.chainId, this.source.id])
    const checkpoint = () => this.database.sql.query<{ cursor: string }, [string]>('SELECT cursor FROM indexer_checkpoints WHERE source = ?').get(sourceKey)?.cursor
    const before = checkpoint()
    const batch = await this.source.readAfter(before)
    if (!batch) return 0
    invariant(batch.finality === 'FINALIZED' && batch.venue === this.source.venue && batch.chainId === this.source.chainId, 'INVALID_BATCH', 'Indexer batch must belong to the configured finalized chain.')
    textField(batch.cursor, 'cursor', 2048)
    invariant(batch.cursor !== before && batch.events.length <= 10_000, 'INVALID_BATCH', 'Indexer cursor must advance and batch must be bounded.')
    return this.database.transaction(() => {
      invariant(checkpoint() === before, 'STALE_CURSOR', 'Another indexer advanced this checkpoint; fetch again.')
      let count = 0
      for (const event of batch.events) {
        textField(event.id, 'event id', 512)
        const inserted = this.database.sql.query('INSERT OR IGNORE INTO indexed_events VALUES (?, ?)').run(sourceKey, event.id)
        if (!inserted.changes) continue
        if (event.type === 'MARKET') {
          invariant(event.value.venue === batch.venue && event.value.chainId === batch.chainId, 'WRONG_CHAIN', 'Market event chain mismatch.')
          validateMarket(event.value)
          this.database.saveMarket(event.value)
          this.database.appendEvent(`markets:${marketKey(batch.venue, batch.chainId, event.value.id)}`, 'MARKET_UPDATED', event.value)
        } else if (event.type === 'POSITION') {
          const position = event.value
          invariant(position.venue === batch.venue && position.chainId === batch.chainId, 'WRONG_CHAIN', 'Position event chain mismatch.')
          atomic(position.quantity, 'quantity'); atomic(position.costBasis, 'costBasis'); atomic(position.reservedQuantity, 'reservedQuantity')
          invariant(position.reservedQuantity <= position.quantity && typeof position.realizedPnl === 'bigint', 'INVALID_POSITION', 'Invalid position accounting.')
          const market = this.database.getMarket(batch.venue, batch.chainId, position.marketId)
          invariant(market && market.outcomes.some(outcome => outcome.id === position.outcomeId), 'INVALID_POSITION', 'Position has no indexed market/outcome.')
          this.database.savePosition({ ...position, account: batch.venue === 'SOLANA' ? position.account : position.account.toLowerCase() })
        } else {
          const balance = event.value
          atomic(balance.total, 'total'); atomic(balance.available, 'available'); atomic(balance.reserved, 'reserved')
          invariant(balance.available + balance.reserved === balance.total, 'INVALID_BALANCE', 'Balance does not conserve collateral.')
          this.database.saveBalance(batch.venue, batch.chainId, { ...balance, account: batch.venue === 'SOLANA' ? balance.account : balance.account.toLowerCase() })
        }
        count++
      }
      this.database.sql.query('INSERT INTO indexer_checkpoints VALUES (?, ?) ON CONFLICT(source) DO UPDATE SET cursor = excluded.cursor').run(sourceKey, batch.cursor)
      return count
    })
  }
}
