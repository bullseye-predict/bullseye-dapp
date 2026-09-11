import { describe, expect, test } from 'bun:test'
import { RiskEngine, parseHermesAction } from '../../packages/risk-engine'
import { NOW, balance, book, market, order, policy, position, snapshot, telemetry, tradeAction } from './fixtures'

describe('Hermes structured action and immutable risk gates', () => {
  test('parses only explicit actions and exact atomic integers', () => {
    expect(parseHermesAction({ ...tradeAction(), limitPrice: '500000', amount: '10000000' })).toEqual(tradeAction())
    expect(parseHermesAction(JSON.stringify({ action: 'HOLD', reason: 'No edge' }))).toEqual({ action: 'HOLD', reason: 'No edge' })
    for (const output of [
      { ...tradeAction(), amount: Number.MAX_SAFE_INTEGER + 1 },
      { ...tradeAction(), amount: 10.5 }, { ...tradeAction(), amount: '-1' }, { ...tradeAction(), limitPrice: '1e5' },
      { ...tradeAction(), confidence: NaN }, { ...tradeAction(), estimatedProbability: Infinity },
      { ...tradeAction(), outcomeId: 1.2 }, { ...tradeAction(), expiresAt: 'forever' },
      { ...tradeAction(), action: 'WITHDRAW' }, { ...tradeAction(), risk: { totalCapital: '999999999999' } },
      { ...tradeAction(), account: 'Mallory' }, { ...tradeAction(), marketId: 'elsewhere' },
      { action: 'CANCEL_ALL', reason: 'Stop', rpc: 'https://evil' }, [], null, 'not-json',
    ]) expect(() => parseHermesAction(output)).toThrow()
  })

  test('policy cannot be increased through caller mutation or model fields', () => {
    const original = policy()
    const engine = new RiskEngine(original)
    original.maxTradeSize = 90_000_000n
    expect(engine.policy.maxTradeSize).toBe(10_000_000n)
    expect(Object.isFrozen(engine.policy)).toBe(true)
    expect(engine.evaluate({ ...tradeAction(), maxTradeSize: '90000000' }, snapshot())).toMatchObject({ allowed: false, code: 'INVALID_ACTION' })
    expect(() => new RiskEngine(policy({ minimumConfidence: NaN }))).toThrow()
    expect(() => new RiskEngine(policy({ maxLossPerPosition: 31_000_000n }))).toThrow()
  })

  test('enforces confidence, edge, price slippage, outcome scope, and order expiry', () => {
    const engine = new RiskEngine(policy())
    expect(engine.evaluate(tradeAction(), snapshot())).toEqual({ allowed: true })
    expect(engine.evaluate(tradeAction({ confidence: 0.69 }), snapshot())).toMatchObject({ code: 'CONFIDENCE' })
    expect(engine.evaluate(tradeAction({ estimatedProbability: 0.51 }), snapshot())).toMatchObject({ code: 'EDGE' })
    expect(engine.evaluate(tradeAction({ estimatedProbability: 0.5499999 }), snapshot())).toMatchObject({ code: 'EDGE' })
    expect(engine.evaluate(tradeAction({ limitPrice: 530_000n }), snapshot())).toMatchObject({ code: 'SLIPPAGE' })
    expect(engine.evaluate(tradeAction({ outcomeId: 5 }), snapshot())).toMatchObject({ code: 'OUTCOME_SCOPE' })
    expect(engine.evaluate(tradeAction({ expiresAt: NOW }), snapshot())).toMatchObject({ code: 'ORDER_EXPIRY' })
    expect(engine.evaluate(tradeAction({ expiresAt: NOW + 116_000 }), snapshot())).toMatchObject({ code: 'ORDER_EXPIRY' })
    expect(engine.evaluate(tradeAction(), snapshot({ book: book({ outcomes: [{ outcomeId: 0, bids: [], asks: [] }] }) }))).toMatchObject({ code: 'NO_REFERENCE_PRICE' })
  })

  test('requires fresh telemetry and books plus authoritative venue/account/market scope', () => {
    const engine = new RiskEngine(policy())
    expect(engine.evaluate(tradeAction(), snapshot({ telemetry: telemetry({ timestamp: NOW - 5001 }) }))).toMatchObject({ code: 'STALE_TELEMETRY' })
    expect(engine.evaluate(tradeAction(), snapshot({ book: book({ updatedAt: NOW - 5001 }) }))).toMatchObject({ code: 'STALE_BOOK' })
    expect(engine.evaluate(tradeAction(), snapshot({ book: book({ updatedAt: NOW + 1 }) }))).toMatchObject({ code: 'STALE_BOOK' })
    expect(engine.evaluate(tradeAction(), snapshot({ telemetry: telemetry({ matchId: 'other' }) }))).toMatchObject({ code: 'SNAPSHOT_SCOPE' })
    expect(engine.evaluate(tradeAction(), snapshot({ book: book({ chainId: 'other' }) }))).toMatchObject({ code: 'SNAPSHOT_SCOPE' })
    expect(engine.evaluate(tradeAction(), snapshot({ balance: balance({ account: 'Mallory' }) }))).toMatchObject({ code: 'SNAPSHOT_SCOPE' })
    expect(engine.evaluate(tradeAction(), snapshot({ positions: [position({ account: 'Mallory' })] }))).toMatchObject({ code: 'INVALID_POSITION' })
    expect(engine.evaluate(tradeAction(), snapshot({ market: market({ paused: true }) }))).toMatchObject({ code: 'MARKET_CLOSED' })
    expect(engine.evaluate(tradeAction(), snapshot({ market: market({ tradingLocksAt: NaN }) }))).toMatchObject({ code: 'INVALID_MARKET' })
    expect(new RiskEngine(policy({ expiresAt: NOW })).evaluate(tradeAction(), snapshot())).toMatchObject({ code: 'SESSION_EXPIRED' })
  })

  test('reserves open BUY capital even when venue balance has not reflected orders', () => {
    const engine = new RiskEngine(policy())
    const open = order({ price: 500_000n, quantity: 10_000_000n })
    expect(engine.evaluate(tradeAction(), snapshot({ openOrders: [open], balance: balance({ total: 6_000_000n, available: 6_000_000n }) }))).toMatchObject({ code: 'INSUFFICIENT_CAPITAL' })
    // Already reserved balance is not subtracted a second time.
    expect(engine.evaluate(tradeAction(), snapshot({ openOrders: [open], balance: balance({ total: 10_000_000n, available: 5_000_000n, reserved: 5_000_000n }) }))).toEqual({ allowed: true })
    expect(engine.evaluate(tradeAction({ amount: 25_000_000n }), snapshot())).toMatchObject({ code: 'TRADE_SIZE' })
    expect(new RiskEngine(policy({ maxOpenOrders: 1 })).evaluate(tradeAction(), snapshot({ openOrders: [open] }))).toMatchObject({ code: 'OPEN_ORDER_LIMIT' })
  })

  test('pending orders count toward position, position loss, match loss and allocation caps', () => {
    const open = order({ price: 500_000n, quantity: 10_000_000n })
    expect(new RiskEngine(policy({ maxPositionSize: 15_000_000n })).evaluate(tradeAction(), snapshot({ openOrders: [open] }))).toMatchObject({ code: 'POSITION_LIMIT' })
    expect(new RiskEngine(policy({ maxLossPerPosition: 7_000_000n })).evaluate(tradeAction(), snapshot({ openOrders: [open] }))).toMatchObject({ code: 'POSITION_LOSS_LIMIT' })
    expect(new RiskEngine(policy({ maxLossPerMatch: 7_000_000n, maxLossPerPosition: 7_000_000n })).evaluate(tradeAction({ outcomeId: 1 }), snapshot({ openOrders: [open] }))).toMatchObject({ code: 'MATCH_LOSS_LIMIT' })
    expect(new RiskEngine(policy({ totalCapital: 30_000_000n })).evaluate(tradeAction(), snapshot({ positions: [position({ marketId: 'other-market', quantity: 60_000_000n, costBasis: 28_000_000n })] }))).toMatchObject({ code: 'CAPITAL_LIMIT' })
  })

  test('SELL cannot spend shares already reserved by open orders or the chain', () => {
    const engine = new RiskEngine(policy())
    const sell = tradeAction({ action: 'SELL', limitPrice: 480_000n, estimatedProbability: 0.3, amount: 6_000_000n })
    expect(engine.evaluate(sell, snapshot({ positions: [position()] }))).toEqual({ allowed: true })
    expect(engine.evaluate(sell, snapshot({ positions: [position({ reservedQuantity: 5_000_000n })] }))).toMatchObject({ code: 'INSUFFICIENT_POSITION' })
    expect(engine.evaluate(sell, snapshot({ positions: [position()], openOrders: [order({ side: 'SELL', quantity: 5_000_000n })] }))).toMatchObject({ code: 'INSUFFICIENT_POSITION' })
    expect(engine.evaluate(sell, snapshot())).toMatchObject({ code: 'INSUFFICIENT_POSITION' })
  })

  test('loss stops and match end bypass reasoning while cancellation remains available', () => {
    const engine = new RiskEngine(policy())
    const expired = snapshot({ now: NOW + 116_000, market: market({ status: 'LOCKED' }) })
    expect(engine.stopReason(expired).allowed).toBe(false)
    expect(engine.evaluate({ action: 'CANCEL_ALL', reason: 'Emergency stop' }, expired)).toEqual({ allowed: true })
    expect(engine.evaluate({ action: 'CANCEL', orderId: 'buy-1', reason: 'Cancel risk' }, { ...expired, openOrders: [order()] })).toEqual({ allowed: true })
    expect(engine.evaluate({ action: 'CANCEL', orderId: 'buy-1', reason: 'Cancel other account' }, { ...expired, openOrders: [order({ maker: 'Mallory' })] })).toMatchObject({ code: 'ORDER_SCOPE' })
    expect(engine.stopReason(snapshot({ positions: [position({ realizedPnl: -30_000_000n })] }))).toMatchObject({ code: 'MATCH_LOSS_LIMIT' })
    expect(engine.stopReason(snapshot({ positions: [position({ costBasis: 25_000_000n })] }))).toMatchObject({ code: 'POSITION_LOSS_LIMIT' })
    const thin = book({ outcomes: [{ outcomeId: 0, bids: [{ price: 900_000n, quantity: 1n, orderCount: 1 }], asks: [] }] })
    expect(new RiskEngine(policy({ maxLossPerPosition: 5_000_000n })).stopReason(snapshot({ positions: [position()], book: thin }))).toMatchObject({ code: 'POSITION_STOP_LOSS' })
  })
})
