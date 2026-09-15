import { describe, expect, test } from 'bun:test'
import { chartShape } from '../src/components/markets/moneyline'
import type { ArenaMarket, ArenaMarketOutcome } from '../src/components/solz/model'

const outcome = (id: string): ArenaMarketOutcome => ({ id, label: id, detail: '', probability: .5, priceHistory: [] })
const market = (ids: string[], over: Partial<ArenaMarket> = {}): ArenaMarket => ({
  id: 'm', matchId: 'match', kind: 'match-winner', title: 'T', status: 'open', closesAt: 0,
  description: '', rules: '', volume: { SOL: 0, COOLA: 0 }, outcomes: ids.map(outcome), ...over,
})

describe('what a chart draws', () => {
  test('a head-to-head shows both teams at once, with no toggle', () => {
    // One market, two complementary books: NO is 1 - YES, so a chart that shows
    // one of them is showing half the market.
    expect(chartShape(market(['yes', 'no'], { presentation: { kind: 'head-to-head' } as never }))).toBe('both-sides')
  })

  test('a plain binary question also shows both sides', () => {
    expect(chartShape(market(['yes', 'no']))).toBe('both-sides')
  })

  test('a field of answers shows every answer', () => {
    expect(chartShape(market(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']))).toBe('all-answers')
  })

  test('one answer of a field, viewed alone, is one line', () => {
    // Its NO leg is a mirror of its YES leg — drawing both is one line twice.
    expect(chartShape(market(['a', 'b', 'c']), { nested: true })).toBe('single-answer')
    expect(chartShape(market(['yes', 'no']), { nested: true })).toBe('single-answer')
  })

  test('a degenerate single-outcome market does not claim a second side', () => {
    expect(chartShape(market(['only']))).toBe('single-answer')
    expect(chartShape(market([]))).toBe('single-answer')
  })
})
