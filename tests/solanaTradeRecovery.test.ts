import { expect, test } from 'bun:test'
import { Keypair, Transaction } from '@solana/web3.js'
import type { ISolana } from '@dynamic-labs/solana-core'
import type { Wallet } from '@wallet-standard/base'
import { withWalletMetadataRecovery } from '../src/components/arena/walletStandardSolana'
import { marketBuyQuote } from '../packages/adapters/solana/manifest/quotes'
import { buyQuoteLabel, midpointLabel } from '../src/components/home/venue/quoteLabels'

test('a bid-only NO book cannot price a market buy', () => {
  expect(() => marketBuyQuote([], 5_000_000n)).toThrow('No sellers')
  const no = { id: 'no', label: 'NO', detail: '', probability: .6, marketQuote: { bid: .6 } }
  // Row buttons show one neutral placeholder; the order book keeps the wording.
  expect(buyQuoteLabel(no, true)).toBe('--')
  expect(midpointLabel(no)).toBe('60¢ bid')
})

test('market buys consume asks and respect budget at the reviewed worst price', () => {
  const quote = marketBuyQuote([{ price: 600_000n, quantity: 10_000_000n }, { price: 400_000n, quantity: 2_000_000n }], 5_000_000n)
  expect(quote.priceMicros).toBe(600_000n)
  expect(quote.quantity).toBe(8_333_333n)
  expect(quote.maximumCost).toBeLessThanOrEqual(5_000_000n)
  expect(quote.estimatedCost).toBeLessThan(quote.maximumCost)
})

test('thin asks never promise more shares than sellers have', () => {
  const quote = marketBuyQuote([{ price: 120_000n, quantity: 2_000_000n }], 100_000_000n)
  expect(quote.quantity).toBe(2_000_000n)
  expect(quote.estimatedCost).toBe(240_000n)
})

test('tiny inputs and invalid asks do not invent an executable quote', () => {
  expect(() => marketBuyQuote([{ price: 1_000_000n, quantity: 1n }], 5n)).toThrow('No sellers')
  expect(() => marketBuyQuote([], 0n)).toThrow('positive')
})

function recovery(message: string, changed = false) {
  const key = Keypair.generate().publicKey
  let connects = 0, signs = 0
  const signer = { publicKey: key, isConnected: true, signTransaction: async (tx: Transaction) => { if (++signs === 1) throw new Error(message); return tx } } as unknown as ISolana
  const wallet = { name: 'Nightly', accounts: [{ address: key.toBase58() }], features: { 'standard:connect': { connect: async () => { connects++; return { accounts: [{ address: changed ? Keypair.generate().publicKey.toBase58() : key.toBase58() }] } } } } } as unknown as Wallet
  return { signer: withWalletMetadataRecovery(signer, 'Nightly', () => [wallet]), connects: () => connects, signs: () => signs }
}

test('restored Nightly session initializes metadata and retries signing once', async () => {
  const f = recovery('Incorrect metadata'), tx = new Transaction()
  expect(await f.signer.signTransaction(tx)).toBe(tx)
  expect(f.connects()).toBe(1)
  expect(f.signs()).toBe(2)
})

test('metadata recovery refuses an account switch', async () => {
  const f = recovery('Incorrect metadata', true)
  await expect(f.signer.signTransaction(new Transaction())).rejects.toThrow('account changed')
  expect(f.signs()).toBe(1)
})

test('user rejection never triggers reconnect or another approval', async () => {
  const f = recovery('User rejected the request')
  await expect(f.signer.signTransaction(new Transaction())).rejects.toThrow('User rejected')
  expect(f.connects()).toBe(0)
  expect(f.signs()).toBe(1)
})
