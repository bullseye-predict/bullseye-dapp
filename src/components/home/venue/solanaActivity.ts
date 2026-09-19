import { BatchUpdateStruct, CancelOrderLog, FillLog, OrderType, PlaceOrderLog } from '@bonasa-tech/manifest-sdk'
import { Buffer } from 'buffer'
import { base58 } from '@scure/base'
import type { Connection, PublicKey } from '@solana/web3.js'
import { MANIFEST_LOG, manifestLogBody, manifestProgramFrames } from '../../../../packages/adapters/solana/manifest/logs'
import type { VenueActivityRow } from './types'

/** One outcome's book, as the reader addresses it. */
export type ActivityBook = { address: string; outcome: 0 | 1; label: string; collateralSymbol?: string; question?: string; predictionProgram?: string; oppositeLabel?: string }

const PRICE_DIVISOR = 10n ** 12n
const shares = (atoms: bigint) => (Number(atoms) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 4 })
/** A resting price is a 1e18 fixed point of quote atoms per base atom; dividing
 *  by 1e12 gives the same 6dp collateral atoms the order book renders, so the
 *  feed and the book always quote a trade identically. */
const cents = (fixedPoint: bigint) => `${(Number(fixedPoint / PRICE_DIVISOR) / 10_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢`
const inner = (value: { inner: { toString(): string } }) => BigInt(value.inner.toString())

/**
 * Every Manifest event in one transaction that belongs to one outcome's book.
 *
 * Prices are reported in that book's own terms and labelled with its own
 * outcome. The DreamDEX feed inverts NO fills to YES terms because it has a
 * single pool quoted in YES; here YES and NO are two independent markets, and
 * restating one in the other's terms would misprice it.
 *
 * Pure, and exported for tests: the log shape is what is worth pinning.
 */
export function decodeBookActivity(logs: readonly string[], manifestProgram: string, book: ActivityBook, signature: string, slot: number, at: number): VenueActivityRow[] {
  const rows: VenueActivityRow[] = []
  const fills = new Set<string>()
  const frames = manifestProgramFrames(logs, manifestProgram)
  const base = { hash: signature, at, block: BigInt(slot) }

  for (const { encoded, index } of frames) {
    const fill = manifestLogBody(encoded, MANIFEST_LOG.fill)
    if (!fill) continue
    let log: FillLog
    try { log = FillLog.deserialize(fill)[0] } catch { continue }
    if (log.market.toBase58() !== book.address) continue
    const side = log.takerIsBuy ? 'Buy' : 'Sell'
    fills.add(log.takerSequenceNumber.toString())
    rows.push({
      ...base, id: `fill:${signature}:${index}`, kind: 'fill', owner: log.taker.toBase58(),
      label: `${side} ${book.label} filled`,
      detail: `${shares(inner(log.baseAtoms))} shares at ${cents(inner(log.price))}`,
    })
  }

  for (const { encoded, index } of frames) {
    const placed = manifestLogBody(encoded, MANIFEST_LOG.place)
    if (placed) {
      let log: PlaceOrderLog
      try { log = PlaceOrderLog.deserialize(placed)[0] } catch { continue }
      // PlaceOrderLog and CancelOrderLog carry only `market`, so the program
      // frame plus this address is the whole scope check available.
      if (log.market.toBase58() !== book.address) continue
      // A taker's batchUpdate emits a placement and its fills in one
      // transaction; the fill already says what happened.
      if (fills.has(log.orderSequenceNumber.toString())) continue
      rows.push({
        ...base, id: `order:${signature}:${index}`, kind: 'order', owner: log.trader.toBase58(),
        label: `${log.isBid ? 'Buy' : 'Sell'} ${book.label} placed`,
        detail: `${shares(inner(log.baseAtoms))} shares at ${cents(inner(log.price))}`,
      })
      continue
    }
    const cancelled = manifestLogBody(encoded, MANIFEST_LOG.cancel)
    if (!cancelled) continue
    let log: CancelOrderLog
    try { log = CancelOrderLog.deserialize(cancelled)[0] } catch { continue }
    if (log.market.toBase58() !== book.address) continue
    rows.push({
      ...base, id: `cancel:${signature}:${index}`, kind: 'cancel', owner: log.trader.toBase58(),
      label: `${book.label} order cancelled`, detail: `Order #${log.orderSequenceNumber.toString()} withdrawn`,
    })
  }
  return rows
}

/** Newest first, and deterministic within one slot. */
export const sortActivity = (rows: VenueActivityRow[]) =>
  rows.sort((a, b) => a.block === b.block ? b.at - a.at || b.id.localeCompare(a.id) : a.block > b.block ? -1 : 1)

/** Newest first, and each receipt once.
 *
 *  Every row a book produces carries an id derived from its signature and its
 *  position inside that transaction, so the same event decoded twice is the same
 *  id twice. That happens whenever a pass re-reads a page the cache already
 *  holds, and whenever a transaction touches both outcome books. The feed is the
 *  wrong place to notice it — a duplicate row is also a duplicate React key —
 *  so every path out of this reader goes through here. */
export function mergeActivity(rows: VenueActivityRow[]) {
  const seen = new Set<string>()
  return sortActivity(rows.filter(row => !seen.has(row.id) && seen.add(row.id)))
}

type Receipt = NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>

/** Some deployed Manifest builds omit event logs. A successful instruction
 * still proves an order was submitted, but cannot prove a fill or resting
 * quantity. Report exactly that distinction instead of an empty activity feed. */
export function receiptActivity(transaction: Receipt, manifestProgram: string, book: ActivityBook, signature: string, at: number): VenueActivityRow[] {
  if (!transaction.meta || transaction.meta.err) return []
  const logged = decodeBookActivity(transaction.meta.logMessages ?? [], manifestProgram, book, signature, transaction.slot, at)
  const message = transaction.transaction.message
  const keys = message.getAccountKeys({ accountKeysFromLookups: transaction.meta.loadedAddresses })
  const instructions = [
    ...message.compiledInstructions.map((instruction, index) => ({ ...instruction, index: `outer:${index}` })),
    ...(transaction.meta.innerInstructions ?? []).flatMap(group => group.instructions.map((instruction, index) => ({
      programIdIndex: instruction.programIdIndex, accountKeyIndexes: instruction.accounts,
      data: base58.decode(instruction.data), index: `inner:${group.index}:${index}`,
    }))),
  ]
  // Recognize the atomic split/export/opposite-sale route before presenting
  // its underlying SELL fill as though the user had sold the selected outcome.
  if (book.question && book.predictionProgram) {
    const key = (ix: typeof instructions[number], at: number) => keys.get(ix.accountKeyIndexes[at]!)?.toBase58()
    const split = instructions.find(ix => keys.get(ix.programIdIndex)?.toBase58() === book.predictionProgram && ix.data[0] === 6 && ix.data.length === 9 && key(ix, 2) === book.question)
    const sale = instructions.find(ix => keys.get(ix.programIdIndex)?.toBase58() === manifestProgram && ix.data[0] === 4 && ix.data.length >= 19 && ix.data[17] === 1 && ix.data[18] === 1 && key(ix, 1) === book.address)
    if (split && sale && key(split, 0) === key(sale, 0)) {
      const quantity = Buffer.from(split.data).readBigUInt64LE(1)
      const input = Buffer.from(sale.data).readBigUInt64LE(1)
      const minimumReturn = Buffer.from(sale.data).readBigUInt64LE(9)
      const exported = instructions.some(ix => keys.get(ix.programIdIndex)?.toBase58() === book.predictionProgram && ix.data[0] === 24 && ix.data.length === 9 && key(ix, 2) === book.question && key(ix, 0) === key(sale, 0) && key(ix, 6) === key(sale, 8) && Buffer.from(ix.data).readBigUInt64LE(1) === quantity)
      const bothOutcomesSold = instructions.some(ix => keys.get(ix.programIdIndex)?.toBase58() === manifestProgram && ix.data[0] === 4 && ix.data.length >= 19 && ix.data[17] === 1 && key(ix, 1) !== book.address && key(ix, 0) === key(sale, 0))
      if (bothOutcomesSold) return logged
      if (exported && quantity === input && minimumReturn > 0n && minimumReturn < quantity) return [{
        id: `complete-set:${signature}:${book.address}`, hash: signature, at, block: BigInt(transaction.slot), owner: key(sale, 0), kind: 'fill',
        label: `Buy ${book.oppositeLabel ?? (book.outcome === 0 ? 'NO' : 'YES')} completed`,
        detail: `${shares(quantity)} shares retained from a complete set; sold ${book.label}. Net cost at most ${shares(quantity - minimumReturn)} ${book.collateralSymbol ?? 'USDC'} before fee.`,
      }]
    }
  }
  if (logged.length) return logged
  return instructions.flatMap(instruction => {
    if (keys.get(instruction.programIdIndex)?.toBase58() !== manifestProgram || keys.get(instruction.accountKeyIndexes[1]!)?.toBase58() !== book.address || instruction.data[0] !== 6) return []
    try {
      const [{ params }] = BatchUpdateStruct.deserialize(Buffer.from(instruction.data))
      const base = { hash: signature, at, block: BigInt(transaction.slot), owner: keys.get(instruction.accountKeyIndexes[0]!)?.toBase58() }
      return [
        ...params.orders.map((order, index): VenueActivityRow => ({
          ...base, id: `instruction:${signature}:${instruction.index}:order:${index}`, kind: 'order',
          label: `${order.isBid ? 'Buy' : 'Sell'} ${book.label} order confirmed`,
          detail: `${shares(BigInt(order.baseAtoms.toString()))} shares · ${order.orderType === OrderType.ImmediateOrCancel ? 'IOC' : 'Limit'} ${(order.priceMantissa * 10 ** order.priceExponent * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}¢. Fill details unavailable in this receipt.`,
        })),
        ...params.cancels.map((cancel, index): VenueActivityRow => ({
          ...base, id: `instruction:${signature}:${instruction.index}:cancel:${index}`, kind: 'cancel',
          label: `${book.label} cancellation confirmed`, detail: `Order #${cancel.orderSequenceNumber.toString()}`,
        })),
      ]
    } catch { return [] }
  })
}

/**
 * The activity feed for one question's two books.
 *
 * Book addresses are program-derived, so discovering them costs no RPC at all.
 * Steady state is one `getSignaturesForAddress` per book per poll: `until` the
 * newest signature already seen means a quiet market returns an empty page.
 * Receipts are immutable once confirmed, so a decoded transaction is cached and
 * never re-fetched — and the cache is keyed by book as well as signature,
 * because the parse is book-scoped and a signature-only key would serve the YES
 * book's parse to the NO book.
 */
export class ManifestActivityReader {
  private readonly decoded = new Map<string, VenueActivityRow[]>()
  private readonly newest = new Map<string, string>()
  constructor(private readonly connection: Connection, private readonly manifestProgram: string, private readonly perPass = 4, private readonly cacheLimit = 400) {}

  async read(books: readonly ActivityBook[], toKey: (address: string) => PublicKey, signal?: AbortSignal, onProgress?: () => void): Promise<{ rows: VenueActivityRow[]; partial: boolean }> {
    const rows: VenueActivityRow[] = []
    let partial = false
    for (const book of books) {
      let fetched = 0
      if (signal?.aborted) break
      try {
        // A full page means there are still transactions between its oldest
        // entry and `until`, so walk back with `before` until the gap closes.
        // Without this, advancing the cursor to the newest signature left every
        // transaction past the page limit permanently older than `until` and
        // therefore never read — a burst while the tab was backgrounded simply
        // vanished. Bounded: signature pages are cheap, the receipt fetches are
        // what `perPass` caps, and three pages covers 120 transactions.
        const until = this.newest.get(book.address)
        const page: Awaited<ReturnType<Connection['getSignaturesForAddress']>> = []
        for (let request = 0; request < 3; request++) {
          const next = await this.connection.getSignaturesForAddress(toKey(book.address), { limit: 40, until, before: page.at(-1)?.signature }, 'confirmed')
          page.push(...next)
          if (next.length < 40) break
          if (request === 2) partial = true
        }
        let capped = false
        for (const entry of page) {
          if (signal?.aborted) return { rows: mergeActivity(rows), partial }
          if (entry.err) continue
          const key = `${book.address}:${entry.signature}`
          let parsed = this.decoded.get(key)
          if (!parsed) {
            if (fetched >= this.perPass) { partial = true; capped = true; continue }
            fetched++
            // Singular, never getTransactions: public endpoints reject batches.
            const transaction = await this.connection.getTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
            const at = (entry.blockTime ?? transaction?.blockTime ?? null)
            // A row with no block time would reach new Date(NaN).toISOString()
            // in the renderer, which throws and blanks the whole panel.
            // A not-yet-readable confirmed receipt is retryable, never a cached
            // empty result. Do not advance past it on the next poll.
            if (!transaction?.meta || at === null) { partial = true; capped = true; continue }
            if (transaction?.meta?.err) { this.decoded.set(key, []); continue }
            parsed = receiptActivity(transaction, this.manifestProgram, book, entry.signature, at * 1000)
            this.decoded.set(key, parsed)
            onProgress?.()
          }
          rows.push(...parsed)
        }
        // Advance the cursor only once the whole page has actually been decoded.
        // Moving it first meant that whenever the per-pass fetch cap cut a page
        // short, the skipped tail sat older than `until` on every later poll and
        // was never read again — rows silently missing for good.
        if (page[0] && !capped) this.newest.set(book.address, page[0].signature)
      } catch { partial = true }
    }
    while (this.decoded.size > this.cacheLimit) this.decoded.delete(this.decoded.keys().next().value as string)
    return { rows: mergeActivity(rows.filter(row => Number.isSafeInteger(row.at))), partial }
  }

  /** Cached rows only, so a re-render between polls keeps its list. */
  cached(books: readonly ActivityBook[]): VenueActivityRow[] {
    const wanted = new Set(books.map(book => book.address))
    return mergeActivity([...this.decoded].flatMap(([key, rows]) => wanted.has(key.split(':')[0]!) ? rows : []))
  }
}
