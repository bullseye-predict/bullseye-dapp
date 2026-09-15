import { expect, test } from 'bun:test'
import BN from 'bn.js'
import { Buffer } from 'buffer'
import { Connection, PublicKey } from '@solana/web3.js'
import { FillLog, genAccDiscriminator } from '@bonasa-tech/manifest-sdk'
import { ManifestCandleReader } from '../packages/adapters/solana/manifest/history'
import type { ManifestBinding } from '../packages/adapters/solana/manifest/wire'

const PROGRAM = new PublicKey('11111111111111111111111111111112')
const VENUE = new PublicKey('11111111111111111111111111111113')
const MINT = new PublicKey('11111111111111111111111111111114')
const COLLATERAL = new PublicKey('11111111111111111111111111111115')

const binding = { question: PublicKey.default, program: PROGRAM, venue: VENUE, mint: MINT, collateral: COLLATERAL, recipient: PublicKey.default, bps: 100, outcome: 0 } as ManifestBinding

/** One fill at `cents`, logged inside the venue program's own frame. */
const fill = (cents: number) => {
  const shares = 1_000_000n
  const log = FillLog.fromArgs({
    market: VENUE, maker: PublicKey.default, taker: PublicKey.default, baseMint: MINT, quoteMint: COLLATERAL,
    price: { inner: new BN(0) } as never,
    baseAtoms: { inner: new BN(shares.toString()) } as never,
    // manifestCandles derives price as quoteAtoms * 1e6 / baseAtoms.
    quoteAtoms: { inner: new BN((BigInt(cents) * 10_000n).toString()) } as never,
    makerSequenceNumber: new BN(1), takerSequenceNumber: new BN(2), takerIsBuy: true, isMakerGlobal: false, padding: new Array(14).fill(0),
  })
  return `Program data: ${Buffer.concat([Buffer.from(genAccDiscriminator('manifest::logs::FillLog')), log.serialize()[0]]).toString('base64')}`
}

/** Signatures come back newest-first, exactly as the RPC returns them. */
const connectionOf = (transactions: { signature: string; blockTime: number; cents: number }[]) => ({
  getSignaturesForAddress: async () => transactions.map(t => ({ signature: t.signature, err: null, blockTime: t.blockTime, slot: 0 })),
  getTransaction: async (signature: string) => {
    const found = transactions.find(t => t.signature === signature)!
    return { blockTime: found.blockTime, meta: { err: null, logMessages: [`Program ${PROGRAM.toBase58()} invoke [1]`, fill(found.cents), `Program ${PROGRAM.toBase58()} success`] } }
  },
}) as unknown as Connection

test('two trades in the same second are returned oldest-first, so the last is genuinely the last', async () => {
  // blockTime has one-second granularity while slots are ~400ms, so this is the
  // ordinary case, not an edge case. The page is newest-first: B is newer than A.
  const reader = new ManifestCandleReader(connectionOf([
    { signature: 'B', blockTime: 1_700_000_000, cents: 70 },
    { signature: 'A', blockTime: 1_700_000_000, cents: 60 },
  ]), 8)
  const { candles } = await reader.read(binding)
  expect(candles.map(candle => Number(candle.close))).toEqual([600_000, 700_000])
  expect(Number(candles.at(-1)!.close)).toBe(700_000)
})

test('distinct seconds still sort chronologically', async () => {
  const reader = new ManifestCandleReader(connectionOf([
    { signature: 'C', blockTime: 1_700_000_002, cents: 80 },
    { signature: 'B', blockTime: 1_700_000_001, cents: 70 },
    { signature: 'A', blockTime: 1_700_000_000, cents: 60 },
  ]), 8)
  const { candles } = await reader.read(binding)
  expect(candles.map(candle => Number(candle.close))).toEqual([600_000, 700_000, 800_000])
})

test('the fetch budget is spent on the newest transactions and the rest is reported partial', async () => {
  // Newest-first fetching is deliberate: a bounded backfill must know the latest
  // price rather than an arbitrary slice of the middle of the book's history.
  const reader = new ManifestCandleReader(connectionOf([
    { signature: 'C', blockTime: 1_700_000_002, cents: 80 },
    { signature: 'B', blockTime: 1_700_000_001, cents: 70 },
    { signature: 'A', blockTime: 1_700_000_000, cents: 60 },
  ]), 1)
  const first = await reader.read(binding)
  expect(first.partial).toBe(true)
  expect(first.candles.map(candle => Number(candle.close))).toEqual([800_000])
})

test('a cached page backfills across polls and ends complete and in order', async () => {
  const reader = new ManifestCandleReader(connectionOf([
    { signature: 'C', blockTime: 1_700_000_002, cents: 80 },
    { signature: 'B', blockTime: 1_700_000_001, cents: 70 },
    { signature: 'A', blockTime: 1_700_000_000, cents: 60 },
  ]), 1)
  await reader.read(binding)
  await reader.read(binding)
  const third = await reader.read(binding)
  expect(third.partial).toBe(false)
  expect(third.candles.map(candle => Number(candle.close))).toEqual([600_000, 700_000, 800_000])
})
