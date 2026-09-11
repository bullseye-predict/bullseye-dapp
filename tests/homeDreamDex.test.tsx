import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { bindingFor, unpricedMarkets } from '../src/components/home/useVenueMarketPrices'
import { HighlightChart } from '../src/components/home/HighlightChart'
import { createSolzDataSource } from '../src/components/solz/solzDataSource'
import type { ArenaMarket } from '../src/components/solz/model'

const binding = {
  eventId: 'match-old', questionId: 'winner-coke', label: 'Will COKE win?',
  marketId: `0x${'ab'.repeat(32)}` as `0x${string}`, oracleQuestionId: '1',
  tradingStartsAt: 1000, tradingLocksAt: 60000, voidPolicy: 0 as const,
}
const market: ArenaMarket = {
  id: 'winner-coke', matchId: 'match-new', kind: 'match-winner', title: 'Will COKE win?',
  status: 'open', closesAt: 60000, description: '', rules: '', volume: { SOL: 0, COOLA: 0 },
  outcomes: [{ id: 'yes', label: 'YES', detail: '', probability: .55, participantId: 'coke', priceHistory: [] }],
}

describe('DreamDEX match and chart isolation', () => {
  test('the same COKE question in the next match cannot inherit a prior event', () => {
    expect(bindingFor(market, [binding])).toBeUndefined()
    expect(bindingFor({ ...market, matchId: 'match-old' }, [binding])).toBe(binding)
    expect(bindingFor(market, [{ ...binding, eventId: 'match-new', questionId: 'different-question' }])).toBeUndefined()
  })
  test('unpriced markets discard prior network bindings and chart history', () => {
    const [reset] = unpricedMarkets([{ ...market, onchain: { ...binding, chainId: '50312', indexerUrl: 'https://indexer.example', wsRpcUrl: 'wss://rpc.example' }, outcomes: [{ ...market.outcomes[0], priceHistory: [{ at: 1000, probability: .9 }] }] }])
    expect(reset.onchain).toBeUndefined()
    expect(reset.outcomes[0].priceHistory).toEqual([])
  })
  test('live charts never substitute reference simulation history', async () => {
    const snapshot = await createSolzDataSource().load()
    const html = renderToStaticMarkup(<HighlightChart market={market} outcome={market.outcomes[0]} snapshot={snapshot} simulation={false} focusOnly collateral="tUSDC" referenceMarket={{ ...market, outcomes: [{ ...market.outcomes[0], priceHistory: [{ at: 1000, probability: .9 }] }] }} onOutcome={() => {}} onMarket={() => {}}/>)
    expect(html).toContain('No trades recorded yet.')
    expect(html).not.toContain('90%')
    expect(html).not.toContain('COOLA Vol.')
  })
  test('a single trade is explained without fabricated volume', async () => {
    const snapshot = await createSolzDataSource().load()
    const traded = { ...market, outcomes: [{ ...market.outcomes[0], priceHistory: [{ at: 120000, probability: .55 }] }] }
    const html = renderToStaticMarkup(<HighlightChart market={traded} outcome={traded.outcomes[0]} snapshot={snapshot} simulation={false} focusOnly collateral="tUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
    expect(html).toContain('One trade recorded.')
    expect(html).toContain('tUSDC trade history')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('COOLA Vol.')
  })
})

test('quote overview includes every observed market even without a single fill', async () => {
  const snapshot = await createSolzDataSource().load()
  const outcomes = ['COKE', 'PEPSI', 'SPRITE', 'DR PEPPER'].map((label, index) => ({ ...market.outcomes[0], id: label, label, priceHistory: [], quoteHistory: [{ at: 1000, probability: .1 + index * .1 }, { at: 2000, probability: .15 + index * .1 }] }))
  const html = renderToStaticMarkup(<HighlightChart market={{ ...market, outcomes }} outcome={outcomes[0]} snapshot={snapshot} simulation={false} collateral="tUSDC" onOutcome={() => {}} onMarket={() => {}}/>)
  for (const label of ['COKE', 'PEPSI', 'SPRITE', 'DR PEPPER']) expect(html).toContain(label)
  expect(html).toContain('quote observations')
  expect(html).not.toContain('No quotes recorded yet.')
  expect((html.match(/vector-effect="non-scaling-stroke"/g) ?? []).length).toBe(4)
})
