import type { ArenaMarketOutcome } from '../../solz/model'

export function buyQuoteLabel(outcome: ArenaMarketOutcome, solana: boolean): string {
  if (!solana) return `${Math.round(outcome.probability * 100)}¢`
  if (outcome.marketQuote?.ask !== undefined) return `${(outcome.marketQuote.ask * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢`
  return outcome.marketQuote ? 'No asks' : outcome.indicative ? 'OPEN' : '—'
}

/** A single bid or ask cannot establish a midpoint probability. */
export function midpointLabel(outcome: ArenaMarketOutcome | undefined): string {
  if (outcome?.marketQuote?.crossed) return 'Crossed'
  const mid = outcome?.marketQuote?.mid
  return mid === undefined ? outcome?.marketQuote?.bid !== undefined ? `${(outcome.marketQuote.bid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}¢ bid` : '—' : `${(mid * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
}
