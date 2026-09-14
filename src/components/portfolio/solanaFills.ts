import { Connection, PublicKey } from '@solana/web3.js'
import { FillLog } from '@bonasa-tech/manifest-sdk'
import { MANIFEST_LOG, manifestProgramFrames } from '../../../packages/adapters/solana/manifest/logs'
import type { CashFlow } from './cashFlow'

const FILL_DISCRIMINATOR = MANIFEST_LOG.fill

/** Program data emitted while `target` was the active invocation frame.
 *  The frame walker now lives beside the Manifest wire format so the activity
 *  feed can share it without src/components/home reaching into the portfolio. */
export function manifestProgramData(messages: readonly string[], target: string): string[] {
  return manifestProgramFrames(messages, target).map(frame => frame.encoded)
}

export type ManifestFill = {
  id: string
  at: number
  marketId: string
  outcome: 0 | 1
  side: 'BUY' | 'SELL'
  /** Shares matched. */
  shares: bigint
  /** Collateral atoms paid or received. */
  collateral: bigint
}

/** Every fill in one transaction that this trader was a party to. Exported for
 *  tests: the log shape is the part worth pinning, not the RPC plumbing. */
export function decodeTraderFills(logs: readonly string[], manifestProgram: string, owner: string, book: { address: string; marketId: string; outcome: 0 | 1 }, signature: string, at: number): ManifestFill[] {
  const fills: ManifestFill[] = []
  manifestProgramData(logs, manifestProgram).forEach((encoded, index) => {
    let data: Buffer
    try { data = Buffer.from(encoded, 'base64') } catch { return }
    if (data.length <= 8 || !data.subarray(0, 8).equals(FILL_DISCRIMINATOR)) return
    let log: FillLog
    try { log = FillLog.deserialize(data.subarray(8))[0] } catch { return }
    if (log.market.toBase58() !== book.address) return
    const isMaker = log.maker.toBase58() === owner
    const isTaker = log.taker.toBase58() === owner
    // Not this trader's fill, or a self-match: matching oneself moves no
    // collateral, and booking both legs would invent a purchase and a sale.
    if (isMaker === isTaker) return
    // The maker always takes the side the taker did not.
    const buying = isTaker ? log.takerIsBuy : !log.takerIsBuy
    const side: 'BUY' | 'SELL' = buying ? 'BUY' : 'SELL'
    fills.push({
      id: `${signature}:${index}`, at, marketId: book.marketId, outcome: book.outcome, side,
      shares: BigInt(log.baseAtoms.inner.toString()), collateral: BigInt(log.quoteAtoms.inner.toString()),
    })
  })
  return fills
}

export const fillCashFlow = (fill: ManifestFill): CashFlow => ({ id: fill.id, at: fill.at, amount: fill.side === 'BUY' ? -fill.collateral : fill.collateral })

export type ManifestHistory = { fills: ManifestFill[]; limited: boolean; error: boolean }

/**
 * Executed trade history for one trader, read from the books they traded on.
 *
 * Manifest keeps maker seats inside the market account, so a resting order that
 * someone else fills never names the maker in the transaction's account list —
 * scanning the trader's own signatures would silently lose every maker fill.
 * The books are scanned instead, and the trader is matched from the fill log.
 *
 * Finalized receipts are immutable, so parsed fills are cached per signature and
 * a later poll only pays for signatures it has not seen.
 */
export class ManifestFillReader {
  private readonly receipts = new Map<string, ManifestFill[]>()
  constructor(private readonly connection: Connection, private readonly manifestProgram: string, private readonly maxTransactions = 240) {}

  async read(owner: string, books: readonly { address: string; marketId: string; outcome: 0 | 1 }[], signal?: AbortSignal): Promise<ManifestHistory> {
    const fills: ManifestFill[] = []
    let scanned = 0
    let limited = false
    let error = false
    for (const book of books) {
      if (signal?.aborted) break
      try {
        const venue = new PublicKey(book.address)
        let before: string | undefined
        for (;;) {
          if (scanned >= this.maxTransactions) { limited = true; break }
          const page = await this.connection.getSignaturesForAddress(venue, { before, limit: Math.min(100, this.maxTransactions - scanned) }, 'confirmed')
          if (!page.length) break
          for (const item of page) {
            scanned++
            if (signal?.aborted) return { fills, limited, error }
            if (item.err) continue
            const cached = this.receipts.get(item.signature)
            if (cached) { fills.push(...cached.filter(fill => fill.marketId === book.marketId && fill.outcome === book.outcome)); continue }
            // Public endpoints reject JSON-RPC batches, so receipts are fetched
            // one at a time; the cache is what keeps this off the polling path.
            const transaction = await this.connection.getTransaction(item.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 })
            const logs = transaction?.meta?.logMessages
            if (!logs || transaction.meta?.err) { this.receipts.set(item.signature, []); continue }
            const at = (item.blockTime ?? transaction.blockTime ?? 0) * 1000
            const parsed = decodeTraderFills(logs, this.manifestProgram, owner, book, item.signature, at)
            this.receipts.set(item.signature, parsed)
            fills.push(...parsed)
          }
          if (page.length < 100) break
          before = page[page.length - 1]!.signature
        }
      } catch { error = true }
    }
    while (this.receipts.size > this.maxTransactions * 4) this.receipts.delete(this.receipts.keys().next().value!)
    return { fills: fills.sort((left, right) => left.at - right.at || left.id.localeCompare(right.id)), limited, error }
  }
}
