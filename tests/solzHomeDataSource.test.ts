import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import { promptRecipients } from '../src/components/solz/promptRouting'

const memory = new Map<string, string>()
beforeEach(() => {
  memory.clear()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => memory.set(key, value),
  } } })
})
afterEach(() => { mock.restore(); delete (globalThis as { window?: unknown }).window })

describe('homepage preview operations', () => {
  test('keeps the soda-can agents distinct from token teams', async () => {
    const snapshot = await createSolzDataSource().load()
    expect(snapshot.agents).toHaveLength(12)
    expect(snapshot.agents.slice(0, 4).map((agent) => agent.codename)).toEqual(['c0ke', 'peps1', '2UP', 'Monst3r'])
    expect(snapshot.matches[0].roster[0].codename).toBe('c0ke')
    expect(snapshot.teams[0].symbol).toBe('$BONK')
    expect(snapshot.markets.every((market) => Math.abs(market.outcomes.reduce((sum, outcome) => sum + outcome.probability, 0) - 1) < 0.0001)).toBe(true)
  })

  test('buys, persists, and closes a position once, including fees', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    const market = initial.markets[0]
    const receipt = await source.placeOrder({ market, outcome: market.outcomes[0], token: 'COOLA', amount: 250 })
    expect(receipt.account.balances.COOLA).toBe(42_247)
    expect((await source.load()).account.positions).toHaveLength(1)
    const persisted = await createSolzDataSource().load()
    expect(persisted.account.positions[0].id).toBe(receipt.position.id)
    const account = await source.closePosition(receipt.position.id)
    const sellPrice = receipt.market.outcomes[0].probability
    expect(account.balances.COOLA).toBeCloseTo(42_247 + receipt.position.shares * sellPrice * 0.988)
    expect(account.positions).toHaveLength(0)
    expect(source.closePosition(receipt.position.id)).rejects.toThrow('already been closed')
  })

  test('concurrent orders cannot overspend the same credits', async () => {
    const source = createSolzDataSource()
    const { markets } = await source.load()
    const intent = { market: markets[0], outcome: markets[0].outcomes[0], token: 'COOLA' as const, amount: 30_000 }
    const results = await Promise.allSettled([source.placeOrder(intent), source.placeOrder(intent)])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect((await source.load()).account.balances.COOLA).toBe(12_140)
  })

  test('market cutoff is checked when an action is submitted', async () => {
    const source = createSolzDataSource()
    const { markets } = await source.load()
    const market = markets[0]
    const realNow = Date.now
    Date.now = () => market.closesAt + 1
    try {
      expect(source.placeOrder({ market, outcome: market.outcomes[0], token: 'COOLA', amount: 100 })).rejects.toThrow('no longer open')
      expect(source.createAutomation({ matchId: market.matchId!, marketId: market.id, outcomeId: market.outcomes[0].id, instruction: 'Buy below 40%', trigger: { kind: 'below', threshold: 0.4 }, action: 'buy', budget: 100, token: 'COOLA' })).rejects.toThrow('no longer open')
    } finally { Date.now = realNow }
  })

  test('reserves bid credits, refunds replaced own bids, and rejects overdrafts', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    const firstQuote = source.quoteSpotBid('RESERVE')
    const first = await source.placeSpotBid('team-giga', 'RESERVE', firstQuote.minimum, firstQuote.token)
    expect((await source.load()).account.balances[first.token]).toBeCloseTo(initial.account.balances[first.token] - first.amount)
    const nextQuote = source.quoteSpotBid('RESERVE')
    const next = await source.placeSpotBid('team-giga', 'RESERVE', nextQuote.minimum, nextQuote.token)
    expect((await source.load()).account.balances[next.token]).toBeCloseTo(initial.account.balances[next.token] - next.amount)
    const restored = createSolzDataSource()
    expect(restored.quoteSpotBid('RESERVE').leading?.id).toBe(next.id)
    expect((await restored.load()).account.balances[next.token]).toBeCloseTo(initial.account.balances[next.token] - next.amount)
    expect(source.placeSpotBid('team-giga', 'RESERVE', 1_000_000, 'COOLA')).rejects.toThrow('Not enough')
  })

  test('prompt submissions debit the correct credit cost and reach the public feed', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    const match = initial.matches[0]
    const intent = { matchId: match.id, agentId: match.roster[0].agentId, text: 'Hold the relay until the team arrives.', token: 'COOLA' as const }
    const receipt = await source.submitPrompt(intent)
    const updated = await source.load()
    expect(updated.prompts[0].id).toBe(receipt.id)
    expect(updated.prompts[0].codename).toBe('c0ke')
    expect(updated.account.balances.COOLA).toBe(initial.account.balances.COOLA - source.quotePrompt(intent).cost)
    expect(updated.chat.at(-1)?.text).toContain(intent.text)
  })

  test('a general directive reaches all active cans for one fuel charge', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    const match = initial.matches[0]
    await source.submitPrompt({ matchId: match.id, text: 'Hold the west relay and protect the team.', token: 'COOLA' })
    const updated = await source.load()
    expect(updated.prompts[0].targetAgentIds).toEqual(match.roster.filter((entry) => entry.status === 'active').map((entry) => entry.agentId))
    expect(updated.prompts[0].codename).toBe('ALL AGENTS')
    expect(updated.account.balances.COOLA).toBe(initial.account.balances.COOLA - 75)
    expect(updated.account.promptCount).toBe(initial.account.promptCount + 1)
  })

  test('names and agent numbers address cans without a required selector', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    const match = initial.matches[0]
    const named = promptRecipients(match, 'C0KE, push west; Peps1, cover the flank.')
    expect(named.map((entry) => entry.codename)).toEqual(['c0ke', 'peps1'])
    expect(promptRecipients(match, 'Agent-03, defend the objective.').map((entry) => entry.codename)).toEqual(['2UP'])
    expect(promptRecipients(match, 'Peps1man should not match an agent name.')).toHaveLength(match.roster.filter((entry) => entry.status === 'active').length)
    await source.submitPrompt({ matchId: match.id, text: 'c0ke, take point. peps1, hold the rear.', token: 'COOLA' })
    const updated = await source.load()
    expect(updated.prompts[0].targetAgentIds).toEqual(named.map((entry) => entry.agentId))
    expect(updated.prompts[0].codename).toBe('c0ke + peps1')
    expect(updated.account.balances.COOLA).toBe(initial.account.balances.COOLA - 75)
  })

  test('general routing skips inactive cans, while explicit addresses remain precise', async () => {
    const { matches } = await createSolzDataSource().load()
    const match = structuredClone(matches[0])
    match.roster[0].status = 'eliminated'
    expect(promptRecipients(match, 'Everyone defend the objective.').some((entry) => entry.codename === 'c0ke')).toBe(false)
    expect(promptRecipients(match, 'c0ke, defend the objective.')[0].status).toBe('eliminated')
    expect(promptRecipients(match, 'peps1, hold the rear.', match.roster[2].agentId).map((entry) => entry.codename)).toEqual(['2UP'])
    expect(promptRecipients(match, 'Hold the objective.', 'missing-agent')).toHaveLength(0)
  })

  test('automation includes fees in its budget and cannot sell shares it does not own', async () => {
    const source = createSolzDataSource()
    const initial = await source.load()
    for (const rule of initial.automation) source.setAutomationStatus(rule.id, 'paused')
    const market = initial.markets[0]
    const base = { matchId: market.matchId!, marketId: market.id, outcomeId: market.outcomes[0].id, instruction: 'Execute one preview trade', trigger: { kind: 'above' as const, threshold: 0 }, token: 'COOLA' as const }
    const buy = await source.createAutomation({ ...base, action: 'buy', budget: 100 })
    let updated = initial
    const unsubscribe = source.subscribe((next) => { updated = next })
    try {
      await new Promise((resolve) => setTimeout(resolve, 2_700))
      expect(updated.automation.find((rule) => rule.id === buy.id)?.status).toBe('triggered')
      expect(updated.account.balances.COOLA).toBe(initial.account.balances.COOLA - 100)
      expect(updated.account.positions[0].stake).toBe(100)
      const sell = await source.createAutomation({ ...base, action: 'sell', budget: 1_000_000 })
      await new Promise((resolve) => setTimeout(resolve, 2_700))
      expect(updated.account.positions).toHaveLength(0)
      expect(updated.automation.find((rule) => rule.id === sell.id)?.status).toBe('triggered')
      source.setAutomationStatus(sell.id, 'armed')
      const before = updated.account.balances.COOLA
      await new Promise((resolve) => setTimeout(resolve, 2_700))
      expect(updated.automation.find((rule) => rule.id === sell.id)?.status).toBe('paused')
      expect(updated.account.balances.COOLA).toBe(before)
    } finally { unsubscribe() }
  }, 10_000)
  test('posts a chat message for an arena match the fixture list never held, on any market source', async () => {
    // The homepage shows arena-fed matches (`arena-<roomId>`), and its market
    // source is SOLANA on this branch. Neither may silence the chat field: the
    // message is local to this device, so it goes into the list either way.
    const source = createSolzDataSource({ simulationEnabled: () => false })
    const initial = await source.load()
    expect(initial.matches.some((match) => match.id === 'arena-room-404')).toBe(false)

    source.sendChat('arena-room-404', '  hold the wall  ')
    const posted = (await source.load()).chat.filter((entry) => entry.matchId === 'arena-room-404')
    expect(posted).toHaveLength(1)
    expect(posted[0].text).toBe('hold the wall')
    expect(posted[0].author).toBe('YOU')
    expect(posted[0].self).toBe(true)
    expect(posted[0].kind).toBe('viewer')

    // A reply still has to attach to a thread this source holds.
    expect(() => source.sendChat('arena-room-404', 'reply', posted[0].id)).toThrow('no longer available')
  })
})
