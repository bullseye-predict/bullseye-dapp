import './runtime'
import { Buffer } from 'buffer'
import { FillLog } from '@bonasa-tech/manifest-sdk'
import type { Connection } from '@solana/web3.js'
import type { Candle } from '../../../prediction-core/market-data'
import { PRICE_SCALE } from '../../../prediction-core/types'
import type { ManifestBinding } from './wire'

export function manifestCandles(logs: string[], binding: ManifestBinding, timestamp: number): Candle[] {
  const stack: string[] = [], result: Candle[] = []
  for (const line of logs) {
    const invoke = /^Program (\w+) invoke \[(\d+)\]$/.exec(line)
    if (invoke) { stack.length = Number(invoke[2]) - 1; stack.push(invoke[1]!); continue }
    const end = /^Program (\w+) (?:success|failed:.*)$/.exec(line)
    if (end) { if (stack.at(-1) !== end[1]) throw new Error('Invalid invocation log stack'); stack.pop(); continue }
    if (!line.startsWith('Program data: ') || stack.at(-1) !== binding.program.toBase58()) continue
    const bytes = Buffer.from(line.slice(14), 'base64')
    if (!bytes.subarray(0, 8).equals(Buffer.from([58,230,242,3,75,113,4,169]))) continue
    const [fill] = FillLog.deserialize(bytes.subarray(8))
    if (!fill.market.equals(binding.venue) || !fill.baseMint.equals(binding.mint) || !fill.quoteMint.equals(binding.collateral)) continue
    const volume = BigInt(fill.baseAtoms.inner.toString()), collateralVolume = BigInt(fill.quoteAtoms.inner.toString())
    if (volume === 0n) continue
    const price = collateralVolume * 1_000_000n / volume
    result.push({ timestamp, open: price, high: price, low: price, close: price, volume, collateralVolume, trades: 1 })
  }
  if (logs.some(line => /log truncated/i.test(line))) throw new Error('Trade history contains truncated logs')
  return result
}
/**
 * One market's trades, denominated in YES, from a book that may be either side.
 *
 * A prediction market has one price. The YES book and the NO book are two
 * venues for trading it, and a NO fill at 30c *is* the statement that YES is at
 * 70c — so a chart that plots only the YES book's fills is throwing away half
 * of what the market said. That is what shipped: `manifestCandles` filters to
 * one book by `fill.market === binding.venue`, and the caller read the two
 * sides into two separate series.
 *
 * High and low swap under complement, because 1 - high is the low.
 */
export function yesDenominated(candles: readonly Candle[], outcome: 0 | 1): Candle[] {
  if (outcome === 0) return [...candles]
  const flip = (price: bigint) => PRICE_SCALE - price
  return candles.map(candle => ({
    ...candle,
    open: flip(candle.open),
    high: flip(candle.low),
    low: flip(candle.high),
    close: flip(candle.close),
  }))
}

/** Both books' trades as one chronological series.
 *
 *  Ties are left in argument order, which puts the YES book first. Two fills
 *  sharing a block time are genuinely simultaneous — blockTime has one-second
 *  granularity against ~400ms slots — so there is no true order to recover and
 *  a stable sort is the honest answer. */
export function mergeCandles(...series: readonly (readonly Candle[])[]): Candle[] {
  return series
    .flatMap((rows, source) => rows.map(candle => ({ candle, source })))
    .sort((a, b) => a.candle.timestamp - b.candle.timestamp || a.source - b.source)
    .map(row => row.candle)
}

/**
 * Paging, caching, non-throwing candle reader for the market pages.
 *
 * `recentManifestCandles` below stays the strict variant the standalone /live
 * terminal wants: it throws so that terminal can show "trade history
 * unavailable" as its whole chart. A market page cannot use those semantics —
 * its chart sits beside a live order book, and one transaction missing
 * `blockTime`, or one truncated log, must not blank both. So every failure here
 * is a skipped transaction, and the caller is told whether the answer is
 * partial rather than being handed an exception.
 *
 * Cost control: one `getSignaturesForAddress` page per read, and at most
 * `perPass` *singular* `getTransaction` calls — never the plural batch form,
 * which public Solana endpoints reject. A cold book backfills over several
 * polls instead of firing a hundred round trips at once.
 */
export class ManifestCandleReader {
  private readonly decoded = new Map<string, Candle[]>()
  constructor(private readonly connection: Connection, private readonly perPass = 2, private readonly cacheLimit = 600) {}
  async read(binding: ManifestBinding, limit = 100): Promise<{ candles: Candle[]; partial: boolean }> {
    const signatures = await this.connection.getSignaturesForAddress(binding.venue, { limit }, 'confirmed')
    let fetched = 0, partial = false
    // Tagged with the signature's position in the newest-first page and the
    // fill's position inside its own transaction. blockTime has one-second
    // granularity while slots are ~400ms, so two transactions routinely share a
    // timestamp; a plain stable sort then left the OLDEST of that second last,
    // and every consumer reading `.at(-1)` as "last trade" took the wrong one.
    const collected: { candle: Candle; page: number; fill: number }[] = []
    // Newest first, so a bounded backfill always knows the latest price rather
    // than a non-deterministic slice of the middle of the book's history.
    for (const [page, entry] of signatures.entries()) {
      if (entry.err) continue
      const key = `${binding.venue.toBase58()}:${entry.signature}`
      let rows = this.decoded.get(key)
      if (!rows) {
        if (fetched >= this.perPass) { partial = true; continue }
        fetched++
        try {
          const tx = await this.connection.getTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
          if (!tx?.meta || tx.blockTime == null || tx.meta.err) { partial = true; continue }
          rows = manifestCandles(tx.meta.logMessages ?? [], binding, tx.blockTime * 1000)
        } catch { partial = true; continue }
        this.decoded.set(key, rows)
        if (this.decoded.size > this.cacheLimit) this.decoded.delete(this.decoded.keys().next().value as string)
      }
      rows.forEach((candle, fill) => collected.push({ candle, page, fill }))
    }
    // Chronological: by block time, then newest-transaction-last within a shared
    // second (the page is newest-first, so a smaller `page` is newer), then in
    // sweep order within one transaction. The fetch walk stays newest-first so
    // the `perPass` budget still front-loads the most recent trades.
    return {
      candles: collected
        .sort((a, b) => a.candle.timestamp - b.candle.timestamp || b.page - a.page || a.fill - b.fill)
        .map(row => row.candle),
      partial,
    }
  }
}

/** Recent finalized history only. No fabricated points or claim of complete P&L. */
export async function recentManifestCandles(connection: Connection, binding: ManifestBinding): Promise<Candle[]> {
  const signatures = await connection.getSignaturesForAddress(binding.venue, { limit: 4 }, 'finalized')
  const transactions = []
  for (const signature of signatures.filter(s => !s.err)) {
    transactions.push(await connection.getTransaction(signature.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }))
  }
  const rows: Candle[] = []
  for (const tx of transactions.reverse()) {
    if (!tx?.meta || tx.blockTime == null) throw new Error('Finalized trade history is temporarily unavailable')
    if (tx.meta.err) continue
    rows.push(...manifestCandles(tx.meta.logMessages ?? [], binding, tx.blockTime * 1000))
  }
  return rows
}
