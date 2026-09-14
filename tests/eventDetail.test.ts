import { describe, expect, test } from 'bun:test'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import { eventActivity, eventAnswerMarket, eventHoldings, eventHref, linkedEventMarket, resolveEvent, resolveEventPrediction, sampleOrderBook } from '../src/components/events/eventModel'

describe('event detail data isolation', () => {
  test('resolves match and market links without falling back for unknown events', async () => {
    const snapshot = await createSolzDataSource().load()
    const match = snapshot.matches[0]
    expect(resolveEvent(snapshot, match.id)?.id).toBe(match.id)
    expect(resolveEvent(snapshot, match.marketId)?.id).toBe(match.id)
    expect(resolveEvent(snapshot, 'unknown-event')).toBeUndefined()
  })

  test('nested predictions stay within their parent match across all three routes', async () => {
    const snapshot = await createSolzDataSource().load()
    const prediction = snapshot.markets.find((market) => market.matchId && market.outcomes.length > 2)!
    const matchId = prediction.matchId!
    expect(resolveEventPrediction(snapshot, matchId, prediction.id)?.id).toBe(prediction.id)
    const other = snapshot.matches.find((match) => match.id !== matchId)!
    expect(resolveEventPrediction(snapshot, other.id, prediction.id)).toBeUndefined()
    expect(resolveEventPrediction(snapshot, matchId, 'missing-prediction')).toBeUndefined()
    for (const base of ['/events', '/events-2', '/events-3']) {
      expect(eventHref(base, matchId, prediction.id)).toBe(`${base}/${matchId}/${prediction.id}`)
    }
  })

  test('a linked overview charts candidate probabilities without merging their binary markets', async () => {
    const snapshot = await createSolzDataSource().load()
    const base = snapshot.markets[0]!
    const linked = [1, 2].map((number) => ({
      ...base, id: `question-${number}`, title: 'Who gets the most kills?',
      presentation: { kind: 'linked' as const, eventTitle: 'Who gets the most kills?', answer: { label: `GENESIS-0${number}`, participantId: `genesis-0${number}` }, outcomes: [{ id: 0 as const, label: 'Yes' }, { id: 1 as const, label: 'No' }] },
      outcomes: [{ ...base.outcomes[0]!, id: 'yes', probability: number === 1 ? .7 : .3 }, { ...base.outcomes[1]!, id: 'no', probability: number === 1 ? .3 : .7 }],
    }))
    const overview = linkedEventMarket(linked)!
    expect(overview.outcomes.map((outcome) => [outcome.id, outcome.label, outcome.probability])).toEqual([
      ['question-1', 'GENESIS-01', .7], ['question-2', 'GENESIS-02', .3],
    ])
    expect(linked.map((market) => market.id)).toEqual(['question-1', 'question-2'])
  })

  test('a nested answer trades No on the authoritative market and isolates its holdings', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const group = snapshot.markets.find((market) => market.id === 'market-07-most-kills')!
    const binary = eventAnswerMarket(group, group.outcomes[0])
    expect(binary.outcomes.map((outcome) => outcome.label)).toEqual(['Yes', 'No'])
    expect(binary.outcomes[0].probability + binary.outcomes[1].probability).toBeCloseTo(1)
    const receipt = await source.placeOrder({ market: binary, outcome: binary.outcomes[1], amount: 250, token: 'COOLA' })
    const updated = await source.load()
    const freshGroup = updated.markets.find((market) => market.id === group.id)!
    const freshBinary = eventAnswerMarket(freshGroup, freshGroup.outcomes[0])
    const holding = eventHoldings(updated, freshBinary).find((row) => row.self)!
    expect(holding.outcomeId).toBe(binary.outcomes[1].id)
    expect(receipt.position.marketId).toBe(group.id)
    expect(receipt.position.averagePrice).toBeCloseTo(binary.outcomes[1].probability)
    expect(freshBinary.outcomes[1].probability).toBeGreaterThan(binary.outcomes[1].probability)
    expect(eventHoldings(updated, eventAnswerMarket(freshGroup, freshGroup.outcomes[1])).some((row) => row.self)).toBe(false)
    expect(eventActivity(updated, group.matchId!, group.id).some((row) => row.outcomeId === receipt.position.outcomeId)).toBe(true)
    expect(eventActivity(updated, group.matchId!, 'market-07-winner').some((row) => row.outcomeId === receipt.position.outcomeId)).toBe(false)
  })

  test('activity excludes other events and season fills sharing the highlight match id', async () => {
    const snapshot = await createSolzDataSource().load()
    const match = snapshot.matches[0]
    const rows = eventActivity(snapshot, match.id)
    const outcomes = new Set(snapshot.markets.filter((market) => market.matchId === match.id).flatMap((market) => market.outcomes.map((outcome) => outcome.id)))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((row) => row.matchId === match.id && outcomes.has(row.outcomeId))).toBe(true)
    const marketRows = eventActivity(snapshot, match.id, match.marketId)
    const market = snapshot.markets.find((item) => item.id === match.marketId)!
    expect(marketRows.every((row) => market.outcomes.some((outcome) => outcome.id === row.outcomeId))).toBe(true)
  })

  test('holdings include only this market and currency without mutating preview positions', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const market = snapshot.markets[0]
    const receipt = await source.placeOrder({ market, outcome: market.outcomes[0], amount: 250, token: 'COOLA' })
    const updated = await source.load()
    const before = JSON.stringify(updated.account)
    const holdings = eventHoldings(updated, market)
    expect(holdings.find((row) => row.id === receipt.position.id)?.shares).toBe(receipt.position.shares)
    expect(eventHoldings(updated, updated.markets.find((item) => item.id !== market.id)!).filter((row) => row.self)).toHaveLength(0)
    expect(JSON.stringify(updated.account)).toBe(before)
  })

  test('sample depth has valid prices and correctly accumulated quote values at extremes', async () => {
    const snapshot = await createSolzDataSource().load()
    for (const probability of [0, .01, .5, .99, 1]) {
      const { asks, bids } = sampleOrderBook({ ...snapshot.markets[0].outcomes[0], probability })
      expect([...asks, ...bids].every((row) => row.price > 0 && row.price < 1 && row.shares > 0)).toBe(true)
      expect(Math.min(...asks.map((row) => row.price))).toBeGreaterThan(Math.max(...bids.map((row) => row.price)))
      expect(asks[0].total).toBeCloseTo(asks.reduce((sum, row) => sum + row.price * row.shares, 0))
      expect(bids.at(-1)!.total).toBeCloseTo(bids.reduce((sum, row) => sum + row.price * row.shares, 0))
      expect([...asks, ...bids].every((row) => row.depth > 0 && row.depth <= 100)).toBe(true)
      expect(asks[0].depth).toBe(100)
      expect(bids.at(-1)!.depth).toBe(100)
      expect(bids.every((row, index) => index === 0 || row.depth > bids[index - 1].depth)).toBe(true)
    }
  })

  test('replies target the chosen comment and cannot attach to another event', async () => {
    const source = createSolzDataSource()
    const snapshot = await source.load()
    const parent = snapshot.chat.find((message) => message.kind === 'viewer')!
    source.sendChat(parent.matchId, 'The relay is the key here.', parent.id)
    const reply = (await source.load()).chat.at(-1)!
    expect(reply.replyToId).toBe(parent.id)
    expect(reply.matchId).toBe(parent.matchId)
    const other = snapshot.matches.find((match) => match.id !== parent.matchId)!
    expect(() => source.sendChat(other.id, 'Wrong event reply', parent.id)).toThrow('no longer available')
  })
})
