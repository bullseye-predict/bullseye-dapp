import { prestocksAsset } from '../../../packages/prediction-core/prestocks'
import type { AgentThought } from '../events/agentThinking'
import { tokenIconUrl } from '../solz/tokenIcon'

/**
 * Bullseye pitch deck content. Plain data: the deck shell renders it, and a
 * number or a line of the script is changed here.
 */

export const source = {
  label: 'eToro Retail Investor Beat, U.S., 2025',
  url: 'https://www.etoro.com/en-us/news-and-analysis/latest-news/press-release/us-retail-investors-flock-to-ai-tools-with-usage-surging-75-in-one-year/',
}

export type Company = { name: string, logo: string }

/** Pre-stock logos come from the frozen PreStocks list, as the trade ticket
 *  shows them. */
export const preStocks: Company[] = ['OPENAI', 'POLYMARKET', 'ANTHROPIC', 'SPACEX'].map((symbol) => {
  const asset = prestocksAsset(symbol)
  return { name: asset?.company ?? symbol, logo: asset?.imageUrl ?? '' }
})

/** Stock logos load through this site's icon route, like the xStock rows. */
export const stocks: Company[] = [
  ['NVIDIA', 'NVDA'], ['Tesla', 'TSLA'], ['Apple', 'AAPL'], ['Alphabet', 'GOOGL'],
].map(([name, ticker]) => ({ name, logo: tokenIconUrl(`https://backpack.exchange/api/stock-logo/${ticker}`) }))

export const openAi = preStocks[0]

/** Illustrative price ladder for the main pre-stock question. */
export const ladder = [
  { id: '1225', label: '$1,225', chance: 72 },
  { id: '1275', label: '$1,275', chance: 48 },
  { id: '1325', label: '$1,325', chance: 21 },
] as const

/** The agent's conviction on the same question, oldest first. Illustrative. */
export const convictionSteps = [
  { time: 'Morning', value: 50, why: 'Watching news, price and volume', action: 'WATCH' },
  { time: '10:30', value: 67, why: 'New information · volume accelerating', action: 'BUY' },
] as const

export const contact = { label: 'Telegram @dellwatson', url: 'https://t.me/dellwatson' }

const at = (hour: number, minute = 0) => Date.UTC(2026, 8, 26, hour, minute)

/** The clock the demo feed is drawn at, so its countdown never drifts. */
export const demoNow = at(16, 10)

/**
 * An illustrative agent thread for the phone on the product slide. It is
 * shaped exactly like the event page's recorded thoughts, so the real
 * AgentThinkingFeed draws it. Not a live record.
 */
export const demoThoughts: AgentThought[] = [
  { id: 'openai:method', at: at(8), voice: 'system', timed: false, text: 'Follows OpenAI news, pre-stock price, volume and momentum.' },
  { id: 'w1:reading', at: at(9), voice: 'agent', text: 'Quiet morning. Price flat, volume normal.' },
  { id: 'w1:call', at: at(9, 1), voice: 'agent', text: '50% bullish on OpenAI. No trade yet.' },
  {
    id: 'w2:reading', at: at(10, 30), voice: 'agent', text: 'New funding report. Volume up 3.1× in one hour.',
    moves: [
      { symbol: 'OPENAI', changeMicros: 42_000 },
      { symbol: 'ANTHROPIC', changeMicros: 8_000 },
      { symbol: 'SPACEX', changeMicros: -3_000 },
    ],
  },
  { id: 'w2:call', at: at(10, 31), voice: 'agent', text: 'Conviction 50% → 67% bullish. BUY.' },
  { id: 'w2:result', at: at(16), voice: 'agent', tone: 'correct', text: 'Held. OpenAI closed the window +4.2%.' },
  { id: 'next', at: at(16, 5), voice: 'system', dueAt: at(18), text: 'Next call locks before the 18:00 window.' },
]

export const demoScore = { correct: 9, judged: 12, total: 14 }

/** Accuracy bands for 14 scheduled calls, as the agent question lists them. */
export const accuracyBands = [
  { id: 'under-50', label: 'Under 50% · 0–6 of 14', chance: 8 },
  { id: '50-79', label: '50–79% · 7–11 of 14', chance: 41 },
  { id: '80-99', label: '80–99% · 12–13 of 14', chance: 38 },
  { id: '100', label: '100% · 14 of 14', chance: 13 },
] as const

/** The speaker's script, one entry per slide, in slide order. */
export const notes: readonly string[] = [
  "Hi, I'm building Bullseye: a transparent AI agent for pre-stock and stock prediction and trading.",
  'More people use AI to help make investment decisions. But they will not let it run their money. Most products are not visible: no transparency, no history, no view of what the agent thinks. That is not enough to build trust.',
  'Every pre-stock question, like OpenAI above a price, has an agent sub-question beside it. There I can see what the agent is looking at, what changed its mind, and how its conviction moves: 50% bullish this morning, then new information and accelerating volume take it to 67% and a buy.',
  'Bullseye is a public AI trader, starting with pre-stocks: OpenAI, Polymarket and other private companies people want before the IPO. Listed stocks work the same way. It follows news, price, volume and momentum, and publishes a timeline of its conviction. What it knew. What changed.',
  'So we do not ask users to trust our AI blindly. They watch first. Trust is earned, not given.',
  'We also let people predict how many times the agent hits the bullseye. Many will want to prove it wrong, and the way to do that is to trade the pre-stock. That market pushes volume onto the pre-stock.',
  "Today, users watch its conviction. Tomorrow, they follow the agents they trust. Watch how it thinks. Watch how it trades. Then decide if it's worth following. That's Bullseye. Reach me on Telegram at dellwatson.",
]
