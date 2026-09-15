import type { ArenaMarketOutcome } from '../../solz/model'
import type { TradeSide } from './tradeSide'

/** One placeholder for "this side has no price to show", whatever the reason.
 *  The reason belongs in the ticket's help text, not stamped on a Buy button:
 *  "No asks" on a market that simply has not been opened yet read as a failure
 *  to everyone who saw it. The order book keeps its own wording — there the
 *  difference between "no sellers" and "still loading" is the information. */
export const PRICE_PLACEHOLDER = '--'

export const centsLabel = (price: number) => `${(price * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢`

/** The CHANCE column, everywhere. Always a percentage or the placeholder —
 *  never a one-sided "50¢ bid" next to a neighbour's "87.5%". Executable
 *  prices belong on the trading controls beside it, where they can be acted on;
 *  midpointLabel still serves the order book and the detail panel. */
export function chanceLabel(outcome: ArenaMarketOutcome | undefined): string {
  if (!outcome || outcome.indicative) return PRICE_PLACEHOLDER
  if (outcome.probability > 0 && outcome.probability < .01) return '<1%'
  return `${Math.round(outcome.probability * 100)}%`
}

/** The price on an outcome's trading control, for the direction the trader is
 *  actually in: buying takes somebody's ask, selling hits somebody's bid. The
 *  trade ticket has always priced its own two buttons this way; this is the same
 *  rule, so a market row and the ticket cannot quote one outcome differently.
 *
 *  `complement` is for a NO contract built by predictionContract(), which
 *  complements the probability but carries the YES book's quote untouched. In a
 *  binary market the two books are one: buying NO costs what is left of a pound
 *  after selling YES at the best bid, and vice versa. Without it a NO button
 *  silently printed the YES book's price. */
export function quoteLabel(outcome: ArenaMarketOutcome, solana: boolean, side: TradeSide, complement = false): string {
  if (!solana) return `${Math.round((complement ? 1 - outcome.probability : outcome.probability) * 100)}¢`
  const quote = outcome.marketQuote
  const value = complement
    ? (side === 'buy' ? quote?.bid : quote?.ask)
    : (side === 'buy' ? quote?.ask : quote?.bid)
  if (value === undefined) return PRICE_PLACEHOLDER
  return centsLabel(complement ? 1 - value : value)
}

export function buyQuoteLabel(outcome: ArenaMarketOutcome, solana: boolean): string {
  return quoteLabel(outcome, solana, 'buy')
}

/** A single bid or ask cannot establish a midpoint probability. */
export function midpointLabel(outcome: ArenaMarketOutcome | undefined): string {
  if (outcome?.marketQuote?.crossed) return 'Crossed'
  const mid = outcome?.marketQuote?.mid
  return mid === undefined ? outcome?.marketQuote?.bid !== undefined ? `${(outcome.marketQuote.bid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}¢ bid` : '—' : `${(mid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
