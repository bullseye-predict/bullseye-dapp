import { expect, test } from 'bun:test'
import { AddressLookupTableAccount, Keypair, PublicKey, Transaction, TransactionMessage, type Connection, type TransactionInstruction, type VersionedTransactionResponse } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { accountingKey, allocateProportionally, decodeAccountingTransaction, replaySolanaAccounting, SolanaAccountingReader, type AccountingInstruction, type AccountingMarket, type AccountingTransaction } from './accounting'
import { buildFillOrders, changePosition, initializeVault, TOKEN_PROGRAM_ID, vaultAddress, vaultCollateralAddress, u64, concat, marketAddress } from './wire'
import type { PortfolioPosition } from '../../prediction-core/market-data'

const program = Keypair.generate().publicKey, owner = Keypair.generate().publicKey, otherOwner = Keypair.generate().publicKey, mint = Keypair.generate().publicKey
const vault = vaultAddress(program, owner), other = vaultAddress(program, otherOwner), market = marketAddress(program, new Uint8Array(32).fill(8))
const marketState: AccountingMarket = { id: market.toBase58(), outcomes: 2, status: 3, winner: 0, slot: 100 }
function instruction(ix: TransactionInstruction, payment?: { source: PublicKey; destination: PublicKey; authority: PublicKey; amount: bigint }): AccountingInstruction {
  return { programId: ix.programId.toBase58(), accounts: ix.keys.map(key => key.pubkey.toBase58()), data: Uint8Array.from(ix.data), inner: payment && payment.amount > 0n ? [{ programId: TOKEN_PROGRAM_ID.toBase58(), accounts: [payment.source, payment.destination, payment.authority].map(key => key.toBase58()), data: concat(Uint8Array.of(3), u64(payment.amount)) }] : [] }
}
function event(ix: AccountingInstruction, slot: number): AccountingTransaction { return { signature: `signature_${slot}`, slot, failed: false, instructions: [ix], innerAvailable: true } }
function initialize(slot = 1) { return event(instruction(initializeVault(program, owner, mint, 100n)), slot) }
function sets(action: 'split' | 'merge' | 'redeem', quantity: bigint, slot: number) {
  const ix = changePosition(program, owner, market, vault, action, action === 'redeem' ? undefined : quantity)
  const source = ix.keys[action === 'split' ? 5 : 6]!.pubkey, destination = ix.keys[action === 'split' ? 6 : 5]!.pubkey
  return event(instruction(ix, { source, destination, authority: action === 'split' ? vault : market, amount: quantity }), slot)
}
async function fill(side: 'BUY' | 'SELL', outcomeId: number, quantity: bigint, price: bigint, slot: number) {
  const buyer = side === 'BUY' ? vault : other, seller = side === 'SELL' ? vault : other
  const common = { market, outcomeId, quantity, nonce: BigInt(slot), expirySeconds: 9000n, sessionEpoch: 0n }
  const [, ix] = await buildFillOrders({ programId: program, networkDomain: new Uint8Array(32), buy: { ...common, signer: side === 'BUY' ? owner : otherOwner, vault: buyer, side: 'BUY', price: 1_000_000n }, sell: { ...common, signer: side === 'SELL' ? owner : otherOwner, vault: seller, side: 'SELL', price }, quantity, executionPrice: price, buySignature: new Uint8Array(64), sellSignature: new Uint8Array(64) })
  return event(instruction(ix, { source: vaultCollateralAddress(program, buyer), destination: vaultCollateralAddress(program, seller), authority: buyer, amount: (quantity * price + 999_999n) / 1_000_000n }), slot)
}
function replay(transactions: AccountingTransaction[], metadata = marketState) { return replaySolanaAccounting({ programId: program.toBase58(), account: vault.toBase58(), collateralMint: mint.toBase58(), markets: [metadata], transactions }) }
function snapshots(quantities: bigint[], slot = 100): PortfolioPosition[] { return quantities.map((quantity, outcomeId) => ({ account: vault.toBase58(), venue: 'SOLANA', chainId: 'fixture', marketId: market.toBase58(), outcomeId, quantity, costBasis: null, realizedPnl: null, reservedQuantity: 0n, accountingComplete: false, provenance: { source: 'ONCHAIN', observedAt: 1000, finality: 'FINALIZED', slot } })) }

test('split, average-cost sells, buys, merge and winner redemption conserve total realized cash flow', async () => {
  const transactions = [initialize(), sets('split', 10n, 2), await fill('SELL', 0, 4n, 500_000n, 3), await fill('BUY', 1, 4n, 250_000n, 4), sets('merge', 2n, 5), sets('redeem', 4n, 6)]
  const ledger = replay(transactions)
  expect(ledger.get(accountingKey(market.toBase58(), 0))).toEqual({ quantity: 0n, costBasis: 0n, realizedPnl: 2n })
  expect(ledger.get(accountingKey(market.toBase58(), 1))).toEqual({ quantity: 0n, costBasis: 0n, realizedPnl: -5n })
  expect([...ledger.values()].reduce((sum, row) => sum + row.realizedPnl, 0n)).toBe(-10n + 2n - 1n + 2n + 4n)
})

test('void accounting uses the actual transfer, including the global one-atomic rounding remainder', async () => {
  const transactions = [initialize(), sets('split', 1n, 2), await fill('SELL', 1, 1n, 1_000_000n, 3), sets('redeem', 1n, 4)]
  const ledger = replay(transactions, { ...marketState, status: 4 })
  expect(ledger.get(accountingKey(market.toBase58(), 0))!.realizedPnl).toBe(0n)
  expect(ledger.get(accountingKey(market.toBase58(), 1))!.realizedPnl).toBe(1n)
  transactions[3] = sets('redeem', 0n, 4)
  const roundedDown = replay(transactions, { ...marketState, status: 4 })
  expect(roundedDown.get(accountingKey(market.toBase58(), 0))!.realizedPnl).toBe(-1n)
  expect(allocateProportionally(5n, [0n, 1n, 2n])).toEqual([0n, 2n, 3n])
})

test('unknown history, unsupported CPI, changed transfers and unregistered markets never produce complete PnL', async () => {
  const valid = [initialize(), sets('split', 10n, 2), await fill('SELL', 0, 4n, 500_000n, 3)]
  expect(() => replay(valid.slice(1))).toThrow('vault creation')
  const corrupt = structuredClone(valid)
  corrupt[2]!.instructions[0]!.inner[0]!.data = concat(Uint8Array.of(3), u64(999n))
  expect(() => replay(corrupt)).toThrow('payment does not match')
  const cpi = structuredClone(valid)
  cpi[1]!.instructions[0]!.inner.push({ programId: program.toBase58(), accounts: [vault.toBase58()], data: Uint8Array.of(6) })
  expect(() => replay(cpi)).toThrow('CPI')
  expect(() => replaySolanaAccounting({ programId: program.toBase58(), account: vault.toBase58(), collateralMint: mint.toBase58(), markets: [], transactions: valid })).toThrow('unregistered market')
  const failed = structuredClone(valid); failed[2]!.failed = true
  expect(replay(failed).get(accountingKey(market.toBase58(), 0))!.quantity).toBe(10n)
})

/** Real web3 message encodings with canonical compiled inner instructions, for the RPC boundary tests. */
function receipt(transaction: AccountingTransaction, versioned = false): VersionedTransactionResponse {
  const instructions = transaction.instructions.map(ix => ({ programId: new PublicKey(ix.programId), data: Buffer.from(ix.data), keys: ix.accounts.map(account => ({ pubkey: new PublicKey(account), isSigner: account === owner.toBase58(), isWritable: true })) }))
  const blockhash = Keypair.generate().publicKey.toBase58()
  const legacy = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight: 100 }).add(...instructions).compileMessage()
  const table = new AddressLookupTableAccount({ key: Keypair.generate().publicKey, state: { deactivationSlot: 0xffff_ffff_ffff_ffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: legacy.accountKeys.filter(key => !key.equals(owner)), authority: undefined } })
  const message = versioned ? new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions }).compileToV0Message([table]) : legacy
  const loadedAddresses = versioned ? {
    writable: message.addressTableLookups.flatMap(lookup => lookup.writableIndexes.map(index => table.state.addresses[index]!)),
    readonly: message.addressTableLookups.flatMap(lookup => lookup.readonlyIndexes.map(index => table.state.addresses[index]!)),
  } : undefined
  const keys = message.getAccountKeys({ accountKeysFromLookups: loadedAddresses })
  const index = (key: string) => { for (let i = 0; i < keys.length; i++) if (keys.get(i)!.toBase58() === key) return i; throw new Error('Fixture inner key is absent') }
  return { slot: transaction.slot, blockTime: transaction.slot, transaction: { signatures: [transaction.signature], message }, meta: {
    err: transaction.failed ? { InstructionError: [0, 'Custom'] } : null, fee: 5000, preBalances: [], postBalances: [], loadedAddresses,
    innerInstructions: transaction.innerAvailable ? transaction.instructions.map((ix, parent) => ({ index: parent, instructions: ix.inner.map(inner => ({ programIdIndex: index(inner.programId), accounts: inner.accounts.map(index), data: base58.encode(inner.data) })) })) : null,
  } }
}

test('decoder handles v0 address lookup tables and classic compiled SPL inner transfers', () => {
  const transaction = sets('split', 10n, 2)
  const decoded = decodeAccountingTransaction(receipt(transaction, true), transaction.signature)
  expect(decoded).toEqual(transaction)
})

test('reader orders same-slot transactions canonically, retains closed losses, and rejects snapshot or pruned-history mismatches', async () => {
  const split = sets('split', 10n, 2), sale = await fill('SELL', 0, 10n, 100_000n, 2)
  split.signature = 'split'; sale.signature = 'sale'
  const all = [initialize(), split, sale, sets('redeem', 0n, 3)]
  const values = new Map(all.map(transaction => [transaction.signature, receipt(transaction)]))
  let blocks = 0, pruned = false
  const connection = {
    getSignaturesForAddress: async (_account: PublicKey, options: { before?: string }) => options.before ? [] : [...all].reverse().map(transaction => ({ signature: transaction.signature, slot: transaction.slot })),
    getTransactions: async (signatures: string[]) => signatures.map(signature => pruned ? null : values.get(signature)!),
    getBlockSignatures: async () => { blocks++; return { blockhash: 'fixture', previousBlockhash: 'fixture', parentSlot: 1, signatures: ['split', 'sale'] } },
  } as unknown as Pick<Connection, 'getSignaturesForAddress' | 'getTransactions' | 'getBlockSignatures'>
  const reader = new SolanaAccountingReader(connection, program.toBase58(), mint.toBase58())
  const complete = await reader.attach(vault.toBase58(), [marketState], snapshots([0n, 0n]), true)
  expect(complete.every(row => row.accountingComplete)).toBe(true)
  expect(complete.map(row => row.realizedPnl)).toEqual([-4n, -5n])
  expect(blocks).toBe(1)
  const mismatch = await reader.attach(vault.toBase58(), [marketState], snapshots([1n, 0n]), true)
  expect(mismatch.every(row => row.accountingComplete === false && row.costBasis === null && row.realizedPnl === null)).toBe(true)
  pruned = true
  const unavailable = await new SolanaAccountingReader(connection, program.toBase58(), mint.toBase58()).attach(vault.toBase58(), [marketState], snapshots([0n, 0n]), true)
  expect(unavailable.every(row => row.accountingComplete === false)).toBe(true)
})

test('bounded pagination refuses to invent a zero cost basis without observed vault creation', async () => {
  const only = sets('split', 10n, 2)
  const connection = { getSignaturesForAddress: async () => [{ signature: only.signature, slot: only.slot }], getTransactions: async () => [receipt(only)], getBlockSignatures: async () => { throw new Error('not needed') } } as unknown as Pick<Connection, 'getSignaturesForAddress' | 'getTransactions' | 'getBlockSignatures'>
  const rows = await new SolanaAccountingReader(connection, program.toBase58(), mint.toBase58(), { maxHistoryTransactions: 1 }).attach(vault.toBase58(), [marketState], snapshots([10n, 10n]), true)
  expect(rows.every(row => row.accountingComplete === false && row.realizedPnl === null)).toBe(true)
})
