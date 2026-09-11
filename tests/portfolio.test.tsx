import { describe, expect, test } from 'bun:test'
import { positionState, isClosedPosition } from '../src/components/portfolio/model'
import { portfolioRows, Portfolio } from '../src/components/portfolio/PortfolioApp'
import type { PortfolioMarket } from '../src/components/portfolio/usePortfolio'
import { renderToStaticMarkup } from 'react-dom/server'
const market = { isResolved: false, isVoided: false, winningOutcome: 0, status: 1 }
const state = (overrides = {}, outcome: 0 | 1 = 0, quantity = 1n, now = 2000) => positionState({ ...market, ...overrides }, outcome, quantity, now, 1000, 3000)

describe('portfolio settlement and ownership presentation', () => {
  test('default winner field cannot unlock claims before settlement', () => {
    expect(state()).toBe('Trading')
    expect(state({}, 0, 1n, 3000)).toBe('Awaiting result')
    expect(state({}, 0, 1n, 999)).toBe('Awaiting result')
    expect(state({ status: 2 })).toBe('Awaiting result')
  })
  test('only held winning shares or voided shares can be claimed', () => {
    expect(state({ isResolved: true }, 0)).toBe('Claim winnings')
    expect(state({ isResolved: true }, 1)).toBe('Lost')
    expect(state({ isVoided: true }, 1)).toBe('Claim refund')
    expect(state({ isResolved: true }, 0, 0n)).toBe('Closed')
    expect(isClosedPosition(state({ isResolved: true }, 0))).toBe(false)
    expect(isClosedPosition(state({ isResolved: true }, 1))).toBe(true)
  })
  test('never invent closed holdings for an account with no history', () => {
    const entry = { binding: { marketId: 'one', tradingStartsAt: 1000, tradingLocksAt: 3000 }, snapshot: { balances: [0n, 0n, 0n], orders: [], market, now: 2000 }, participated: false } as unknown as PortfolioMarket
    expect(portfolioRows([entry])).toEqual([])
    expect(portfolioRows([{ ...entry, participated: true }])[0].state).toBe('Closed')
    const reserved = { ...entry, snapshot: { ...entry.snapshot, orders: [{}] } } as PortfolioMarket
    expect(isClosedPosition(portfolioRows([reserved])[0].state)).toBe(false)
  })
  test('a sold outcome appears in Closed while the other outcome stays active', () => {
    const entry = { binding: { marketId: 'one', tradingStartsAt: 1000, tradingLocksAt: 3000 }, snapshot: { balances: [0n, 12n, 0n], orders: [], market, now: 2000 }, historicalOutcomes: [0, 1] } as unknown as PortfolioMarket
    expect(portfolioRows([entry]).map(row => [row.outcome, row.state])).toEqual([[0, 'Trading'], [1, 'Closed']])
  })
  test('settled winners remain active until their shares are redeemed', () => {
    const entry = { binding: { marketId: 'one', tradingStartsAt: 1000, tradingLocksAt: 3000 }, snapshot: { balances: [0n, 12n, 4n], orders: [], market: { ...market, isResolved: true }, now: 4000 } } as unknown as PortfolioMarket
    const rows = portfolioRows([entry])
    expect(rows.map(row => row.state)).toEqual(['Claim winnings', 'Lost'])
    expect(rows.map(row => row.quantity)).toEqual([12n, 4n])
  })
  test('signed-out page asks for the owning wallet and does not present fake balances', () => {
    const html = renderToStaticMarkup(<Portfolio apiUrl="" wallet={null} walletControl={<button>Connect wallet</button>}/>)
    expect(html).toContain('Make this portfolio yours.')
    expect(html).toContain('href="/profile"')
    expect(html).not.toContain('Confirm sell')
    expect(html).not.toContain('Confirm claim')
    expect(html).not.toContain('$0.00')
  })
})

import { canonicalMatchId, matchGlyph, matchLabel } from '../src/components/portfolio/matchIdentity'
import { accountCashFlow, cumulativeFlows } from '../src/components/portfolio/cashFlow'
import { marketLifecycle } from '../src/components/portfolio/model'
import { PortfolioChart, chartMarket } from '../src/components/portfolio/PortfolioChart'

describe('portfolio match identity, escrow and chart', () => {
  test('identicons match canonical hex and arena IDs and vary by match', () => {
    expect(matchGlyph('arena-ABC123')).toEqual(matchGlyph('0xabc123'))
    expect(matchGlyph('arena-ABC123')).not.toEqual(matchGlyph('arena-ABC124'))
    expect(canonicalMatchId('arena-ABC123')).toBe('abc123')
    expect(matchLabel('arena-abc123', 1000, { matchId: '0xabc123', matchNumber: 42 })).toBe('MATCH #42')
    expect(matchLabel('arena-abc123', 1000)).not.toContain('MATCH #')
  })
  test('finished market escrow is never an active holding', () => {
    const entry = { binding: { marketId: 'one', tradingStartsAt: 1000, tradingLocksAt: 3000 }, snapshot: { balances: [0n, 0n, 0n], orders: [{}], market: { ...market, isResolved: true }, now: 4000 } } as unknown as PortfolioMarket
    expect(portfolioRows([entry]).map(row => row.state)).toEqual(['Orders'])
    expect(marketLifecycle(entry.snapshot.market, 4000, 3000)).toBe('Resolved · YES won')
    expect(marketLifecycle(market, 4000, 3000)).toBe('Trading ended · awaiting oracle')
  })
  test('NO trades use complementary execution prices and only the owning wallet', () => {
    const row = { id: 'f1', kind: 'TRADE', timestamp: '1000', maker: '0xabc', makerSide: 'SELL_NO', taker: '0xdef', takerSide: 'BUY_NO', quantity: '2000000', fillPrice: '400000' }
    expect(accountCashFlow(row, '0xABC', 6)?.amount).toBe(1200000n)
    expect(accountCashFlow(row, '0xdef', 6)?.amount).toBe(-1200000n)
    expect(accountCashFlow(row, '0xother', 6)).toBeNull()
    expect(() => accountCashFlow({ ...row, makerSide: null }, '0xabc', 6)).toThrow('incomplete')
  })
  test('history pagination duplicates never double count the chart', () => {
    expect(cumulativeFlows([{ id: 'b', at: 2, amount: 5n }, { id: 'a', at: 1, amount: -3n }, { id: 'b', at: 2, amount: 5n }]).map(p => p.balance)).toEqual([-3n, 2n])
  })
  test('chart renders indexed flows and never fabricates a P&L graph', () => {
    const entry = { snapshot: { market: { decimals: 6 }, now: 2000 }, cashFlows: [{ id: 'a', at: 1000, amount: -500000n }, { id: 'b', at: 2000, amount: 750000n }] } as unknown as PortfolioMarket
    const html = renderToStaticMarkup(<PortfolioChart markets={[chartMarket(entry)]} connected loading={false} symbol="tUSDC" unavailable={false}/>)
    expect(html).toContain('0.25 tUSDC')
    expect(html).toContain('Net trade flow')
    expect(html).toContain('not profit/loss')
    const incomplete = renderToStaticMarkup(<PortfolioChart markets={[chartMarket({ ...entry, historyLimited: true })]} connected loading={false} symbol="tUSDC" unavailable={false}/>)
    expect(incomplete).toContain('cannot be calculated reliably')
    expect(incomplete).not.toContain('0.25 tUSDC')
  })
})

test('the same match has one kickoff label even when questions open at different times', () => {
  const id = 'arena-534f4c5a01010014000000006aa3f28a06b1b78b0d46bc80dad11e55aae5e731'
  expect(matchLabel(id, 1789129354000)).toBe(matchLabel(id, 1789129954000))
})


test('chart props are JSON-safe while financial amounts preserve integer precision', () => {
  const amount = 123456789012345678901234567890n
  const entry = { snapshot: { market: { decimals: 18 }, now: 1000, balances: [1n, 2n, 3n] }, cashFlows: [{ id: 'x', at: 1000, amount }] } as unknown as PortfolioMarket
  const payload = chartMarket(entry)
  expect(() => JSON.stringify(payload)).not.toThrow()
  expect(BigInt(payload.cashFlows[0].amount)).toBe(amount)
})
