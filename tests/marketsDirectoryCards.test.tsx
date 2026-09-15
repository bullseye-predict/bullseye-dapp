import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarketCard, type DirectoryRow } from '../src/components/markets/MarketsDirectoryApp'
import { reservedSolanaView, type ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'
import type { ArenaMarket, SolzMatch } from '../src/components/solz/model'

const team = (symbol: string, color: string) => ({ teamId: `team-${symbol}`, symbol, name: symbol, glyph: symbol, color, score: 0, agentIds: ['a1'] })
const baseMatch = (teams: SolzMatch['teams']): SolzMatch => ({
  id: `match-${teams.length}`, displayMatchId: 'ARENA', kind: 'highlight', mode: 'DEATHMATCH', map: 'GENESIS ARENA',
  round: 'MATCH LIVE', phase: 'live', startedAt: 0, endsAt: 1, timingEstimated: false, viewers: 1200,
  marketId: 'market-1', volume: { SOL: 0, COOLA: 4200 }, teams, roster: [],
})
const market = (probabilities: number[], teams: SolzMatch['teams']): ArenaMarket => ({
  id: 'market-1', matchId: 'match', kind: 'match-winner', title: 'Who wins?', description: '', status: 'open',
  closesAt: 1, volume: { SOL: 0, COOLA: 4200 },
  outcomes: probabilities.map((probability, index) => ({ id: `o${index}`, label: teams[index].symbol, detail: '', probability, teamId: teams[index].teamId, priceHistory: [] })),
  rules: '',
})

test('two teams render one head-to-head bar carrying both shares', () => {
  const teams = [team('COKE', '#ff0000'), team('PEPSI', '#0000ff')]
  const row: DirectoryRow = { match: baseMatch(teams), market: market([0.7, 0.3], teams), title: 'COKE VS PEPSI' }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).toContain('mk-card--versus')
  expect(html).toContain('COKE VS PEPSI')
  expect(html).toContain('70%')
  expect(html).toContain('30%')
  expect(html).toContain('mk-split')
  // The other two shapes must not leak into a head-to-head.
  expect(html).not.toContain('mk-ffa')
  expect(html).not.toContain('mk-binary')
})

test('more than two teams render a ranked field, highest first, with the tail counted', () => {
  const teams = [team('A', '#111'), team('B', '#222'), team('C', '#333'), team('D', '#444'), team('E', '#555'), team('F', '#666')]
  const row: DirectoryRow = { match: baseMatch(teams), market: market([0.1, 0.05, 0.4, 0.2, 0.15, 0.1], teams), title: '6-TEAM FREE FOR ALL' }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).toContain('mk-card--ffa')
  expect(html).toContain('6-TEAM FREE FOR ALL')
  expect(html).not.toContain('mk-split')
  // Ranked: C (40%) leads and E/F are collapsed into the count, not shown.
  expect(html.indexOf('>C<')).toBeLessThan(html.indexOf('>D<'))
  expect(html).toContain('6 teams · 2 more')
})

test('a standalone question renders YES/NO instead of any team layout', () => {
  const question: ReservedSolanaQuestion = {
    eventId: 'lazy-534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    matchId: '0x534f4c5a0101ffff000000006aa72600daad32dfabd66ab7d4e7cfbe6ef0fc81',
    questionId: '0x515545530102686967686573742d6b696c6c2d6167656e742d736561736f6e2d',
    marketId: 'Fof6MKW3arFMnmFPe8gnXymAYTgdFVVrdQofqBx6c5Bx',
    label: 'Which agent finishes Season 01 with the most kills? (SPRITE)',
    outcomes: ['YES', 'NO'], scheduledStartAt: '2026-09-13T22:38:56.000Z', status: 'live',
  }
  const { match, market: questionMarket } = reservedSolanaView(question, Date.now())
  const html = renderToStaticMarkup(<MarketCard row={{ match, market: questionMarket, title: questionMarket.title, status: 'LIVE NOW' }} now={Date.now()}/>)
  expect(html).toContain('mk-card--question')
  expect(html).toContain('most kills')
  expect(html).toContain('is-yes')
  expect(html).toContain('is-no')
  expect(html).toContain('YES')
  expect(html).toContain('NO')
  expect(html).not.toContain('mk-versus')
  expect(html).not.toContain('mk-ffa')
  // It must link to its own event page so the directory can open it.
  expect(html).toContain(`href="/events/${question.eventId}"`)
})

test('a single-team match uses the ranked field, not a lopsided head-to-head', () => {
  const teams = [team('GENESIS', '#c7ff00')]
  const html = renderToStaticMarkup(<MarketCard row={{ match: baseMatch(teams), market: market([1], teams), title: 'GENESIS' }} now={0}/>)
  expect(html).toContain('mk-card--ffa')
  expect(html).not.toContain('mk-split')
})

// A missing market is not evidence of a certain winner, even with one team.
test('unpriced arena cards never manufacture odds from team count', () => {
  const row: DirectoryRow = { match: baseMatch([team('GENESIS', '#c7ff00')]) }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).not.toContain('100%')
  expect(html).toContain('—')
})

test('unpriced head-to-head cards do not draw fabricated split odds', () => {
  const row: DirectoryRow = { match: baseMatch([team('A', '#111'), team('B', '#222')]) }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).not.toContain('50%')
  expect(html).not.toContain('mk-split')
})
