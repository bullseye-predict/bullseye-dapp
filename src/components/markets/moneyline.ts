import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { outcomeColor } from '../home/heroMarket'

/** A moneyline is a two-sided TEAM market: its outcomes are the teams
 *  themselves, so "Yes" and "No" are not what the trader is choosing between.
 *  There — and only there — the trading controls carry team identity.
 *
 *  On a multi-outcome market the answer is a candidate and each row is its own
 *  independent Yes/No book, so the team colour belongs to the answer's text and
 *  mark while the Buy controls keep the green/red pair. */
export const isMoneyline = (market: ArenaMarket) =>
  market.presentation?.kind === 'head-to-head' && market.outcomes.length === 2

/** The colour a trading control should take, or undefined when the default
 *  green/red trading semantics apply. One rule, called from every list and from
 *  the trade ticket, so the three surfaces cannot disagree about a market. */
export function pickColor(market: ArenaMarket, outcome: ArenaMarketOutcome, snapshot: SolzSnapshot, index: number) {
  if (!isMoneyline(market)) return undefined
  return outcomeColor(outcome, snapshot, index)
}

/** The display name for a market line. Head-to-head questions are written as a
 *  sentence ("Who will win: JUP or ANSEM?") but read as a sportsbook line; the
 *  event title already names the fixture above it. */
export function marketLineTitle(market: ArenaMarket) {
  return market.presentation?.kind === 'head-to-head' ? 'Moneyline' : market.title
}

/** Readable ink for a fill of an arbitrary team colour. A moneyline button is
 *  painted with whatever hex the presentation supplies, so a hard-coded
 *  near-black foreground was unreadable on a dark team colour and a near-white
 *  one unreadable on a bright one. */
export function pickInk(color: string | undefined) {
  if (!color) return undefined
  const hex = color.replace('#', '')
  if (hex.length !== 6) return undefined
  const channel = (at: number) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255
    return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }
  const luminance = .2126 * channel(0) + .7152 * channel(2) + .0722 * channel(4)
  return luminance > .35 ? '#0b1410' : '#f6fbff'
}
