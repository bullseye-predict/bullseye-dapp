import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseAgentForecasts, type PublishedAgentForecast } from '../src/components/events/generalEventPrices'
import { agentScore, agentThoughts, agentWindows, windowLabel, type AgentAccuracyRule } from '../src/components/events/agentThinking'
import { AgentThinkingFeed } from '../src/components/events/AgentThinkingFeed'
import { AgentPerformancePanel } from '../src/components/events/AgentPerformancePanel'
import { isAgentQuestionId, type StockEvent } from '../src/components/events/useStockEvent'
import { brand } from '../src/components/solz/brand'

const H = 3_600_000
const START = Date.parse('2026-10-02T00:00:00Z')
const rule: AgentAccuracyRule = { kind: 'agent-accuracy', parentEventId: 'general-stocks-duel', windowStart: '2026-10-02T00:00:00.000Z',
  windowEnd: '2026-10-03T12:00:00.000Z', intervalSeconds: 43_200, expectedWindows: 3 }
const method = { id: 'momentum-24h/v1', lookbackHours: 24, baselineProbability: .55, leadSeconds: 3600 }
const call = (index: number, answer: string, extra: Partial<PublishedAgentForecast> = {}): PublishedAgentForecast => ({
  startsAt: new Date(START + index * 12 * H).toISOString(), endsAt: new Date(START + (index + 1) * 12 * H).toISOString(),
  publishedAt: new Date(START + index * 12 * H - H).toISOString(), answer, probability: .55, citations: [],
  resolvedAnswer: null, correct: null, reasoning: null, outcome: null, ...extra,
})
const reasoning = { method: 'momentum-24h/v1', asOf: '2026-10-01T23:00:00.000Z', lookbackHours: 24, measured: [
  { symbol: 'KALSHI', first: { t: 1, c: 0.48 }, last: { t: 2, c: 0.49 }, changeMicros: 20_833 },
  { symbol: 'POLYMARKET', first: { t: 1, c: 0.61 }, last: { t: 2, c: 0.6 }, changeMicros: -16_393 },
] }

test('an older backend without reasoning still shows its calls, and a newer one adds what the agent read', () => {
  const old = parseAgentForecasts({ forecasts: [{ ...call(0, 'KALSHI'), reasoning: undefined, outcome: undefined }] })
  expect(old.method).toBeNull()
  expect(old.forecasts[0]!.reasoning).toBeNull()
  const current = parseAgentForecasts({ method, forecasts: [{ ...call(0, 'KALSHI'), reasoning, outcome: [{ symbol: 'KALSHI', changeMicros: 12_000 }] }] })
  expect(current.method).toEqual(method)
  expect(current.forecasts[0]!.reasoning!.measured[1]).toEqual(reasoning.measured[1]!)
  expect(current.forecasts[0]!.outcome).toEqual([{ symbol: 'KALSHI', changeMicros: 12_000 }])
  expect(() => parseAgentForecasts({})).toThrow()
})

test('each window reads its state from the call and the clock, and an unpublished past window counts as judged', () => {
  const forecasts = [call(0, 'KALSHI', { correct: true, resolvedAnswer: 'KALSHI' }), call(1, 'POLYMARKET')]
  expect(agentWindows(rule, forecasts, method, START - 2 * H).map(window => window.status)).toEqual(['correct', 'locked', 'scheduled'])
  expect(agentWindows(rule, forecasts, method, START + 13 * H).map(window => window.status)).toEqual(['correct', 'running', 'scheduled'])
  const late = agentWindows(rule, forecasts, method, START + 25 * H)
  expect(late.map(window => window.status)).toEqual(['correct', 'awaiting', 'unpublished'])
  expect(late[2]!.publishAt).toBe(START + 24 * H - H)
  expect(agentScore(late)).toEqual({ correct: 1, judged: 2, total: 3 })
})

test('the log says what the agent read, why it called, and how the window went', () => {
  const forecasts = [call(0, 'KALSHI', { reasoning, correct: false, resolvedAnswer: 'POLYMARKET',
    outcome: [{ symbol: 'KALSHI', changeMicros: -8_000 }, { symbol: 'POLYMARKET', changeMicros: 21_000 }] })]
  const thoughts = agentThoughts(rule, forecasts, method, START + 13 * H)
  const text = thoughts.map(thought => thought.text)
  expect(text[0]).toContain('3 calls scheduled, one every 12 hours')
  expect(text).toContain('Reading hourly closes up to Oct 1, 23:00 UTC. Over the last 24 hours:')
  expect(text).toContain('KALSHI moved most (+2.08%), so I call KALSHI to lead Oct 2, 00:00–12:00 UTC. Confidence 55%.')
  expect(text).toContain('Window closed. POLYMARKET led. My call KALSHI missed.')
  expect(text).toContain('No call was published for Oct 2, 12:00–00:00 UTC. It counts as a miss.')
  expect(text.at(-1)).toBe('Next call due Oct 2, 23:00 UTC, for Oct 3, 00:00–12:00 UTC.')
  // Oldest first, like a chat.
  expect(thoughts.map(thought => thought.at)).toEqual([...thoughts.map(thought => thought.at)].sort((a, b) => a - b))
  expect(thoughts.find(thought => thought.id === 'method')!.timed).toBe(false)
})

test('a call without stored inputs says so instead of inventing a reason', () => {
  const [, , callLine] = agentThoughts(rule, [call(0, 'UP')], method, START - 2 * H)
  expect(callLine!.text).toBe('I call UP for Oct 2, 00:00–12:00 UTC. Confidence 55%. The inputs behind this call were not recorded.')
  const direction = agentThoughts(rule, [call(0, 'DOWN', { reasoning: { ...reasoning, measured: [{ ...reasoning.measured[1]! }] } })], null, START - 2 * H)
  expect(direction.map(thought => thought.text)).toContain('POLYMARKET fell 1.64%, so I call DOWN for Oct 2, 00:00–12:00 UTC. Confidence 55%.')
  // No method from the backend: no sentence describing one.
  expect(direction.some(thought => thought.id === 'method')).toBe(false)
})

test('a window across midnight names both dates only when it must', () => {
  expect(windowLabel(START, START + 12 * H)).toBe('Oct 2, 00:00–12:00 UTC')
  expect(windowLabel(START + 12 * H, START + 36 * H)).toBe('Oct 2, 12:00 – Oct 3, 12:00 UTC')
})

test('the feed keeps its shape while loading and names each call by the agent', () => {
  const loading = renderToStaticMarkup(<AgentThinkingFeed thoughts={[]} loaded={false}/>)
  expect(loading).toContain('aria-busy="true"')
  expect(loading.match(/at-sk-row/g)).toHaveLength(3)
  const html = renderToStaticMarkup(<AgentThinkingFeed rail loaded thoughts={agentThoughts(rule, [call(0, 'KALSHI', { reasoning })], method, START - 2 * H)} questionHref="/events/general-stocks-duel-agent"/>)
  // The agent carries the active brand's name.
  expect(html).toContain(`${brand.name} agent`)
  expect(html).toContain('$0.48 → $0.49')
  expect(html).toContain('href="/events/general-stocks-duel-agent"')
})

test('the agent tab puts the latest decision above the call-by-call comparison', () => {
  const forecasts = [call(0, 'KALSHI', { reasoning, correct: true, resolvedAnswer: 'KALSHI', outcome: [{ symbol: 'KALSHI', changeMicros: 12_000 }] })]
  const now = START + 13 * H
  const windows = agentWindows(rule, forecasts, method, now)
  const stock = { agentPage: true, agentLoaded: true, agentRule: rule, agent: { loaded: true, method, forecasts }, windows,
    thoughts: agentThoughts(rule, forecasts, method, now), score: agentScore(windows), now,
    own: { phase: 'absent' }, measured: { phase: 'absent' } } as unknown as StockEvent
  const html = renderToStaticMarkup(<AgentPerformancePanel stock={stock}/>)
  expect(html).toContain('LATEST DECISION')
  expect(html).toContain('so I call KALSHI to lead')
  // The second window opened without a call, which counts as a miss.
  expect(html).toContain('1/2 correct so far')
  expect(html).toContain('The market prices this agent is judged on are not available yet.')
  expect(html).toContain('href="/events/general-stocks-duel"')
})

test('only the linked agent question is an agent page', () => {
  expect(isAgentQuestionId('general-stocks-polymarket-kalshi-2026-10-02-agent')).toBe(true)
  expect(isAgentQuestionId('general-stocks-polymarket-kalshi-2026-10-02')).toBe(false)
  expect(isAgentQuestionId('general-agent-anthropic-2026-10-19')).toBe(false)
})
