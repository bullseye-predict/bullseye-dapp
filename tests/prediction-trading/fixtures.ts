import type { Balance, Market, MatchTelemetry, Order, OrderBook, Position, SignedOrder } from '../../packages/prediction-core/types'
import type { HermesSessionPolicy, RiskSnapshot, TradeAction } from '../../packages/risk-engine'

export const NOW = 1_000_000
export const market = (overrides: Partial<Market> = {}): Market => ({
  id: 'market-1', matchId: 'match-1', venue: 'EVM', chainId: '31337', marketAddress: '0xmarket',
  collateralToken: 'USDC', collateralDecimals: 6, outcomes: [{ id: 0, label: 'Blue' }, { id: 1, label: 'Red' }, { id: 2, label: 'Green' }],
  status: 'TRADING', createdAt: NOW - 10_000, tradingStartsAt: NOW - 1000, tradingLocksAt: NOW + 120_000, expiresAt: NOW + 180_000,
  paused: false, ...overrides,
})
export const scope = { venue: 'EVM' as const, chainId: '31337', marketId: 'market-1' }
export const signedOrder = (overrides: Partial<SignedOrder> = {}): SignedOrder => ({
  ...scope, orderId: 'buy-1', maker: 'Alice', outcomeId: 0, side: 'BUY', price: 600_000n,
  quantity: 10_000_000n, nonce: 0n, expiresAt: NOW + 60_000, signature: 'signed', ...overrides,
})
export const order = (overrides: Partial<Order> = {}): Order => ({
  ...signedOrder(), filled: 0n, status: 'OPEN', createdAt: NOW, sequence: 1, ...overrides,
})
export const telemetry = (overrides: Partial<MatchTelemetry> = {}): MatchTelemetry => ({
  matchId: 'match-1', sequence: 1, timestamp: NOW, remainingMs: 120_000,
  participants: [{ id: 'blue', teamId: 'blue', hp: 100, maxHp: 100, alive: true, kills: 0 }, { id: 'red', teamId: 'red', hp: 100, maxHp: 100, alive: true, kills: 0 }],
  score: { blue: 0, red: 0 }, objectives: { blue: 50, red: 50 }, kills: [], ...overrides,
})
export const book = (overrides: Partial<OrderBook> = {}): OrderBook => ({
  ...scope, updatedAt: NOW, outcomes: [0, 1, 2].map((id) => ({ outcomeId: id,
    bids: [{ price: 480_000n, quantity: 100_000_000n, orderCount: 2 }],
    asks: [{ price: 500_000n, quantity: 100_000_000n, orderCount: 2 }],
  })), ...overrides,
})
export const balance = (overrides: Partial<Balance> = {}): Balance => ({ account: 'Alice', collateralToken: 'USDC', total: 100_000_000n, available: 100_000_000n, reserved: 0n, ...overrides })
export const position = (overrides: Partial<Position> = {}): Position => ({
  ...scope, account: 'Alice', outcomeId: 0, quantity: 10_000_000n, reservedQuantity: 0n, costBasis: 5_000_000n, realizedPnl: 0n, ...overrides,
})
export const policy = (overrides: Partial<HermesSessionPolicy> = {}): HermesSessionPolicy => ({
  totalCapital: 100_000_000n, maxTradeSize: 10_000_000n, maxPositionSize: 50_000_000n,
  maxLossPerMatch: 30_000_000n, maxLossPerPosition: 20_000_000n, maxOpenOrders: 10,
  minimumConfidence: 0.7, minimumEdge: 50_000n, maxSlippage: 20_000n, stopTradingBeforeMatchEndSeconds: 5,
  maxTelemetryAgeMs: 5000, maxOrderBookAgeMs: 5000, expiresAt: NOW + 3600_000, ...overrides,
})
export const tradeAction = (overrides: Partial<TradeAction> = {}): TradeAction => ({
  action: 'BUY', outcomeId: 0, limitPrice: 500_000n, amount: 10_000_000n, confidence: 0.9,
  estimatedProbability: 0.7, expiresAt: NOW + 10_000, reason: 'Objective advantage', ...overrides,
})
export const snapshot = (overrides: Partial<RiskSnapshot> = {}): RiskSnapshot => ({
  account: 'Alice', market: market(), telemetry: telemetry(), book: book(), positions: [], openOrders: [], balance: balance(), now: NOW, ...overrides,
})
