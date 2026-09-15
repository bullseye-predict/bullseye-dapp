import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { SolanaProfile } from '../src/components/portfolio/SolanaProfile'
import { instantSellBlocker, sellableShares } from '../src/components/portfolio/instantSell'
import { solanaPositionRows } from '../src/components/portfolio/solanaRows'
import { bootstrap, owner, questions, sol, venue } from './fixtures/profile'
const row = (mutate?: (p: NonNullable<typeof sol.portfolio>) => void) => {
  const portfolio = structuredClone(sol.portfolio!)
  mutate?.(portfolio)
  return solanaPositionRows(portfolio, questions, 6).find(r => r.id === `${questions[0]!.marketId}:0`)!
}
const profile = (isSelf: boolean) => renderToStaticMarkup(
  <SolanaProfile apiUrl="" bootstrap={bootstrap} owner={owner} venue={venue} isSelf={isSelf} questions={questions} sol={sol} retry={0} onRefresh={() => {}} />)
describe('one-click sell', () => {
  test('the position row sells outright instead of opening a panel', () => {
    const html = profile(true)
    expect(html).toContain('>Sell<')
    expect(html).not.toContain('Sell shares')
    expect(html).not.toContain('Review sale')
    expect(html).not.toContain('Minimum price')
    expect(html).not.toContain('Sign &amp; sell')
  })
  test('the button names the size and the bid it will take', () => {
    expect(profile(true)).toContain('Sell 10 shares at 50¢')
  })
  test('a public profile still has no trading controls', () => {
    expect(profile(false)).not.toContain('>Sell<')
  })
  test('counts every share the book will release, never reserved ones', () => {
    expect(sellableShares(row())).toBe(10000000n)
    expect(sellableShares(row(p => {
      const s = p.questions[0]!.outcomes[0]
      s.seatShares = 4000000n
      s.reservedShares = 6000000n
    }))).toBe(4000000n)
  })
  test('refuses to fire when there is nothing to sell into', () => {
    expect(instantSellBlocker(row())).toBe('')
    expect(instantSellBlocker(row(p => { p.questions[0]!.outcomes[0].bestBid = undefined })))
      .toContain('No bid is resting on this book')
    expect(instantSellBlocker(row(p => {
      const s = p.questions[0]!.outcomes[0]
      s.seatShares = 0n
      s.reservedShares = 10000000n
    }))).toContain('reserved by an open sell order')
  })
})
