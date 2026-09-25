import { expect, test } from 'bun:test'
import {
  AGENT_BAND_V1, STOCK_PRICE_SOURCE, STOCK_TOP_RETURN_V1, driftBand, measuredReturns, priceAt, resolveAgentBand, resolveTopReturn,
  type AgentBandRule, type StockCandle, type StockTopReturnRule,
} from './stock-rules'

const H = 3600
const START = 1_790_553_600, END = START + 21 * 86_400
const q = (n: number) => `0x515545530102${n.toString(16).padStart(52, '0')}` as `0x${string}`
const rule: StockTopReturnRule = {
  version: STOCK_TOP_RETURN_V1, category: 'stocks', universe: 'prestocks',
  windowStart: new Date(START * 1000).toISOString(), windowEnd: new Date(END * 1000).toISOString(),
  source: STOCK_PRICE_SOURCE, maxStalenessHours: 72, finalityDelaySeconds: 3600, tiePolicy: 'all-leaders-yes',
  candidates: [
    { symbol: 'AAA', mint: 'mintA', pool: 'poolA', questionId: q(1) },
    { symbol: 'BBB', mint: 'mintB', pool: 'poolB', questionId: q(2) },
    { symbol: 'CCC', mint: 'mintC', pool: 'poolC', questionId: q(3) },
  ],
}
/** A candle that closes exactly at `end` with price `c`. */
const closeAt = (end: number, c: number): StockCandle => ({ t: end - H, c })

test('the price at a boundary is the last candle that closed by then, never one still open', () => {
  const candles = [closeAt(START - 5 * H, 10), closeAt(START, 11), { t: START, c: 99 }]
  expect(priceAt(candles, START, 72)).toEqual(closeAt(START, 11))
  // A quiet pool: the last trade 30 hours earlier still counts...
  expect(priceAt([closeAt(START - 30 * H, 12)], START, 72)?.c).toBe(12)
  // ...but not one older than the staleness bound.
  expect(priceAt([closeAt(START - 73 * H, 12)], START, 72)).toBeNull()
})

test('the best return resolves YES and every other candidate NO', () => {
  const result = resolveTopReturn(rule, {
    AAA: [closeAt(START, 100), closeAt(END, 110)],
    BBB: [closeAt(START, 50), closeAt(END, 60)],
    CCC: [closeAt(START, 10), closeAt(END, 9)],
  })
  expect(result.verdicts.map(v => v.verdict)).toEqual(['NO', 'YES', 'NO'])
  expect(result.evidence).toMatchObject({ leaders: ['BBB'], leaderReturnMicros: 200_000 })
})

test('equal returns are a tie, and every tied leader resolves YES', () => {
  const result = resolveTopReturn(rule, {
    AAA: [closeAt(START, 100), closeAt(END, 120)],
    BBB: [closeAt(START, 50), closeAt(END, 60)],
    CCC: [closeAt(START, 10), closeAt(END, 9)],
  })
  expect(result.verdicts.map(v => v.verdict)).toEqual(['YES', 'YES', 'NO'])
})

test('one candidate with no price at a boundary voids the whole event, never guessing a leader', () => {
  const result = resolveTopReturn(rule, {
    AAA: [closeAt(START, 100), closeAt(END, 200)],
    BBB: [closeAt(START, 50)],
    CCC: [closeAt(START, 10), closeAt(END, 9)],
  })
  expect(result.verdicts.map(v => v.verdict)).toEqual(['VOID', 'VOID', 'VOID'])
  expect(String(result.evidence.void)).toContain('BBB')
})

test('the agent band includes both edges, and a missing price is VOID rather than NO', () => {
  const at = END
  const band: AgentBandRule = {
    version: AGENT_BAND_V1, category: 'stocks', universe: 'prestocks', symbol: 'AAA', mint: 'mintA', pool: 'poolA',
    at: new Date(at * 1000).toISOString(), source: STOCK_PRICE_SOURCE, maxStalenessHours: 72, finalityDelaySeconds: 3600,
    forecast: { model: 'baseline-drift/v1', madeAt: new Date(START * 1000).toISOString(), inputsHash: 'ab'.repeat(32), lastClose: 100, center: 105, low: 95, high: 115 },
    questionId: q(9),
  } as AgentBandRule
  expect(resolveAgentBand(band, [closeAt(at, 95)]).verdicts[0]!.verdict).toBe('YES')
  expect(resolveAgentBand(band, [closeAt(at, 115)]).verdicts[0]!.verdict).toBe('YES')
  expect(resolveAgentBand(band, [closeAt(at, 115.01)]).verdicts[0]!.verdict).toBe('NO')
  expect(resolveAgentBand(band, []).verdicts[0]!.verdict).toBe('VOID')
})

test('the baseline agent is deterministic and its band stays inside the 3-20% bounds', () => {
  const flat = Array.from({ length: 30 }, () => 100)
  const calm = driftBand(flat, 21)
  // No movement at all still gets the minimum 3% band, never a zero-width one.
  expect(calm).toMatchObject({ center: 100, low: 97.09, high: 103 })
  const wild = driftBand(Array.from({ length: 30 }, (_, index) => (index % 2 ? 150 : 80)), 21)
  expect(wild.high / wild.center).toBeCloseTo(1.2, 2)
  expect(driftBand(flat, 21)).toEqual(calm)
  expect(() => driftBand([100, 101], 21)).toThrow('at least 15')
})

test('before the window opens there is a latest price but no return to show', () => {
  const series = { AAA: [closeAt(START - 10 * H, 100), closeAt(START - 2 * H, 104)], BBB: [], CCC: [] }
  const early = measuredReturns(rule, series, START - H)
  expect(early[0]).toMatchObject({ start: null, returnMicros: null, end: { c: 104 } })
  const opened = measuredReturns(rule, { ...series, AAA: [...series.AAA, closeAt(START + 5 * H, 110)] }, START + 6 * H)
  expect(opened[0]).toMatchObject({ start: { c: 104 }, end: { c: 110 }, returnMicros: 57_692 })
})
