import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import { predictionContract } from '../src/components/solz/predictionContracts'
import { shouldShowSeason, INTERMISSION_DELAY } from '../src/components/home/heroMarket'

const memory = new Map<string, string>()
const now = Date.now
beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  } } })
})
afterEach(() => { Date.now = now; delete (globalThis as { window?: unknown }).window })

describe('COOLA hero trading simulation', () => {
  test('lists two-sided, multi-team, agent, and dated season predictions with normalized prices', async () => {
    const snapshot = await createSolzDataSource().load()
    const ffa = snapshot.matches.find((match) => match.teams.length === 4)!
    expect(snapshot.markets.find((market) => market.matchId === ffa.id)?.outcomes).toHaveLength(4)
    const season = snapshot.markets.filter((market) => !market.matchId)
    expect(season).toHaveLength(3)
    expect(new Set(season.map((market) => market.closesAt)).size).toBe(3)
    expect(snapshot.markets.find((market) => market.kind === 'most-kills')?.outcomes).toHaveLength(6)
    expect(snapshot.markets[0].outcomes[0].label).toBe('BONK TEAM')
    expect(snapshot.prompts.every((prompt) => prompt.token === 'COOLA')).toBe(true)
    for (const market of snapshot.markets) expect(market.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)).toBeCloseTo(1, 6)
  })

  test('partially sells owned shares, prorates cost, and rejects overselling', async () => {
    const source = createSolzDataSource()
    const { markets } = await source.load()
    const market = markets[0], outcome = market.outcomes[0]
    const bought = await source.placeOrder({ market, outcome, token: 'COOLA', amount: 250 })
    const half = bought.position.shares / 2
    const price = bought.market.outcomes[0].probability
    const sold = await source.sellShares(market.id, outcome.id, 'COOLA', half)
    expect(sold.positions[0].shares).toBeCloseTo(half)
    expect(sold.positions[0].stake).toBeCloseTo(bought.position.stake / 2)
    expect(sold.balances.COOLA).toBeCloseTo(bought.account.balances.COOLA + half * price * .988)
    expect(source.sellShares(market.id, outcome.id, 'COOLA', half + 1)).rejects.toThrow('Not enough')
  })

  test('a pending limit buy reserves funds across reload and refunds once on cancel', async () => {
    const source = createSolzDataSource()
    const { markets, account } = await source.load()
    const market = markets[0], outcome = market.outcomes[0]
    const order = await source.placeLimitOrder({ marketId: market.id, outcomeId: outcome.id, token: 'COOLA', side: 'buy', price: .01, shares: 10_000 })
    expect(order.status).toBe('open')
    const restored = createSolzDataSource()
    const state = await restored.load()
    expect(state.limitOrders[0].id).toBe(order.id)
    expect(state.account.balances.COOLA).toBeCloseTo(account.balances.COOLA - 101.2)
    restored.cancelLimitOrder(order.id)
    restored.cancelLimitOrder(order.id)
    expect((await restored.load()).account.balances.COOLA).toBeCloseTo(account.balances.COOLA)
  })

  test('a marketable limit buy fills at the current price and refunds its price improvement', async () => {
    const source = createSolzDataSource()
    const { markets, account } = await source.load()
    const market = markets[0], outcome = market.outcomes[0]
    const order = await source.placeLimitOrder({ marketId: market.id, outcomeId: outcome.id, token: 'COOLA', side: 'buy', price: .99, shares: 100 })
    const state = await source.load()
    expect(order.status).toBe('filled')
    expect(order.filledPrice).toBe(outcome.probability)
    expect(state.account.positions[0].shares).toBe(100)
    expect(state.account.balances.COOLA).toBeCloseTo(account.balances.COOLA - 100 * outcome.probability * 1.012)
  })

  test('a sell limit reserves shares against market sells and releases them on expiry', async () => {
    const source = createSolzDataSource()
    const { markets } = await source.load()
    const market = markets[0], outcome = market.outcomes[0]
    const bought = await source.placeOrder({ market, outcome, token: 'COOLA', amount: 250 })
    const expiresAt = now() + 60_000
    const order = await source.placeLimitOrder({ marketId: market.id, outcomeId: outcome.id, token: 'COOLA', side: 'sell', price: .99, shares: bought.position.shares, expiresAt })
    expect(source.sellShares(market.id, outcome.id, 'COOLA', 1)).rejects.toThrow('Not enough')
    Date.now = () => expiresAt + 1
    expect((await source.load()).limitOrders.find((item) => item.id === order.id)?.status).toBe('expired')
    const result = await source.sellShares(market.id, outcome.id, 'COOLA', bought.position.shares)
    expect(result.positions).toHaveLength(0)
  })

  test('expiry and cutoff release buy reservations, and closed markets reject new limits', async () => {
    const source = createSolzDataSource()
    const { markets, account } = await source.load()
    const market = markets[0], outcome = market.outcomes[0]
    const intent = { marketId: market.id, outcomeId: outcome.id, token: 'COOLA' as const, side: 'buy' as const, price: .01, shares: 10_000 }
    await source.placeLimitOrder(intent)
    Date.now = () => market.closesAt + 1
    const expired = await source.load()
    expect(expired.limitOrders[0].status).toBe('expired')
    expect(expired.account.balances.COOLA).toBeCloseTo(account.balances.COOLA)
    expect(source.placeLimitOrder(intent)).rejects.toThrow('no longer open')
  })

  test('NO buys use the complement price and retain separate shares from YES', async () => {
    const source = createSolzDataSource()
    const state = await source.load()
    const market = state.markets.find((item) => item.outcomes.length > 2)!
    const yes = market.outcomes[0]
    const no = predictionContract(yes, 'no')
    const bought = await source.placeOrder({ market, outcome: no, token: 'COOLA', amount: 250 })
    const priceAfter = 1 - bought.market.outcomes[0].probability
    expect(bought.position.outcomeId).toBe(no.id)
    expect(bought.position.averagePrice).toBeCloseTo(1 - yes.probability)
    expect(bought.position.shares).toBeCloseTo(250 / (1 - yes.probability))
    expect(bought.account.positions[0].currentPrice).toBeCloseTo(priceAfter)
    expect(bought.market.outcomes[0].probability).toBeLessThan(yes.probability)
    expect(bought.market.outcomes.reduce((sum, item) => sum + item.probability, 0)).toBeCloseTo(1, 8)
    expect(source.sellShares(market.id, yes.id, 'COOLA', 1)).rejects.toThrow('Not enough')
    const sold = await source.sellShares(market.id, no.id, 'COOLA', bought.position.shares / 2)
    expect(sold.balances.COOLA).toBeCloseTo(bought.account.balances.COOLA + bought.position.shares / 2 * priceAfter * .988)
    expect(sold.positions[0].shares).toBeCloseTo(bought.position.shares / 2)
  })

  test('NO limits fill against the complement price and reserve only NO shares', async () => {
    const source = createSolzDataSource()
    const state = await source.load()
    const market = state.markets.find((item) => item.outcomes.length > 2)!
    const no = predictionContract(market.outcomes[0], 'no')
    const bought = await source.placeLimitOrder({ marketId: market.id, outcomeId: no.id, side: 'buy', token: 'COOLA', price: .99, shares: 100 })
    expect(bought.status).toBe('filled')
    expect(bought.filledPrice).toBeCloseTo(no.probability)
    const sellOrder = await source.placeLimitOrder({ marketId: market.id, outcomeId: no.id, side: 'sell', token: 'COOLA', price: .99, shares: 80 })
    expect(sellOrder.status).toBe('open')
    expect(source.sellShares(market.id, no.id, 'COOLA', 21)).rejects.toThrow('Not enough')
    source.cancelLimitOrder(sellOrder.id)
    const sold = await source.sellShares(market.id, no.id, 'COOLA', 100)
    expect(sold.positions).toHaveLength(0)
  })

  test('an explicitly paused data adapter blocks orders without changing its market or account', async () => {
    let enabled = true
    const source = createSolzDataSource({ simulationEnabled: () => enabled })
    const initial = await source.load()
    const market = initial.markets[0], outcome = market.outcomes[0]
    enabled = false
    expect(source.placeOrder({ market, outcome, token: 'COOLA', amount: 250 })).rejects.toThrow('Simulation is off')
    expect(source.placeLimitOrder({ marketId: market.id, outcomeId: outcome.id, side: 'buy', token: 'COOLA', price: .99, shares: 100 })).rejects.toThrow('Simulation is off')
    const off = await source.load()
    expect(off.highlightMatchId).toBe(initial.highlightMatchId)
    expect(off.account.balances.COOLA).toBe(initial.account.balances.COOLA)
    expect(off.markets[0].outcomes[0].probability).toBe(outcome.probability)
    enabled = true
    expect((await source.placeOrder({ market, outcome, token: 'COOLA', amount: 250 })).status).toBe('filled')
  })

  test('the long-duration highlight waits 2.5 minutes after a match, unless pinned', () => {
    expect(shouldShowSeason('live', 1000, 2000, false)).toBe(false)
    expect(shouldShowSeason('settled', 1000, 1000 + INTERMISSION_DELAY - 1, false)).toBe(false)
    expect(shouldShowSeason('settled', 1000, 1000 + INTERMISSION_DELAY, false)).toBe(true)
    expect(shouldShowSeason('live', 1000, 2000, true)).toBe(true)
  })
})
