import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { createDemoArenaAdapter } from '../src/components/arena/demoArenaAdapter'

const memory = new Map<string, string>()
const browserStub = {
  localStorage: {
    getItem(key: string) { return memory.get(key) ?? null },
    setItem(key: string, value: string) { memory.set(key, value) },
    removeItem(key: string) { memory.delete(key) },
    clear() { memory.clear() },
  },
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', { value: browserStub, configurable: true })
})

afterAll(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('SOLZ practice arena adapter', () => {
  test('loads twelve Genesis agent-athletes and SOLZ-only match markets', async () => {
    memory.clear()
    const adapter = createDemoArenaAdapter()
    const snapshot = await adapter.load()

    expect(snapshot.matches[0]?.participants).toHaveLength(12)
    expect(snapshot.matches.every((match) => match.source === 'simulation')).toBe(true)
    expect(snapshot.markets[0]?.kind).toBe('team-winner')
    expect(snapshot.markets.map((market) => market.kind)).toContain('team-handicap')
    expect(snapshot.markets.map((market) => market.kind)).toContain('kill-total')
    expect(snapshot.markets.map((market) => market.kind)).toContain('first-eliminated')
    expect(snapshot.markets.map((market) => market.kind)).toContain('weekly-leader')
    expect(snapshot.markets.map((market) => market.kind)).toContain('weekly-volume')
    expect(snapshot.markets[0]?.outcomes[0]?.priceHistory?.length).toBeGreaterThan(20)
    expect(snapshot.markets.every((market) => Math.abs(market.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 0.001)).toBe(true)
    expect(snapshot.markets.every((market) => {
      const pointCount = market.outcomes[0]?.priceHistory?.length ?? 0
      return Array.from({ length: pointCount }, (_, index) => (
        market.outcomes.reduce((sum, outcome) => sum + (outcome.priceHistory?.[index]?.probability ?? 0), 0)
      )).every((total) => Math.abs(total - 1) < 0.001)
    })).toBe(true)
    expect(Object.keys(snapshot.account.balances).sort()).toEqual(['SOL', 'SOLZ'])
  })

  test('fills a practice position, debits SOLZ, moves its signal, and persists the account', async () => {
    memory.clear()
    const adapter = createDemoArenaAdapter()
    const before = await adapter.load()
    const market = before.markets[0]!
    const outcome = market.outcomes[0]!
    const quote = adapter.quoteOrder({ market, outcome, token: 'SOLZ', amount: 250 })
    const receipt = await adapter.placeOrder({ market, outcome, token: 'SOLZ', amount: 250 })

    expect(receipt.status).toBe('filled')
    expect(receipt.position.shares).toBeCloseTo(quote.shares)
    expect(receipt.account.balances.SOLZ).toBeCloseTo(before.account.balances.SOLZ - quote.total)
    expect(receipt.market.outcomes.find((item) => item.id === outcome.id)!.probability).toBeGreaterThan(outcome.probability)

    const reloaded = createDemoArenaAdapter()
    const persisted = await reloaded.load()
    expect(persisted.account.positions).toHaveLength(1)
    expect(persisted.account.balances.SOLZ).toBeCloseTo(receipt.account.balances.SOLZ)
  })

  test('charges a directive and applies the requested agent movement', async () => {
    memory.clear()
    const originalRandom = Math.random
    Math.random = () => 0.9
    try {
      const adapter = createDemoArenaAdapter()
      const before = await adapter.load()
      const match = before.matches[0]!
      const target = match.participants[0]!
      const quote = adapter.quotePrompt({ match, participant: target, token: 'SOL', prompt: 'Move north now' })
      const receipt = await adapter.sendPrompt({ match, participant: target, token: 'SOL', prompt: 'Move north now' })

      expect(receipt.status).toBe('executed')
      expect(receipt.account.promptCount).toBe(1)
      expect(receipt.account.balances.SOL).toBeCloseTo(before.account.balances.SOL - quote.cost)
    } finally {
      Math.random = originalRandom
    }
  })

  test('publishes a new authoritative simulation snapshot on manual advance', async () => {
    memory.clear()
    const adapter = createDemoArenaAdapter()
    const initial = await adapter.load()
    let observed = initial
    const unsubscribe = adapter.subscribe?.((value) => { observed = value })
    adapter.advanceSimulation?.()
    unsubscribe?.()

    expect(observed.updatedAt).toBeGreaterThanOrEqual(initial.updatedAt)
    expect(observed.markets[0]?.outcomes[0]?.priceHistory?.length).toBeGreaterThan(
      initial.markets[0]?.outcomes[0]?.priceHistory?.length ?? 0
    )
  })
})
