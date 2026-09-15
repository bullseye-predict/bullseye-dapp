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

/** The viewer's OWN positions in this market, and nothing else.
 *
 *  This used to prepend eight invented holders per outcome, drawn from a pool of
 *  ellipsised names shaped to pass as truncated base58 addresses — so a live
 *  Solana question rendered a leaderboard in which every row but yours was
 *  fiction. Other holders now come from chain through useVenueHolders; this
 *  stays synchronous because it reads an account already in the snapshot, and
 *  because avg price and P&L only exist for the wallet whose basis the app
 *  actually tracks. */
export function eventHoldings(snapshot: SolzSnapshot, market: ArenaMarket): EventHolding[] {
  return snapshot.account.positions.filter((position) => position.marketId === market.id && position.token === 'COOLA' && market.outcomes.some((outcome) => outcome.id === position.outcomeId)).map((position) => ({
    id: position.id, author: 'YOU', outcomeId: position.outcomeId, shares: position.shares,
    averagePrice: position.averagePrice, pnl: position.pnl, self: true,
  }))
}

export { sampleOrderBook, type DepthRow } from '../solz/marketDepth'

export function eventActivity(snapshot: SolzSnapshot, matchId: string, marketId?: string) {
  const markets = snapshot.markets.filter((market) => market.matchId === matchId && (!marketId || market.id === marketId))
  const outcomes = new Set(markets.flatMap((market) => market.outcomes.map((outcome) => outcome.id)))
  return snapshot.tape.filter((entry) => entry.matchId === matchId && outcomes.has(baseOutcomeId(entry.outcomeId))).sort((a, b) => b.at - a.at)
}
