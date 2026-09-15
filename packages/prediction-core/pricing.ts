import { PRICE_SCALE } from './types'
/** What one book's price *is*, in one place.
 *
 * Polymarket's published rule, which this implements: the probability is the
 * midpoint between bid and ask when the bid-ask spread is 10c or less, and the
 * last traded price when the spread is wider. The reasoning is that a tight
 * spread brackets a price precisely enough to trust the midpoint, while a wide
 * one does not — the midpoint of 5c/95c says nothing, but a trade at 80c is a
 * price somebody actually paid.
 *
 * Three functions in this codebase each implemented part of this and none of
 * them gated on spread width: `outcomeProbability` preferred mid, then either
 * side, then the last trade; `referencePrice` preferred mid, then the last
 * trade, then either side; the browser's quote sampler used the first of those
 * while the chart's headline read the second. Three answers to "what is this
 * market at" on one screen.
 *
 * Everything here is in bigint micros (1_000_000 = 100c = certainty) and
 * YES-denominated, because that is what the chain, `Candle` and `binaryQuotes`
 * already use, and because the indexer has to apply this identical rule at
 * write time. Float conversion belongs at the UI boundary, not here.
 */
/** 10c. Polymarket's threshold, named so the reason survives a reader. */
export const MID_SPREAD_LIMIT = 100_000n

export type PriceBasis = 'MIDPOINT' | 'LAST_TRADE' | 'WIDE_MIDPOINT' | 'BID' | 'ASK'
/** `mid` is NOT `(bid + ask) / 2`, and passing it matters. A venue that quotes
 *  two complementary books consolidates them before computing a midpoint — the
 *  Manifest adapter's best bid is `max(yesBids ∪ complementAsks(noAsks))`, which
 *  can be strictly better than the YES book's own best bid in `bid`. Dropping
 *  `mid` and re-deriving it from bid/ask would discard the other book. */
export type BookQuote = { bid?: bigint; ask?: bigint; mid?: bigint; crossed?: boolean }
export type MarketPrice = { value: bigint; basis: PriceBasis }

/**
 * The market's price for one book, with the evidence that produced it.
 *
 * `basis` is returned rather than discarded so a caller can say *why* — a
 * WIDE_MIDPOINT is a much weaker claim than a MIDPOINT, and a UI that cannot
 * tell them apart presents a guess with the same confidence as a quote.
 *
 * Returns undefined when there is no evidence at all. Never 0.5: an unopened
 * book is not a coin flip, and rendering one as 50% invents a market.
 */
export function marketPrice(
  quote: BookQuote | undefined | null,
  lastTrade?: bigint,
  spreadLimit: bigint = MID_SPREAD_LIMIT,
): MarketPrice | undefined {
  const bid = quote?.bid, ask = quote?.ask
  // A crossed book is two disagreeing prices, not one. Its "midpoint" averages
  // an inverted spread, so both midpoint rules below are off the table — but a
  // real executed trade still stands, which is why this is a flag and not an
  // early return.
  const crossed = Boolean(quote?.crossed)
  // The venue's consolidated midpoint when it supplied one, else the plain
  // average of the two sides we can see.
  const midpoint = crossed ? undefined
    : quote?.mid !== undefined ? quote.mid
      : bid !== undefined && ask !== undefined ? (bid + ask) / 2n : undefined
  // Only measurable when both sides are visible. A venue that publishes `mid`
  // without them has already told us the consolidated book is two-sided and
  // uncrossed — that is the condition a midpoint needs — but not how wide it is.
  const spread = !crossed && bid !== undefined && ask !== undefined ? ask - bid : undefined
  const twoSided = midpoint !== undefined

  if (twoSided && (spread === undefined || spread <= spreadLimit)) return { value: clamp(midpoint), basis: 'MIDPOINT' }
  // Polymarket's wide-spread rule. Ordered ahead of the one-sided cases on
  // purpose: a book quoting only a 40c bid that has traded at 62c is a 62c
  // market, and reading the lone bid instead would price it at what the most
  // patient buyer hopes for.
  if (lastTrade !== undefined) return { value: clamp(lastTrade), basis: 'LAST_TRADE' }
  // Still bracketed by two real resting orders, just loosely. Weaker than a
  // MIDPOINT and labelled as such, but better than declining to price a book
  // that is actively quoting both sides.
  if (twoSided) return { value: clamp(midpoint), basis: 'WIDE_MIDPOINT' }
  // One side only. The venue consolidates both books before this, so a NO ask
  // at 30c already arrives as a YES bid at 70c — a price someone is acting on.
  if (!crossed && bid !== undefined) return { value: clamp(bid), basis: 'BID' }
  if (!crossed && ask !== undefined) return { value: clamp(ask), basis: 'ASK' }
  return undefined
}

const clamp = (value: bigint) => value < 0n ? 0n : value > PRICE_SCALE ? PRICE_SCALE : value

/** Micros to a 0..1 fraction, for the UI boundary. */
export const priceFraction = (value: bigint) => Math.min(1, Math.max(0, Number(value) / Number(PRICE_SCALE)))

/** A 0..1 fraction to micros. Rounds, because micros are the chain's own
 *  precision and a float that cannot be expressed in them was never a real
 *  price. */
export const priceMicros = (value: number) => {
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.round(Math.min(1, Math.max(0, value)) * Number(PRICE_SCALE)))
}

/** The complement, for reading a NO book as a YES price. One market has one
 *  price; NO is not a second measurement of it. */
export const complementPrice = (value: bigint) => PRICE_SCALE - value
