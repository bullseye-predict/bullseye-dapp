import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EventMarkets } from '../src/components/events/EventMarkets'
import { OutcomeRow } from '../src/components/markets/OutcomeRow'
import { outcomeMovement } from '../src/components/markets/marketMovement'
import { isMoneyline, marketLineTitle, pickColor } from '../src/components/markets/moneyline'
import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../src/components/solz/model'

const snapshot = { agents: [], teams: [], matches: [], markets: [], updatedAt: 0 } as unknown as SolzSnapshot

const outcome = (over: Partial<ArenaMarketOutcome> & { id: string; label: string }): ArenaMarketOutcome => ({
  detail: '', probability: .5, priceHistory: [], ...over,
})

const linkedMarket = (id: string, label: string, probability: number, extra: Partial<ArenaMarket> = {}): ArenaMarket => ({
  id, matchId: 'event-1', kind: 'match-winner', title: 'Which agent wins?', description: '', status: 'open',
  closesAt: 1, volume: { SOL: 0, COOLA: 0 },
  outcomes: [outcome({ id: 'yes', label: 'Yes', probability }), outcome({ id: 'no', label: 'No', probability: 1 - probability })],
  rules: '',
  presentation: { kind: 'linked', eventTitle: 'Which agent wins?', answer: { label }, outcomes: [{ id: 0, label: 'Yes' }, { id: 1, label: 'No' }] },
  ...extra,
})

/** Just the row summaries — the collapsed detail panel below each one is
 *  PredictionDetail's, and keeps its own wording on purpose. */
const rows = (html: string) => html.split(/<div class="mk-row-summary[^"]*">/).slice(1)
  .map((part) => part.split('<div id=')[0]!).join('\n')

const render = (markets: ArenaMarket[]) => renderToStaticMarkup(
  <EventMarkets
    markets={markets} market={markets[0]!} outcome={markets[0]!.outcomes[0]!} snapshot={snapshot}
    onSelect={() => {}} predictionHref={() => '#'} simulation={false} collateral="fUSDC"
  />,
)

test('a linked answer list renders one shared row per answer, with a percentage chance', () => {
  const html = render([linkedMarket('q1', 'GENESIS-01', .5), linkedMarket('q2', 'GENESIS-02', .875)])
  expect(html).toContain('Choose your answer')
  // The shared row, not one of the five hand-written copies it replaced.
  expect(html).toContain('mk-row-summary')
  expect(html).toContain('mk-row-chance')
  expect(html).not.toContain('ev-answer-summary')
  expect(html).not.toContain('ev-answer-picks')
  expect(html).toContain('GENESIS-01')
  expect(html).toContain('GENESIS-02')
  // Chance is a distribution over the field, not each book's own price:
  // .5 and .875 normalise to 36% and 64%, which total 100%.
  expect(html).toContain('36%')
  expect(html).toContain('64%')
  expect(html).not.toContain('¢ bid')
  // The deep-link target the portfolio and the market rail rely on.
  expect(html).toContain('id="event-q1"')
})

test('an unopened Solana market shows the neutral placeholder, never OPEN or No asks', () => {
  const onchain = { family: 'SOLANA' } as ArenaMarket['onchain']
  const indicative = linkedMarket('q1', 'GENESIS-01', .5, { onchain })
  indicative.outcomes = indicative.outcomes.map((item) => ({ ...item, indicative: true }))
  // A book that exists but has no resting ask: the other "failure-looking" state.
  const bidOnly = linkedMarket('q2', 'GENESIS-02', .5, { onchain })
  bidOnly.outcomes = bidOnly.outcomes.map((item) => ({ ...item, marketQuote: { bid: .5 } }))
  const summary = rows(render([indicative, bidOnly]))
  // Both the chance cell and both pick buttons, on both rows.
  // One chance cell per row + both pick buttons on the unopened row.
  expect(summary.match(/--/g)?.length).toBeGreaterThanOrEqual(4)
  expect(summary).not.toContain('%')
  // Nothing moved, so no chip is stacked under the placeholder.
  expect(summary).not.toContain('mk-row-move')
  expect(summary).not.toContain('OPEN')
  expect(summary).not.toContain('No asks')
})

test('rows carry no accordion chevron but still expose the panel', () => {
  const html = render([linkedMarket('q1', 'GENESIS-01', .5), linkedMarket('q2', 'GENESIS-02', .5)])
  expect(rows(html)).not.toContain('lucide-chevron-down')
  expect(html).toContain('aria-controls="event-q1-panel"')
  expect(html).toContain('aria-expanded="false"')
})

test('a moneyline is named by its line and colours both sides by team; a linked market does neither', () => {
  const moneyline: ArenaMarket = {
    id: 'h2h', matchId: 'event-2', kind: 'match-winner', title: 'Who will win: JUP or ANSEM?',
    description: '', status: 'open', closesAt: 1, volume: { SOL: 0, COOLA: 0 },
    outcomes: [
      outcome({ id: 'yes', label: 'JUP', teamId: 'team-jup', color: '#3fdcff' }),
      outcome({ id: 'no', label: 'ANSEM', teamId: 'team-ansem', color: '#ff7a1a' }),
    ],
    rules: '',
    presentation: { kind: 'head-to-head', eventTitle: 'JUP vs ANSEM', outcomes: [{ id: 0, label: 'JUP' }, { id: 1, label: 'ANSEM' }] },
  }
  expect(isMoneyline(moneyline)).toBe(true)
  expect(marketLineTitle(moneyline)).toBe('Moneyline')
  expect(pickColor(moneyline, moneyline.outcomes[0]!, snapshot, 0)).toBe('#3fdcff')
  expect(pickColor(moneyline, moneyline.outcomes[1]!, snapshot, 1)).toBe('#ff7a1a')

  const html = renderToStaticMarkup(
    <EventMarkets
      markets={[moneyline]} market={moneyline} outcome={moneyline.outcomes[0]!} snapshot={snapshot}
      onSelect={() => {}} predictionHref={() => '#'} simulation={false} collateral="fUSDC"
    />,
  )
  const summary = rows(html)
  // A moneyline is two sides of one question, not a field of mutually
  // exclusive answers, so it carries no chance column at all.
  expect(html).not.toContain('mk-row-chance')
  // The summary grid collapses rather than leaving an inert middle column.
  expect(html).toContain('is-priceless')
  expect(summary).toContain('Moneyline')
  expect(summary).not.toContain('Who will win: JUP or ANSEM?')
  expect(summary).toContain('--pick-color:#3fdcff')
  expect(summary).toContain('--pick-color:#ff7a1a')

  // A multi-answer market keeps the green/red pair; identity stays on the text.
  const linked = linkedMarket('q1', 'GENESIS-01', .5)
  expect(isMoneyline(linked)).toBe(false)
  expect(marketLineTitle(linked)).toBe('Which agent wins?')
  expect(pickColor(linked, linked.outcomes[0]!, snapshot, 0)).toBeUndefined()
})

test('market movement is typed, and an indicative seed never reads as a move', () => {
  expect(outcomeMovement(outcome({ id: 'a', label: 'A', probability: .5, indicative: true })))
    .toEqual({ text: '--', direction: 'flat' })
  expect(outcomeMovement(outcome({ id: 'a', label: 'A', probability: .5 })))
    .toEqual({ text: '--', direction: 'flat' })
  expect(outcomeMovement(outcome({
    id: 'a', label: 'A', probability: .62,
    priceHistory: [{ at: 1, probability: .5 }, { at: 2, probability: .62 }],
  })).direction).toBe('up')
  // Both ends come from one series: the live probability is never differenced
  // against a point from the other one.
  expect(outcomeMovement(outcome({
    id: 'a', label: 'A', probability: .9,
    priceHistory: [{ at: 1, probability: .5 }, { at: 2, probability: .5 }],
  })).direction).toBe('flat')
  // Quotes are the fallback series: a dormant book produces nothing else.
  expect(outcomeMovement(outcome({
    id: 'a', label: 'A', probability: .4, priceHistory: [],
    quoteHistory: [{ at: 1, probability: .5 }, { at: 2, probability: .4 }],
  })).direction).toBe('down')
})

test('a topic row with no price and no controls spans the whole grid', () => {
  const html = renderToStaticMarkup(
    <OutcomeRow id="topic" title="Match winner" subtitle="0 fUSDC Vol." picks={[]}/>,
  )
  // No inert chance or picks columns beside it: the title owns the full width,
  // so the whole row stays clickable.
  expect(html).toContain('is-headline')
  expect(html).not.toContain('mk-row-chance')
  expect(html).not.toContain('mk-row-picks')
})
