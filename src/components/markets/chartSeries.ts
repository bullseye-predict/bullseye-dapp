import type { ArenaMarket, ArenaMarketOutcome, SolzSnapshot } from '../solz/model'
import { outcomeColor } from '../home/heroMarket'
import { resolvePredictionContract } from '../solz/predictionContracts'
import { chartShape } from './moneyline'
import { normalisedChances, referencePrice } from './chance'
import { eventMarketVolume } from '../events/eventModel'
import { compact } from '../home/HomePrimitives'
import type { ProbabilitySeries } from './ProbabilityChart'

/** Turns a market into the lines a chart should draw.
 *
 *  The chart is deliberately told what to plot rather than working it out, so
 *  this is the only place that decides — and it decides from `chartShape`, the
 *  one predicate, instead of re-reading `outcomes.length` for the fifth time.
 *
 *  `price` is the LIVE book price from the shared rule, never the last point of
 *  the series. Those are different numbers on a market that has not traded
 *  recently, and printing the second under the first's label is what put
 *  "12¢ market price" under a row quoting 20¢.
 */
export function chartSeries(
  market: ArenaMarket,
  snapshot: SolzSnapshot,
  { selectedId, nested = false }: { selectedId?: string; nested?: boolean } = {},
): { series: ProbabilitySeries[]; shape: ReturnType<typeof chartShape>; unit: 'percent' | 'cents' } {
  const shape = chartShape(market, { nested })

  if (shape === 'single-answer') {
    const focus = (selectedId && resolvePredictionContract(market, selectedId)) ?? market.outcomes[0]
    if (!focus) return { series: [], shape, unit: 'percent' }
    return {
      series: [seriesFor(focus, snapshot, 0, referencePrice(focus), true)],
      shape,
      unit: 'percent',
    }
  }

  if (shape === 'both-sides') {
    // Two complementary books of ONE market. Both belong on screen at once —
    // and because a venue consolidates them before quoting, the two lines are
    // mirror images, which is exactly what a binary market looks like.
    return {
      series: market.outcomes.slice(0, 2).map((outcome, index) =>
        seriesFor(outcome, snapshot, index, referencePrice(outcome), selectedId === undefined || outcome.id === selectedId)),
      shape,
      unit: 'percent',
    }
  }

  // A field of independent books. The LINES stay raw per-book prices and the
  // axis stays in cents, while the legend reads normalised chances that total
  // 100%. Two units on one surface, deliberately: a normalised *history* does
  // not exist. It would need every past point's contemporaneous field total,
  // which nothing records, and inventing one is the fabrication this chart
  // refuses to do. Recording that total per interval is the fix, and it belongs
  // to the indexer, not here.
  const chances = normalisedChances(market.outcomes)
  return {
    series: market.outcomes.map((outcome, index) =>
      seriesFor(outcome, snapshot, index, chances[index], selectedId === undefined || outcome.id === selectedId)),
    shape,
    unit: 'cents',
  }
}

function seriesFor(
  outcome: ArenaMarketOutcome,
  snapshot: SolzSnapshot,
  index: number,
  price: number | undefined,
  emphasis: boolean,
): ProbabilitySeries {
  // Executed trades when there are any, the live sampled book when there are
  // not. A market that has not traded yet still HAS a price and still moves,
  // and drawing nothing at all — over a panel that is simultaneously quoting a
  // spread two rows above — reads as a broken chart rather than a quiet book.
  // `sampled` is what tells the reader which of the two they are looking at.
  const trades = outcome.priceHistory ?? []
  const quotes = outcome.quoteHistory ?? []
  const sampled = trades.length === 0 && quotes.length > 0
  return {
    id: outcome.id,
    label: outcome.label,
    color: outcomeColor(outcome, snapshot, index),
    points: sampled ? quotes : trades,
    sampled,
    price,
    status: outcome.historyStatus,
    emphasis,
  }
}

/** The headline figure, which is the book's price and not the series'.
 *
 *  A field is read as a normalised distribution because only one answer can
 *  win; a single market or one side of it is read as its own price. Both come
 *  from `referencePrice`, so the headline cannot disagree with the CHANCE
 *  column beside it. */
export function chartHeadline(
  market: ArenaMarket,
  { selectedId, nested = false, collateral }: { selectedId?: string; nested?: boolean; collateral?: string } = {},
): { label: string; chance: number | undefined } | { label: string; volume: string } | undefined {
  const shape = chartShape(market, { nested })
  const focus = (selectedId && resolvePredictionContract(market, selectedId)) ?? market.outcomes[0]
  if (!focus) return undefined
  // A field of twelve independent books has no single chance to headline. The
  // per-answer chances are already in the legend and in the answer rows below,
  // and lifting one of them above a chart of twelve lines described neither the
  // chart nor the market. Volume describes the whole thing.
  if (shape === 'all-answers') {
    // No subtitle: the legend directly below names and counts every answer, and
    // the page title already says what the question is.
    return { label: '', volume: `${compact(eventMarketVolume(market))} ${collateral ?? 'COOLA'} Vol.` }
  }
  return { label: focus.label, chance: referencePrice(focus) }
}
