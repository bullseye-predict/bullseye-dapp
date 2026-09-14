import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { baseOutcomeId, predictionContract } from '../solz/predictionContracts'

export type EventVariant = 'markets' | 'community' | 'agents'
export type EventPaths = { home: string; live: string; demo: string; variants: Record<EventVariant, string> }
export const eventHref = (base: string, id: string, predictionId?: string) => `${base}/${encodeURIComponent(id)}${predictionId ? `/${encodeURIComponent(predictionId)}` : ''}`

export function resolveEvent(snapshot: SolzSnapshot, id: string) {
  const market = snapshot.markets.find((item) => item.id === id)
  return snapshot.matches.find((item) => item.id === id || item.id === market?.matchId)
}

export function resolveEventPrediction(snapshot: SolzSnapshot, matchId: string, predictionId: string) {
  return snapshot.markets.find((market) => market.matchId === matchId && market.id === predictionId)
}

/** Display one answer's binary contracts without inventing another source market. */
export function eventAnswerMarket(market: ArenaMarket, answer: ArenaMarketOutcome): ArenaMarket {
  return {
    ...market,
    title: `${answer.label} · ${market.title}`,
    outcomes: [{ ...answer, label: 'Yes' }, { ...predictionContract(answer, 'no'), label: 'No' }],
    rules: `Yes pays the settlement value assigned to ${answer.label}; No pays the remainder of 1 COOLA. ${market.rules}`,
  }
}

export function eventMarketVolume(market: ArenaMarket) {
  const venue = market.onchain?.volume
  if (!venue) return market.volume.COOLA
  try { return Number(BigInt(venue.amount)) / 10 ** venue.decimals }
  catch { return market.volume.COOLA }
}

/** One chart series per linked answer while every answer keeps its own binary
 *  market, order book and position identity. */
export function linkedEventMarket(markets: readonly ArenaMarket[]): ArenaMarket | undefined {
  const first = markets[0]
  if (!first || markets.length < 2 || !markets.every((market) => market.presentation?.kind === 'linked')) return undefined
  return {
    ...first,
    id: `${first.matchId ?? first.id}:linked-overview`,
    title: first.presentation?.eventTitle ?? first.title,
    volume: { SOL: 0, COOLA: markets.reduce((sum, market) => sum + eventMarketVolume(market), 0) },
    onchain: undefined,
    outcomes: markets.map((market) => {
      const yes = market.outcomes[0]!
      const answer = market.presentation?.answer
      return {
        ...yes,
        id: market.id,
        label: answer?.label ?? market.title,
        detail: market.title,
        participantId: answer?.participantId,
        teamId: answer?.teamId,
      }
    }),
  }
}

export const relativeTime = (at: number, now: number) => {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`
}

export function nameSeed(value: string) {
  return [...value].reduce((sum, char) => Math.imul(sum, 31) + char.charCodeAt(0) >>> 0, 7)
}

export type EventHolding = { id: string; author: string; outcomeId: string; shares: number; averagePrice: number; pnl: number; self: boolean }
const SAMPLE_HOLDERS = ['7Kq…f2A', 'sol…9xz', 'relayrunner', 'canofalpha', '4Vn…b71', 'westside', 'ctrlshiftwin', 'zen…4kk', 'tin_can_trader', 'orbital', 'D3r…m08', 'stayfizzy']

// Illustrative holdings belong to the demo presentation, never to a live account.
// The viewer's positions are read from the shared source and valued separately.
export function eventHoldings(snapshot: SolzSnapshot, market: ArenaMarket): EventHolding[] {
  const sample = market.outcomes.flatMap((outcome, side) => Array.from({ length: 8 }, (_, index) => {
    const author = SAMPLE_HOLDERS[(index + side * 5) % SAMPLE_HOLDERS.length]
    const seed = nameSeed(`${market.id}:${outcome.id}:${author}`)
    const shares = Math.round((72_000 + seed % 28_000) / (index + 1.1))
    const averagePrice = Math.max(.01, Math.min(.99, outcome.probability - .09 + (seed % 140) / 1000))
    return { id: `${outcome.id}-${author}`, author, outcomeId: outcome.id, shares, averagePrice, pnl: shares * (outcome.probability - averagePrice), self: false }
  }))
  return [...sample, ...snapshot.account.positions.filter((position) => position.marketId === market.id && position.token === 'COOLA' && market.outcomes.some((outcome) => outcome.id === position.outcomeId)).map((position) => ({
    id: position.id, author: 'YOU', outcomeId: position.outcomeId, shares: position.shares,
    averagePrice: position.averagePrice, pnl: position.pnl, self: true,
  }))]
}

export { sampleOrderBook, type DepthRow } from '../solz/marketDepth'

export function eventActivity(snapshot: SolzSnapshot, matchId: string, marketId?: string) {
  const markets = snapshot.markets.filter((market) => market.matchId === matchId && (!marketId || market.id === marketId))
  const outcomes = new Set(markets.flatMap((market) => market.outcomes.map((outcome) => outcome.id)))
  return snapshot.tape.filter((entry) => entry.matchId === matchId && outcomes.has(baseOutcomeId(entry.outcomeId))).sort((a, b) => b.at - a.at)
}
