import { expect, test } from 'bun:test'
import BN from 'bn.js'
import { Buffer } from 'buffer'
import { PublicKey } from '@solana/web3.js'
import { CancelOrderLog, FillLog, OrderType, PlaceOrderLog, genAccDiscriminator } from '@bonasa-tech/manifest-sdk'
import { decodeBookActivity, sortActivity, type ActivityBook } from '../src/components/home/venue/solanaActivity'

const MANIFEST = 'MNFSTGUARDEDaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const YES_BOOK = new PublicKey('11111111111111111111111111111112')
const NO_BOOK = new PublicKey('11111111111111111111111111111113')
const TRADER = new PublicKey('11111111111111111111111111111114')
const MAKER = new PublicKey('11111111111111111111111111111115')

const yes: ActivityBook = { address: YES_BOOK.toBase58(), outcome: 0, label: 'YES' }
const no: ActivityBook = { address: NO_BOOK.toBase58(), outcome: 1, label: 'NO' }

/** Manifest resting prices are a 1e18 fixed point of quote atoms per base atom. */
const fixed = (collateralAtoms: bigint) => new BN((collateralAtoms * 10n ** 12n).toString())
const frame = (name: string, body: Buffer) =>
  `Program data: ${Buffer.concat([Buffer.from(genAccDiscriminator(name)), body]).toString('base64')}`

const fill = (market: PublicKey, takerIsBuy: boolean, base: bigint, price: bigint, sequence = 2) => frame('manifest::logs::FillLog',
  FillLog.fromArgs({
    market, maker: MAKER, taker: TRADER, baseMint: PublicKey.default, quoteMint: PublicKey.default,
    price: { inner: fixed(price) } as never, baseAtoms: { inner: new BN(base.toString()) } as never,
    quoteAtoms: { inner: new BN('0') } as never,
    makerSequenceNumber: new BN(1), takerSequenceNumber: new BN(sequence), takerIsBuy, isMakerGlobal: false, padding: new Array(14).fill(0),
  }).serialize()[0])

const place = (market: PublicKey, isBid: boolean, base: bigint, price: bigint, sequence = 7) => frame('manifest::logs::PlaceOrderLog',
  PlaceOrderLog.fromArgs({
    market, trader: TRADER, price: { inner: fixed(price) } as never,
    baseAtoms: { inner: new BN(base.toString()) } as never, orderSequenceNumber: new BN(sequence),
    orderIndex: 0, lastValidSlot: 0, orderType: OrderType.Limit, isBid, padding: new Array(6).fill(0),
  }).serialize()[0])

const cancel = (market: PublicKey, sequence = 7) => frame('manifest::logs::CancelOrderLog',
  CancelOrderLog.fromArgs({ market, trader: TRADER, orderSequenceNumber: new BN(sequence) }).serialize()[0])

const logs = (...data: string[]) => [`Program ${MANIFEST} invoke [1]`, ...data, `Program ${MANIFEST} success`]
const decode = (messages: string[], book = yes) => decodeBookActivity(messages, MANIFEST, book, 'sig1', 42, 1_700_000_000_000)

test('a resting order is reported even though it never crossed', () => {
  // The whole complaint: every order on this venue rests, and a fill-only feed
  // reads empty on exactly the market the trader is staring at.
  const rows = decode(logs(place(YES_BOOK, true, 10_000_000n, 500_000n)))
  expect(rows).toHaveLength(1)
  expect(rows[0]!.kind).toBe('order')
  expect(rows[0]!.label).toBe('Buy YES placed')
  expect(rows[0]!.detail).toBe('10 shares at 50¢')
  expect(rows[0]!.owner).toBe(TRADER.toBase58())
})

test('fills, placements and cancels are all decoded, each labelled with its own book', () => {
  expect(decode(logs(fill(YES_BOOK, true, 4_000_000n, 620_000n))) [0]!.label).toBe('Buy YES filled')
  expect(decode(logs(fill(NO_BOOK, false, 4_000_000n, 380_000n)), no)[0]!.label).toBe('Sell NO filled')
  expect(decode(logs(place(NO_BOOK, false, 1_000_000n, 400_000n)), no)[0]!.label).toBe('Sell NO placed')
  expect(decode(logs(cancel(YES_BOOK)))[0]!.label).toBe('YES order cancelled')
})

test('a price is quoted in its own book terms and never inverted to the complement', () => {
  // A 38¢ NO fill is a 38¢ NO fill. Restating it as 62¢ would be the DreamDEX
  // single-pool rule, which is wrong for two independent books.
  expect(decode(logs(fill(NO_BOOK, true, 1_000_000n, 380_000n)), no)[0]!.detail).toBe('1 shares at 38¢')
})

test('the other outcome book is excluded, even in the same transaction', () => {
  const both = logs(fill(YES_BOOK, true, 1_000_000n, 550_000n), fill(NO_BOOK, true, 9_000_000n, 450_000n))
  expect(decode(both).map(row => row.detail)).toEqual(['1 shares at 55¢'])
  expect(decode(both, no).map(row => row.detail)).toEqual(['9 shares at 45¢'])
})

test('data logged under another program is not attributed to this book', () => {
  const other = 'OTHERPROGRAM1111111111111111111111111111111'
  const rows = decode([`Program ${other} invoke [1]`, place(YES_BOOK, true, 1_000_000n, 500_000n), `Program ${other} success`])
  expect(rows).toEqual([])
})

test('a taker placement that filled in the same transaction is not double counted', () => {
  const rows = decode(logs(place(YES_BOOK, true, 5_000_000n, 500_000n, 9), fill(YES_BOOK, true, 5_000_000n, 500_000n, 9)))
  expect(rows.map(row => row.kind)).toEqual(['fill'])
})

test('every row carries a finite timestamp the renderer can format', () => {
  const rows = decode(logs(fill(YES_BOOK, true, 1n, 500_000n), place(YES_BOOK, false, 1n, 700_000n)))
  expect(rows.length).toBeGreaterThan(0)
  for (const row of rows) {
    expect(Number.isSafeInteger(row.at)).toBe(true)
    expect(() => new Date(row.at).toISOString()).not.toThrow()
  }
})

test('rows sort newest slot first and stay deterministic within one slot', () => {
  const rows = sortActivity([
    { id: 'a', at: 10, hash: 'h', label: 'a', detail: '', kind: 'fill', block: 5n },
    { id: 'b', at: 30, hash: 'h', label: 'b', detail: '', kind: 'order', block: 9n },
    { id: 'c', at: 20, hash: 'h', label: 'c', detail: '', kind: 'fill', block: 5n },
  ])
  expect(rows.map(row => row.id)).toEqual(['b', 'c', 'a'])
})

import { Connection, Keypair, Transaction } from '@solana/web3.js'
import { createBatchUpdateInstruction } from '@bonasa-tech/manifest-sdk'
import { ManifestActivityReader, receiptActivity } from '../src/components/home/venue/solanaActivity'

const deployedProgram = Keypair.generate().publicKey
function loglessReceipt(book = YES_BOOK) {
  const tx = new Transaction({ feePayer: TRADER, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(createBatchUpdateInstruction({ payer: TRADER, market: book }, { params: { traderIndexHint: null, cancels: [], orders: [{ baseAtoms: new BN(2_000_000), priceMantissa: 600_000, priceExponent: -6, isBid: true, lastValidSlot: 0, orderType: OrderType.ImmediateOrCancel }] } }, deployedProgram))
  return { slot: 42, blockTime: 1_700_000_000, transaction: { message: tx.compileMessage(), signatures: ['signature'] }, meta: { err: null, logMessages: [`Program ${deployedProgram.toBase58()} invoke [1]`, `Program ${deployedProgram.toBase58()} success`], innerInstructions: [], fee: 5000, preBalances: [], postBalances: [] } } as unknown as NonNullable<Awaited<ReturnType<Connection['getTransaction']>>>
}

test('logless confirmed Manifest orders appear without claiming a fill', () => {
  const rows = receiptActivity(loglessReceipt(), deployedProgram.toBase58(), yes, 'signature', 1_700_000_000_000)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.label).toBe('Buy YES order confirmed')
  expect(rows[0]!.detail).toContain('IOC 60¢')
  expect(rows[0]!.detail).toContain('Fill details unavailable')
  expect(rows[0]!.kind).toBe('order')
  expect(receiptActivity(loglessReceipt(NO_BOOK), deployedProgram.toBase58(), yes, 'signature', 1_700_000_000_000)).toEqual([])
})

test('failed receipts cannot create activity from instruction arguments', () => {
  const receipt = loglessReceipt()
  receipt.meta!.err = { InstructionError: [0, 'InvalidArgument'] }
  expect(receiptActivity(receipt, deployedProgram.toBase58(), yes, 'signature', 1_700_000_000_000)).toEqual([])
})

test('temporarily missing receipts do not get cached or skipped by the cursor', async () => {
  const connection = new Connection('http://localhost:1')
  let reads = 0
  const cursors: unknown[] = []
  connection.getSignaturesForAddress = async (_, options) => { cursors.push(options?.until); return [{ signature: 'signature', slot: 42, blockTime: 1_700_000_000, err: null, memo: null }] }
  connection.getTransaction = (async () => ++reads === 1 ? null : loglessReceipt()) as Connection['getTransaction']
  const reader = new ManifestActivityReader(connection, deployedProgram.toBase58())
  expect((await reader.read([yes], value => new PublicKey(value))).partial).toBe(true)
  expect((await reader.read([yes], value => new PublicKey(value))).rows).toHaveLength(1)
  expect(cursors).toEqual([undefined, undefined])
})

import { createSwapInstruction } from '@bonasa-tech/manifest-sdk'
import { changePosition, vaultAddress } from '../packages/adapters/solana/wire'
import { moveClaims } from '../packages/adapters/solana/manifest/wire'
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token'

test('atomic split and opposite sale appears as the retained outcome purchase', () => {
  const buyer = Keypair.generate().publicKey
  const prediction = Keypair.generate().publicKey, question = Keypair.generate().publicKey
  const mint = Keypair.generate().publicKey, collateral = Keypair.generate().publicKey
  const binding = { question, program: deployedProgram, venue: YES_BOOK, mint, collateral, recipient:buyer, bps:30, outcome:0 as const }
  const tx = new Transaction({feePayer:buyer,recentBlockhash:Keypair.generate().publicKey.toBase58()}).add(
    changePosition(prediction,buyer,question,vaultAddress(prediction,buyer),'split',1_000_000n),
    moveClaims(prediction,buyer,binding,1_000_000n,'export'),
    createSwapInstruction({payer:buyer,market:YES_BOOK,traderBase:getAssociatedTokenAddressSync(mint,buyer),traderQuote:getAssociatedTokenAddressSync(collateral,buyer),baseVault:Keypair.generate().publicKey,quoteVault:Keypair.generate().publicKey,tokenProgramBase:TOKEN_PROGRAM_ID,baseMint:mint,tokenProgramQuote:TOKEN_PROGRAM_ID,quoteMint:collateral},{params:{inAtoms:new BN(1_000_000),outAtoms:new BN(880_000),isBaseIn:true,isExactIn:true}},deployedProgram),
  )
  const receipt = loglessReceipt()
  receipt.transaction.message = tx.compileMessage() as never
  const context = {...yes,question:question.toBase58(),predictionProgram:prediction.toBase58()}
  const rows = receiptActivity(receipt,deployedProgram.toBase58(),context,'atomic',1_700_000_000_000)
  expect(rows).toHaveLength(1)
  expect(rows[0]!.label).toBe('Buy NO completed')
  expect(rows[0]!.detail).toContain('0.12 fUSDC before fee')
  expect(receiptActivity(receipt,deployedProgram.toBase58(),{...context,question:Keypair.generate().publicKey.toBase58()},'atomic',1_700_000_000_000)).toEqual([])
  receipt.meta!.err = {InstructionError:[2,'InvalidArgument']}
  expect(receiptActivity(receipt,deployedProgram.toBase58(),context,'atomic',1_700_000_000_000)).toEqual([])
})
