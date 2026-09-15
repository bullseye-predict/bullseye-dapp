import type { ArenaMarketOutcome } from '../../solz/model'

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

export function buyQuoteLabel(outcome: ArenaMarketOutcome, solana: boolean): string {
  if (!solana) return `${Math.round(outcome.probability * 100)}¢`
  if (outcome.marketQuote?.ask !== undefined) return centsLabel(outcome.marketQuote.ask)
  return PRICE_PLACEHOLDER
}

/** A single bid or ask cannot establish a midpoint probability. */
export function midpointLabel(outcome: ArenaMarketOutcome | undefined): string {
  if (outcome?.marketQuote?.crossed) return 'Crossed'
  const mid = outcome?.marketQuote?.mid
  return mid === undefined ? outcome?.marketQuote?.bid !== undefined ? `${(outcome.marketQuote.bid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}¢ bid` : '—' : `${(mid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
