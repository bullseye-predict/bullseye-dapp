import type { MatcherState, MatcherStore } from '../../matcher/store'
import { marketScopeKey, type MarketScope } from '../../matcher/settlement'
import { decodeStored, encodeStored } from '../../../packages/prediction-core/serialization'
import { PredictionDatabase } from './database'

/** SQLite BEGIN IMMEDIATE serializes reservation changes across local worker processes. */
export class SqliteMatcherStore implements MatcherStore {
  constructor(private readonly database: PredictionDatabase) {}

  async read(scope: MarketScope): Promise<MatcherState | undefined> {
    const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM matcher_states WHERE scope = ?').get(marketScopeKey(scope))
    return row ? decodeStored<MatcherState>(row.payload) : undefined
  }

  async transaction<T>(scope: MarketScope, operation: (current: MatcherState | undefined) => { state: MatcherState; result: T }): Promise<T> {
    return this.database.transaction(() => {
      const key = marketScopeKey(scope)
      const row = this.database.sql.query<{ payload: string }, [string]>('SELECT payload FROM matcher_states WHERE scope = ?').get(key)
      const previous = row ? decodeStored<MatcherState>(row.payload) : undefined
      const { state, result } = operation(structuredClone(previous))
      this.database.sql.query('INSERT INTO matcher_states VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET payload = excluded.payload').run(key, encodeStored(state))
      for (const order of state.orders) this.database.sql.query('INSERT INTO orders VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(scope, id) DO UPDATE SET status = excluded.status, filled = excluded.filled, payload = excluded.payload').run(key, order.orderId, order.maker, order.status, order.price.toString(), order.quantity.toString(), order.filled.toString(), order.nonce.toString(), order.expiresAt, encodeStored(order))
      for (const fill of state.fills) this.database.sql.query('INSERT OR IGNORE INTO fills VALUES (?, ?, ?, ?, ?)').run(key, fill.id, fill.txHash, fill.timestamp, encodeStored(fill))
      const priorOrders = new Map(previous?.orders.map(order => [order.orderId, order]))
      for (const order of state.orders) {
        const prior = priorOrders.get(order.orderId)
        if (!prior) this.database.appendEvent(`markets:${key}`, 'ORDER_ADDED', { orderId: order.orderId, outcomeId: order.outcomeId, side: order.side, price: order.price, quantity: order.quantity })
        else if (prior.status !== order.status && order.status === 'CANCELLED') this.database.appendEvent(`markets:${key}`, 'ORDER_CANCELLED', { orderId: order.orderId })
      }
      const priorFills = new Set(previous?.fills.map(fill => fill.id))
      for (const fill of state.fills) if (!priorFills.has(fill.id)) this.database.appendEvent(`markets:${key}`, 'ORDER_FILLED', fill)
      if (previous && previous.market.status !== state.market.status) this.database.appendEvent(`markets:${key}`, `MARKET_${state.market.status}`, state.market)
      const visibleState = (value: MatcherState | undefined) => value && encodeStored({ market: value.market, orders: value.orders.map(order => [order.orderId, order.status, order.filled]), settlements: value.settlements.map(plan => [plan.id, plan.status, plan.quantity]) })
      if (visibleState(previous) !== visibleState(state)) this.database.appendEvent(`markets:${key}`, 'MARKET_STATE_CHANGED', { marketId: state.market.id })
      return structuredClone(result)
    })
  }
}
