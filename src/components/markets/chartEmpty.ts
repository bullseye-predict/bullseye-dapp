import type { ProbabilitySeries } from './ProbabilityChart'

/** What to say when there is nothing to draw — which is three different facts,
 *  not one.
 *
 *  'pending' is a read still walking receipts; 'unavailable' is terminal for
 *  this reader. Collapsing them told a user "no trades" about a book nobody had
 *  finished looking at, and told them to keep waiting for one nothing would
 *  ever advance. */
export function emptyChart(series: readonly ProbabilitySeries[]): { title: string; hint: string; loading?: boolean } {
  if (series.some(item => item.status === 'pending')) {
    return { title: 'Loading price history…', hint: 'Receipts are decoded a few at a time, newest first.', loading: true }
  }
  if (series.length > 0 && series.every(item => item.status === 'unavailable')) {
    return { title: 'Price history unavailable.', hint: 'This market’s history could not be read right now.' }
  }
  return {
    title: 'No price recorded yet.',
    // Reached only when there are no trades AND no sampled quotes — i.e. the
    // book has never quoted. Name what makes it stop being true.
    hint: 'This market has no resting orders yet. A price appears as soon as one side quotes.',
  }
}
