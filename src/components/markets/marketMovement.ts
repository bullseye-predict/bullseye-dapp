import type { ArenaMarketOutcome } from '../solz/model'
import { PRICE_PLACEHOLDER } from '../home/venue/quoteLabels'

export type MovementDirection = 'up' | 'down' | 'flat'
export type Movement = { text: string; direction: MovementDirection }

const FLAT: Movement = { text: PRICE_PLACEHOLDER, direction: 'flat' }

/** The market move for one outcome, as a direction plus its label.
 *
 *  Lifted out of PredictionOptions so the event list and the home list read the
 *  same rule instead of two copies that drifted — and returns a typed direction
 *  rather than a string callers re-parse with `.startsWith('↑')`.
 *
 *  Executed trades are preferred over observed quotes when both exist; quotes
 *  are the only series a dormant book produces, so they are the fallback rather
 *  than an alternative.
 */
export function outcomeMovement(outcome: ArenaMarketOutcome): Movement {
  // An indicative probability is the 50/50 placeholder, not an observation.
  // Differencing it against a real earlier quote rendered a coloured "market
  // move" the moment a book went crossed or its last orders were cancelled.
  if (outcome.indicative) return FLAT
  const points = outcome.priceHistory?.length ? outcome.priceHistory : outcome.quoteHistory ?? []
  // Both ends come from the SAME series. Differencing the previous point
  // against the live probability mixed the quote series with the trade series
  // the moment a row became the focused one and grew a trade history.
  const previous = points.at(-2)?.probability
  const latest = points.at(-1)?.probability
  if (previous === undefined || latest === undefined || previous === latest) return FLAT
  const delta = latest - previous
  return {
    direction: delta > 0 ? 'up' : 'down',
    text: `${delta > 0 ? '↑' : '↓'} ${Math.abs(delta * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`,
  }
}
