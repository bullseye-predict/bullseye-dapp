import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarketCard, sortMarketRows, type DirectoryRow } from '../src/components/markets/MarketsDirectoryApp'
import { reservedSolanaView, type ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'
import type { ArenaMarket, SolzMatch } from '../src/components/solz/model'
import { eventTimingLabel } from '../src/components/events/eventTiming'

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

test('a single-team match is a field, not a lopsided head-to-head or a field of one', () => {
  const teams = [team('GENESIS', '#c7ff00')]
  const html = renderToStaticMarkup(<MarketCard row={{ match: baseMatch(teams), market: market([1], teams), title: 'GENESIS' }} now={0}/>)
  expect(html).toContain('mk-card--ffa')
  expect(html).not.toContain('mk-split')
  // One side has nothing to rank against, so it gets no row and no bar - and a
  // lone side priced at 1 is certainty the market never established.
  expect(html).not.toContain('mk-ffa-row')
  expect(html).not.toContain('100%')
})

// A missing market is not evidence of a certain winner, even with one team.
test('unpriced arena cards never manufacture odds from team count', () => {
  const row: DirectoryRow = { match: baseMatch([team('GENESIS', '#c7ff00')]) }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).not.toContain('100%')
  // Neither a fabricated price nor an empty bar standing in for one.
  expect(html).not.toContain('mk-ffa-bar')
})

test('unpriced head-to-head cards do not draw fabricated split odds', () => {
  const row: DirectoryRow = { match: baseMatch([team('A', '#111'), team('B', '#222')]) }
  const html = renderToStaticMarkup(<MarketCard row={row} now={0}/>)
  expect(html).not.toContain('50%')
  expect(html).not.toContain('mk-split')
})

test('event timing always carries the number or an explicit terminal state', () => {
  const match = baseMatch([team('A', '#111'), team('B', '#222')])
  expect(eventTimingLabel({ ...match, phase: 'countdown', startedAt: 125_000 }, 0)).toBe('STARTS IN 02:05')
  expect(eventTimingLabel({ ...match, phase: 'live', endsAt: 65_000, timingType: 'countdown' }, 5_000)).toBe('LIVE · 01:00 LEFT')
  expect(eventTimingLabel({ ...match, phase: 'live', endsAt: 2 * 86_400_000 + 3 * 3_600_000, timingType: 'countdown' }, 0)).toBe('LIVE · 2D 3H LEFT')
  expect(eventTimingLabel({ ...match, phase: 'settled', round: 'RESULT PENDING', endsAt: 65_000 }, 70_000)).toBe('FINISHED · RESULT PENDING')
  expect(eventTimingLabel({ ...match, phase: 'settled', round: 'CANCELLED' }, 70_000)).toBe('CANCELLED')
  expect(eventTimingLabel({ ...match, phase: 'countdown', startedAt: 1_000, endsAt: 2_000, timingType: 'countdown' }, 3_000)).toBe('FINISHED · RESULT PENDING')
})

test('a finished off-chain card cannot still claim it opens on first trade', () => {
  const match = { ...baseMatch([team('A', '#111'), team('B', '#222')]), phase: 'countdown' as const, startedAt: 1_000, endsAt: 2_000, timingType: 'countdown' as const }
  const html = renderToStaticMarkup(<MarketCard row={{ match, opened: false, collateral: 'fUSDC' }} now={3_000}/>)
  expect(html).toContain('FINISHED · RESULT PENDING')
  expect(html).toContain('OFF-CHAIN · NEVER OPENED')
  expect(html).not.toContain('OPENS ON FIRST TRADE')
})

test('Genesis FFA cards show the numbered event, event type and agent portraits', () => {
  const match = { ...baseMatch([]), id: 'genesis-event', phase: 'countdown' as const, startedAt: 60_000, endsAt: 1_260_000 }
  const linked = (number: number): ArenaMarket => ({
    ...market([.5, .5], [team('YES', '#0f0'), team('NO', '#f00')]), id: `market-${number}`,
    presentation: { kind: 'linked', eventTitle: 'Who will win Genesis Match #351?', answer: { label: `AGENT-${number}`, participantId: `genesis-${String(number).padStart(2, '0')}` }, outcomes: [{ id: 0, label: 'Yes' }, { id: 1, label: 'No' }] },
  })
  const html = renderToStaticMarkup(<MarketCard row={{ match, title: 'Who will win Genesis Match #351?', eventType: 'genesis-ffa', matchNumber: 351, markets: [linked(1), linked(2)] }} now={0}/>)
  expect(html).toContain('GENESIS AGENT FFA')
  expect(html).toContain('MATCH #351')
  expect(html).toContain('Who will win Genesis Match #351?')
  expect(html).toContain('mk-agent-portrait')
})

test('live human matches sort ahead of live automated matches and general markets', () => {
  const row = (id: string, eventType: DirectoryRow['eventType'], hasHumans = false): DirectoryRow => ({
    match: { ...baseMatch([team('A', '#111'), team('B', '#222')]), id }, eventType, hasHumans,
  })
  expect(sortMarketRows([row('general', 'general'), row('bot', 'miaw-prix'), row('human', 'match', true)]).map(item => item.match.id)).toEqual(['human', 'bot', 'general'])
})
