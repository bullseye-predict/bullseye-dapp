import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { consolidate, depthRows, lastExecution, levelPick, OrderBookSkeleton, OrderBookTable } from '../src/components/home/LiveOrderBook'
import { activityRows } from '../packages/adapters/dreamdex/activity'
const asks = [{ price: 100_000n, quantity: 25_000_000n }, { price: 550_000n, quantity: 10_000_000n }]

test('asks display high to low with cumulative totals measured from the best ask', () => {
  expect(depthRows(asks, 'ask', 6).map(row => [row.price, row.total])).toEqual([[550_000n, 8_000_000n], [100_000n, 2_500_000n]])
  const html = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} decimals={6} last={.45} label="YES"/>)
  expect(html.indexOf('55¢')).toBeLessThan(html.indexOf('10¢'))
  expect(html).toContain('Last: 45¢')
  expect(html).toContain('Spread: —')
  expect(html).toContain('No bids')
  expect(html).not.toContain('<select')
})

test('totals read as money and the spread sits in the price column', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[{ price: 90_000n, quantity: 4_000_000n }]} decimals={6} label="YES"/>)
  expect(html).toContain('$8.00')
  expect(html).toContain('$0.36')
  // Last in the side column, Spread in the price column, the rest spanned away.
  expect(html).toContain('<td>Last: \u2014</td><td>Spread: 1\u00a2</td><td colSpan="2">')
})

test('depth bands use each side’s cumulative dollar total rather than price or shares', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={[{ price: 500_000n, quantity: 1_000_000n }, { price: 250_000n, quantity: 1_000_000n }]} bids={[{ price: 500_000n, quantity: 1_000_000n }, { price: 200_000n, quantity: 1_000_000n }]} decimals={6} label="YES"/>)
  expect(html).toContain('style="--depth:33.33%"')
  // Bid and ask groups normalize independently; the 20¢ bid reaches 100%.
  expect(html).toContain('style="--depth:71.42%"')
  expect(html).toContain('style="--depth:100%"')
})

test('a nonzero cumulative level keeps a visible depth floor', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={[{ price: 990_000n, quantity: 1_000_000n }, { price: 10_000n, quantity: 1_000_000n }]} bids={[]} decimals={6} label="YES"/>)
  expect(html).toContain('style="--depth:2%"')
})

test('a loading book retains its table structure and exposes one status message', () => {
  const html = renderToStaticMarkup(<OrderBookSkeleton label="YES"/>)
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('<table class="ch-order-book" aria-hidden="true">')
  expect(html).toContain('class="ch-book-skeleton-row is-ask"')
  expect(html).toContain('class="ch-book-skeleton-row is-bid"')
})

test('a level hands over a price and its sizes, and never a trade direction', () => {
  const rows = depthRows(asks, 'ask', 6)
  // No `side: buy`: clicking a row must not turn the trader around. `quantity`
  // is what rests at the level, `cumulative` what a limit there would sweep.
  expect(levelPick(rows[0], 'ask', 6)).toEqual({ side: 'ask', price: '550000', cents: '55', quantity: '10', cumulative: '35' })
  expect(levelPick(rows[1], 'bid', 6)).toEqual({ side: 'bid', price: '100000', cents: '10', quantity: '25', cumulative: '25' })
  // Both sizes come net of the trader's own depth: they cannot fill themselves.
  const mine = depthRows([{ price: 200_000n, quantity: 5_000_000n, own: 2_000_000n }], 'ask', 6)[0]!
  expect(levelPick(mine, 'ask', 6)).toMatchObject({ quantity: '3', cumulative: '3' })
  // A level entirely the trader's own reports nothing rather than a negative.
  const allMine = depthRows([{ price: 200_000n, quantity: 4_000_000n, own: 4_000_000n }], 'ask', 6)[0]!
  expect(levelPick(allMine, 'ask', 6).cumulative).toBe('0')
  // The exact price travels; the ticket rounds it toward its own side.
  expect(levelPick({ price: 505_000n, quantity: 1_000_000n }, 'ask', 6).cents).toBe('50.5')
})

test('rows are inert without an onPick and named, focusable levels with one', () => {
  const inert = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} decimals={6} label="YES"/>)
  expect(inert).not.toContain('is-pickable')
  expect(inert).not.toContain('tabindex')
  expect(inert).not.toContain('role="grid"')
  const live = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} decimals={6} label="YES" onPick={() => {}} picked="ask:550000"/>)
  expect(live).toContain('is-pickable')
  expect(live).toContain('is-picked')
  expect(live).not.toContain('is-sweep')
  expect(live).toContain('aria-label="Use 55\u00a2 as the limit price. 10 YES resting at this level"')
  // The picked row is the one that was picked, and only that one.
  expect(live.match(/is-picked/g)).toHaveLength(1)
  // One tab stop for the whole book, and it follows the picked level.
  expect(live).toContain('role="grid"')
  expect(live.match(/tabindex="0"/g)).toHaveLength(1)
  expect(live).toContain('aria-selected="true"')
})

test('no executed trade or opposite quote does not fabricate a last price or zero spread', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={[]} bids={[]} decimals={6} label="NO"/>)
  expect(html).toContain('Last: —')
  expect(html).toContain('No asks')
  expect(html).toContain('No bids')
})

// A NO bid at 80¢ is a YES ask at 20¢, reachable through the complete-set route.
// The ticket has always filled against it; these pin the ladder to the same view.
const crossAsk = [{ price: 200_000n, quantity: 132_573_900n }]

test('a price quoted by both books is one level, not two rows sharing a key', () => {
  const merged = consolidate([{ price: 200_000n, quantity: 1_000_000n }], crossAsk)
  expect(merged).toEqual([{ price: 200_000n, quantity: 133_573_900n, cross: 132_573_900n }])
  const html = renderToStaticMarkup(<OrderBookTable asks={[{ price: 200_000n, quantity: 1_000_000n }]} bids={[]} crossAsks={crossAsk} crossLabel="NO" decimals={6} label="YES" onPick={() => {}}/>)
  expect(html.match(/is-ask/g)).toHaveLength(1)
  // Partly routed, so it is not stamped as a wholly cross-book level.
  expect(html).toContain('is-mixed')
  expect(html).not.toContain('is-cross')
})

test('a book whose only depth is on the other outcome is not reported as empty', () => {
  // The GENESIS-01 screenshot: the panel printed "No asks" while the ticket beside
  // it priced YES at 20¢ and filled 132.5739 shares against exactly this bid.
  const html = renderToStaticMarkup(<OrderBookTable asks={[]} bids={[]} crossAsks={crossAsk} crossLabel="NO" decimals={6} label="YES" onPick={() => {}}/>)
  expect(html).not.toContain('No asks')
  expect(html).toContain('20¢')
  expect(html).toContain('132.5739')
  expect(html).toContain('is-cross')
  expect(html).toContain('via NO')
  expect(html).toContain('routed through NO bids')
  // Still one pickable level on the standard path: same sweep, same handoff.
  expect(html).toContain('aria-label="Use 20¢ as the limit price. 132.5739 YES resting at this level. This level is routed through NO bids"')
  expect(html).toContain('No bids')
})

test('the spread measures the best price a trader can reach, whichever book holds it', () => {
  const bids = [{ price: 150_000n, quantity: 1_000_000n }]
  const crossed = renderToStaticMarkup(<OrderBookTable asks={[{ price: 400_000n, quantity: 1_000_000n }]} bids={bids} crossAsks={crossAsk} crossLabel="NO" decimals={6} label="YES"/>)
  // 20¢ from the NO book beats the native 40¢ ask, so the spread is 5¢, not 25¢.
  expect(crossed).toContain('Spread: 5¢')
  // An empty cross ladder leaves a one-sided book one-sided.
  expect(renderToStaticMarkup(<OrderBookTable asks={[]} bids={bids} crossAsks={[]} decimals={6} label="YES"/>)).toContain('Spread: —')
})

test('a complemented half-cent travels exactly, for the ticket to round', () => {
  // A NO bid at 80.5¢ is a YES ask at 19.5¢. The book reports 19.5¢; a buy limit
  // is a ceiling and a sell limit a floor, and only the ticket knows which.
  expect(levelPick({ price: 195_000n, quantity: 1_000_000n }, 'ask', 6).cents).toBe('19.5')
})

test('an unpublished cross ladder renders exactly what it did before', () => {
  // DreamDEX derives noBids from yesAsks, so its complement is already native and
  // it publishes none. Passing an empty ladder must not perturb a single row —
  // the tests above this one are the standing proof that it does not double.
  const bare = renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} decimals={6} last={.45} label="YES"/>)
  expect(renderToStaticMarkup(<OrderBookTable asks={asks} bids={[]} crossAsks={[]} decimals={6} last={.45} label="YES"/>)).toBe(bare)
  expect(bare).not.toContain('is-cross')
})

test('your own resting order stays on the ladder, marked rather than hidden', () => {
  const html = renderToStaticMarkup(<OrderBookTable asks={[{ price: 400_000n, quantity: 5_000_000n, own: 2_000_000n }]} bids={[]} decimals={6} label="YES" onPick={() => {}}/>)
  // Full size drawn: the panel must agree with the order you can see in Activity.
  expect(html).toContain('5')
  expect(html).toContain('is-mine')
  expect(html).toContain('yours')
  expect(html).toContain('Includes your own resting order, which you cannot fill')
  // A level nobody claims carries no marker at all.
  expect(renderToStaticMarkup(<OrderBookTable asks={[{ price: 400_000n, quantity: 5_000_000n }]} bids={[]} decimals={6} label="YES" onPick={() => {}}/>)).not.toContain('is-mine')
})

test('one question cannot report two last prices that do not add up to a dollar', () => {
  // Real executions on two separate books: 84¢ YES at t=2, 90¢ NO at t=1. Read as
  // YES the answer is 84¢; read as NO it must be 16¢, never the raw 90¢.
  const market = { outcomes: [{ priceHistory: [{ at: 2, probability: .84 }] }, { priceHistory: [{ at: 1, probability: .9 }] }] } as never
  expect(lastExecution({}, market, false)).toBeCloseTo(.84, 10)
  expect(lastExecution({}, market, true)).toBeCloseTo(.16, 10)
  // The newer execution wins even when it happened on the other outcome.
  const newerNo = { outcomes: [{ priceHistory: [{ at: 1, probability: .84 }] }, { priceHistory: [{ at: 2, probability: .9 }] }] } as never
  expect(lastExecution({}, newerNo, false)).toBeCloseTo(.1, 10)
  // A venue that publishes its own execution is left alone.
  expect(lastExecution({ last: { yes: .5 } }, market, false)).toBe(.5)
  expect(lastExecution({}, { outcomes: [] } as never, false)).toBeUndefined()
})

test('activity is newest first, correctly inverts NO fills, and excludes another match', () => {
  const base = { market: '0x01', fillPrice: '450000', quantity: '5000000', taker: 'wallet', takerSide: 'BUY_NO' as const, timestamp: '1000', txHash: '0xab' }
  const rows = activityRows('0x01', [{ ...base, id: '10_1' }, { ...base, id: '12_4', txHash: '0xcd' }, { ...base, id: '13_1', market: '0x02' }, { ...base, id: '12_6', txHash: '0xef' }], [])
  expect(rows.map(row => row.id)).toEqual(['fill:12_6', 'fill:12_4', 'fill:10_1'])
  expect(rows[0].label).toBe('Buy NO filled')
  expect(rows[0].detail).toContain('5 shares at 55¢')
})
