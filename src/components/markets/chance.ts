import type { ArenaMarketOutcome } from '../solz/model'
import { PRICE_PLACEHOLDER } from '../home/venue/quoteLabels'

/** CHANCE is not a price.
 *
 *  Each answer in a mutually exclusive field has its own YES/NO book, and each
 *  book prices that answer on its own. Printing those prices side by side as
 *  "chance" produced 50% + 50% + 88% + 70% + 60% — a field where five of twelve
 *  runners already account for 318%.
 *
 *  So chance is a separate display value: a reference price per answer,
 *  normalised across the whole field. Executable YES/NO prices are untouched by
 *  everything in this file — they are what a trader can actually hit, and they
 *  are not a probability distribution.
 */

/** The market-implied price for one answer, or undefined when this answer has
 *  no market at all. Best evidence first:
 *    1. a two-sided midpoint — both sides quoted, so the price is bracketed;
 *    2. the last executed trade;
 *    3. a one-sided resting quote — a bid at 70c is still what a trader is
 *       willing to pay, which is exactly what implies a probability. Note the
 *       venue consolidates the two books first, so a NO ask at 30c already
 *       reaches this function as a YES bid at 70c.
 *    4. nothing. An unopened book has no price, and therefore no implied
 *       probability — it is not a 50/50 and it is not a zero.
 */
export function referencePrice(outcome: ArenaMarketOutcome | undefined): number | undefined {
  if (!outcome) return undefined
  const quote = outcome.marketQuote
  if (quote && !quote.crossed && quote.mid !== undefined) return clamp(quote.mid)
  const lastTrade = outcome.priceHistory?.at(-1)?.probability
  if (lastTrade !== undefined) return clamp(lastTrade)
  // A crossed book is two disagreeing prices, not one; wait for it to clear.
  if (quote && !quote.crossed) {
    const oneSided = quote.bid ?? quote.ask
    if (oneSided !== undefined) return clamp(oneSided)
  }
  // No venue book at all: a simulated or arena market states its own
  // probability directly, and `indicative` marks the ones that are only a
  // 50/50 order-entry seed.
  if (!quote && !outcome.indicative && outcome.probability > 0) return clamp(outcome.probability)
  return undefined
}

const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Normalises a field of mutually exclusive answers so the displayed chances
 *  total 100%.
 *
 *  Only one answer can win, so the prices belong to one distribution — but
 *  independent books each price their own answer, and spreads and thin
 *  liquidity let the raw prices sum anywhere. Dividing through by the total is
 *  what turns a set of prices into a set of chances.
 *
 *  An answer whose book has never opened is left OUT of the total and shows the
 *  placeholder, not 0%: there is no price, so there is nothing to imply a
 *  probability from. The answers that do have a market are normalised among
 *  themselves, which is the 100%-total reading of the field as it trades today.
 *  Two priced answers is the minimum — one answer normalises to a meaningless
 *  100%. */
export function normalisedChances(outcomes: ReadonlyArray<ArenaMarketOutcome | undefined>): Array<number | undefined> {
  const prices = outcomes.map(referencePrice)
  const priced = prices.filter((price): price is number => price !== undefined)
  const total = priced.reduce<number>((sum, price) => sum + price, 0)
  if (priced.length < 2 || !(total > 0)) return prices.map(() => undefined)
  return prices.map((price) => (price === undefined ? undefined : price / total))
}

/** Full precision is kept in the value; only the label rounds. */
export function chanceText(chance: number | undefined): string {
  if (chance === undefined || !Number.isFinite(chance)) return PRICE_PLACEHOLDER
  const percent = chance * 100
  if (percent > 0 && percent < 1) return '<1%'
  return `${Math.round(percent)}%`
}
