import './runtime'
import { Buffer } from 'buffer'
import { FillLog } from '@bonasa-tech/manifest-sdk'
import type { Connection } from '@solana/web3.js'
import type { Candle } from '../../../prediction-core/market-data'
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
