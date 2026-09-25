import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { isGeneralEventId, isStockEventId, parseGeneralEventPrices } from '../src/components/events/generalEventPrices'
import { LivePreStocksChart, StockMeasureView, livePreStocksChartUrl } from '../src/components/events/StockMeasurePanel'
import { MarketCard, type DirectoryRow } from '../src/components/markets/MarketsDirectoryApp'
import { parseMarketList } from '../src/components/markets/marketList'
import { reservedSolanaView, type ReservedSolanaQuestion } from '../src/components/home/solanaQuestionMarkets'

const START = Date.parse('2026-09-28T00:00:00Z') / 1000
const q = (n: number) => `0x515545530102${n.toString(16).padStart(52, '0')}`
const candidate = (symbol: string, n: number, returnMicros: number | null, verdict: string | null = null) => ({
  symbol, pool: `pool${n}`, questionId: q(n),
  points: [[START - 3600, 100], [START + 86_400, 100 * (1 + (returnMicros ?? 0) / 1e6)]],
  start: { t: START - 3600, c: 100 }, latest: returnMicros === null ? null : { t: START + 86_400, c: 100 * (1 + returnMicros / 1e6) },
  returnMicros, verdict,
})
const body = (overrides: Record<string, unknown> = {}) => ({
  eventId: 'general-stocks-top-return-2026-09-28-3w', status: 'ready', asOf: '2026-09-29T00:00:00.000Z',
  rule: { kind: 'top-return', version: 'stock-top-return/v1', windowStart: '2026-09-28T00:00:00.000Z', windowEnd: '2026-10-19T00:00:00.000Z', maxStalenessHours: 72, tiePolicy: 'all-leaders-yes' },
  candidates: [candidate('ANTHROPIC', 1, 25_000), candidate('SPACEX', 2, 120_000), candidate('KALSHI', 3, null)],
  evidence: null, ...overrides,
})

test('only general ids read the one-page catalogue, and only stock ids ask for prices', () => {
  expect(isGeneralEventId('general-stocks-top-return-2026-09-28-3w')).toBe(true)
  expect(isGeneralEventId('lazy-534f4c5a0101')).toBe(true)
  expect(isGeneralEventId('arena-534f4c5a0101')).toBe(false)
  expect(isGeneralEventId('0x534f4c5a0101')).toBe(false)
  expect(isStockEventId('general-agent-anthropic-2026-10-19')).toBe(true)
  expect(isStockEventId('lazy-534f4c5a0101')).toBe(false)
})

test('a body that cannot be read whole is refused rather than half drawn', () => {
  expect(parseGeneralEventPrices(body()).candidates).toHaveLength(3)
  expect(() => parseGeneralEventPrices(body({ status: 'maybe' }))).toThrow()
  expect(() => parseGeneralEventPrices(body({ rule: { kind: 'top-return', windowStart: 'soon' } }))).toThrow()
  expect(() => parseGeneralEventPrices(body({ candidates: [{ symbol: 'X' }] }))).toThrow()
})

test('loading keeps the loaded shape: a chart block and one row per candidate', () => {
  const html = renderToStaticMarkup(<StockMeasureView state={{ phase: 'loading' }}/>)
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('sm-sk-chart')
  expect(html.match(/sm-sk-row/g)).toHaveLength(8)
  expect(html).toContain('Reading measured prices')
  expect(renderToStaticMarkup(<StockMeasureView state={{ phase: 'absent' }}/>)).toBe('')
})

test('candidates are ranked by measured return, and a missing price is said, not zeroed', () => {
  const html = renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices: parseGeneralEventPrices(body()) }}/>)
  expect(html.indexOf('SPACEX')).toBeLessThan(html.indexOf('ANTHROPIC'))
  expect(html).toContain('+12.00%')
  expect(html).toContain('+2.50%')
  expect(html).toContain('no price yet')
  expect(html).toContain('every tied leader resolves Yes')
  // Measurements, not odds: no Buy or Sell control, no probability.
  expect(html).not.toContain('Buy')
})

test('live chart uses a validated frozen Solana pool and is its own tab, not part of the measured view', () => {
  const pool = '4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH'
  expect(livePreStocksChartUrl(pool)).toContain(`/solana/pools/${pool}?embed=1`)
  expect(livePreStocksChartUrl('https://wrong.example')).toBeNull()
  const prices = parseGeneralEventPrices(body({ candidates: [{ ...candidate('OPENAI', 1, 20_000), pool }] }))
  expect(renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices }}/>)).not.toContain('<iframe')
  expect(renderToStaticMarkup(<LivePreStocksChart prices={prices}/>)).toContain(`src="https://www.geckoterminal.com/solana/pools/${pool}?embed=1`)
})

test('a resolved event names what was paid and shows its evidence hash', () => {
  const prices = parseGeneralEventPrices(body({
    candidates: [candidate('ANTHROPIC', 1, 25_000, 'NO'), candidate('SPACEX', 2, 120_000, 'YES')],
    evidence: { hash: 'f'.repeat(64), leaders: ['SPACEX'] },
  }))
  const html = renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices }}/>)
  expect(html).toContain('Resolved Yes')
  expect(html).toContain('Resolved No')
  expect(html).toContain('ffffffffffffffff…')
})

test('the agent question shows its frozen band and whether the price is inside it', () => {
  const prices = parseGeneralEventPrices({
    eventId: 'general-agent-anthropic-2026-10-19', status: 'ready', asOf: '2026-09-29T00:00:00.000Z',
    rule: { kind: 'agent-band', at: '2026-10-19T00:00:00.000Z', madeAt: '2026-09-25T10:00:00.000Z', low: 942.01, high: 1356.5, center: 1130.41, lastClose: 1030.09, model: 'baseline-drift/v1', maxStalenessHours: 72 },
    candidates: [{ ...candidate('ANTHROPIC', 1, null), latest: { t: START, c: 1034.5 } }], evidence: null,
  })
  const html = renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices }}/>)
  expect(html).toContain('Agent forecast')
  expect(html).toContain('$942.01')
  expect(html).toContain('$1,356.50')
  expect(html).toContain('inside the band')
})

test('OpenAI threshold shows the exact answer being judged', () => {
  const above = parseGeneralEventPrices({
    ...body(), eventId: 'general-stocks-openai-above-2026-09-30-1400',
    rule: { kind: 'above', version: 'stock-above/v1', at: '2026-10-01T00:00:00.000Z', thresholdUsd: 1400, thresholdBasis: 'display-unit', displayMultiplier: 1.4861347, maxStalenessHours: 72 },
    candidates: [candidate('OPENAI', 1, 0)],
  })
  expect(renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices: above }}/>)).toContain('strictly above <b>$1,400.00</b>')
})

test('linked OpenAI question renders all five above-price options', () => {
  const pool = '4HTy7aTjPm5PTSEws2yWRDPX6gjWM6sC2dV5mv9u8JsH'
  const candidates = [1225, 1275, 1350, 1425, 1475].map((thresholdUsd, index) => ({
    ...candidate('OPENAI', index + 1, 0), pool, thresholdUsd,
    points: index === 0 ? [[START - 3600, 2000], [START, 2100]] : [],
    latest: { t: START, c: 2100 }, verdict: null,
  }))
  const prices = parseGeneralEventPrices(body({ eventId: 'general-stocks-openai-above-2026-09-30',
    rule: { kind: 'above-ladder', at: '2026-10-01T00:00:00.000Z', displayMultiplier: 1.5,
      thresholdBasis: 'display-unit', maxStalenessHours: 72 }, candidates }))
  const html = renderToStaticMarkup(<StockMeasureView state={{ phase: 'loaded', prices }}/>)
  for (const strike of [1225, 1275, 1350, 1425, 1475]) expect(html).toContain(`Above $${strike.toLocaleString()}.00`)
  expect(html).toContain('Each row is a separate YES/NO market')
  expect(html).toContain('Current measured price: <b>$1,400.00</b>')
  expect(html.match(/<li(?:\s|>)/g)).toHaveLength(5)
})

test('the catalogue carries a stock topic and a settled answer through to the directory card', () => {
  const matchId = `0x534f4c5a01017620${START.toString(16).padStart(16, '0')}${'ab'.repeat(16)}`
  const parsed = parseMarketList({ items: [{
    kind: 'general', eventId: 'general-stocks-top-return-2026-09-28-3w', matchId, questionId: q(2), status: 'resolved',
    title: 'Will SPACEX gain the most among PreStocks from Sep 28 to Oct 19?', eventType: 'general', hasHumans: false,
    tradeLocksAt: '2026-10-19T00:00:00.000Z', outcomes: [{ id: 'YES', label: 'Yes' }, { id: 'NO', label: 'No' }],
    category: 'stocks', resolution: { source: 'approved-general-oracle', status: 'resolved', winner: 'YES' },
  }] })
  expect(parsed.items[0]).toMatchObject({ category: 'stocks', resolution: { status: 'resolved', winner: 'YES' } })
  const question: ReservedSolanaQuestion = {
    eventId: 'general-stocks-top-return-2026-09-28-3w', matchId, questionId: q(2), marketId: q(2),
    label: 'Will SPACEX gain the most among PreStocks from Sep 28 to Oct 19?', outcomes: ['Yes', 'No'],
    scheduledStartAt: new Date(START * 1000).toISOString(), status: 'live',
  }
  const { match, market } = reservedSolanaView(question, START * 1000)
  const row: DirectoryRow = { match, market, title: market.title, kind: 'general', eventType: 'general', category: 'stocks' }
  expect(renderToStaticMarkup(<MarketCard row={row} now={START * 1000}/>)).toContain('PRESTOCKS · OUR VENUE')
})
