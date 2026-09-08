import { expect, test } from 'bun:test'
import { Keypair, PublicKey, Transaction } from '@solana/web3.js'
import { base58 } from '@scure/base'
import { PredictionDatabase } from '../api/storage/database'
import { ChainSubmissionJournal } from './journal'
import { SolanaSettlementTransport } from '../../packages/adapters/solana/transport'
import { concat, marketAddress, orderDigest, orderStateAddress, positionAddress, u64, vaultAddress } from '../../packages/adapters/solana/wire'
import { solanaWireOrder } from '../../packages/adapters/solana/SolanaPredictionVenue'
import { solanaResultDigest, verifySolanaResultAttestation } from '../../packages/adapters/solana/results'
import type { SolanaGatewayConfig } from '../../packages/adapters/solana/gateway'
import type { SignedMatchResult, SignedOrder } from '../../packages/prediction-core/types'
import type { PlannedSettlement } from '../matcher/settlement'

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n))
async function fixture() {
  const database = new PredictionDatabase()
  const journal = new ChainSubmissionJournal(database)
  const program = key(8)
  const networkDomain = new Uint8Array(32).fill(9)
  const matchId = new Uint8Array(32).fill(7)
  const market = marketAddress(program, matchId)
  const config: SolanaGatewayConfig = { family: 'SOLANA', venue: 'SOLANA', chainId: key(10).toBase58(), rpcUrl: 'http://127.0.0.1:1', programId: program.toBase58(), networkDomain: Buffer.from(networkDomain).toString('hex'), collateralToken: key(11).toBase58(), collateralDecimals: 6, oracleAuthority: key(12).toBase58(), markets: { [market.toBase58()]: { matchId: `0x${Buffer.from(matchId).toString('hex')}`, outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }] } } }
  const records = new Map<string, { owner: PublicKey; data: Buffer }>()
  async function order(side: 'BUY' | 'SELL'): Promise<SignedOrder> {
    const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
    const owner = new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
    const vault = vaultAddress(program, owner)
    const row: SignedOrder = { venue: 'SOLANA', chainId: config.chainId, marketId: market.toBase58(), orderId: '', maker: vault.toBase58(), outcomeId: 0, side, price: side === 'BUY' ? 600000n : 500000n, quantity: 1000000n, nonce: 10n, expiresAt: 1900000000000, signature: JSON.stringify({ scheme: 'SOLZ_SOLANA_V1', signer: owner.toBase58(), sessionEpoch: '0', signature: '0'.repeat(128) }) }
    const digest = await orderDigest(program, networkDomain, solanaWireOrder(row))
    row.orderId = `0x${Buffer.from(digest).toString('hex')}`
    row.signature = JSON.stringify({ ...JSON.parse(row.signature), signature: Buffer.from(await crypto.subtle.sign('Ed25519', pair.privateKey, Uint8Array.from(digest).buffer)).toString('hex') })
    records.set(positionAddress(program, market, vault).toBase58(), { owner: program, data: Buffer.from(concat(new TextEncoder().encode('SOLZPOS1'), vault.toBytes(), market.toBytes(), ...Array.from({ length: 16 }, () => u64(1000000n)), Uint8Array.of(255))) })
    records.set(orderStateAddress(program, vault, row.nonce).toBase58(), { owner: program, data: Buffer.from(concat(new TextEncoder().encode('SOLZORD1'), vault.toBytes(), u64(row.nonce), u64(0n), u64(0n), Uint8Array.of(0, 0), new Uint8Array(138))) })
    return row
  }
  const buy = await order('BUY'); const sell = await order('SELL')
  const plan: PlannedSettlement = { id: 'plan', venue: 'SOLANA', chainId: config.chainId, marketId: market.toBase58(), buy, sell, quantity: 1000000n, price: 500000n, collateral: 500000n, status: 'PLANNED', createdAt: 1000, updatedAt: 1000 }
  const relayer = Keypair.generate()
  let raw: Uint8Array | undefined
  let sends = 0; let blockhashes = 0; let finalized = false; let tamper = false; let height = 90
  const attach = (transport: SolanaSettlementTransport) => {
    Object.assign(transport.connection, {
      getGenesisHash: async () => config.chainId,
      getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(address => records.get(address.toBase58()) ?? null),
      getLatestBlockhash: async () => { blockhashes++; return { blockhash: key(13).toBase58(), lastValidBlockHeight: 100 } },
      getBlockHeight: async () => height,
      getSignatureStatuses: async () => ({ value: [raw && finalized ? { confirmationStatus: 'finalized', err: null } : null] }),
      getTransaction: async (signature: string) => {
        const original = Transaction.from(raw!)
        if (tamper) original.instructions[3]!.data[0] = 255
        return { transaction: { signatures: [signature], message: original.compileMessage() }, meta: { err: null }, blockTime: 1800000000 }
      },
      sendRawTransaction: async (bytes: Uint8Array) => {
        sends++
        expect(database.sql.query<{ payload: string }, []>('SELECT payload FROM chain_submissions').all().some(row => row.payload.includes(Buffer.from(bytes).toString('base64')))).toBe(true)
        raw = Uint8Array.from(bytes)
        expect(raw.length).toBeLessThanOrEqual(1232)
        const transaction = Transaction.from(raw)
        expect(transaction.verifySignatures()).toBe(true)
        expect(transaction.instructions).toHaveLength(4)
        // Both Ed25519 descriptors reference the actual fourth instruction.
        expect(transaction.instructions[2]!.data.readUInt16LE(4)).toBe(3)
        return base58.encode(transaction.signature!)
      },
    })
    return transport
  }
  return { database, journal, config, plan, relayer, attach, sends: () => sends, blockhashes: () => blockhashes, finalize: () => { finalized = true }, tamper: (value: boolean) => { tamper = value }, expire: () => { height = 101 } }
}

test('Solana transport persists before RPC, verifies exact finalized message, and recovers without signer or rebroadcast', async () => {
  const f = await fixture()
  try {
    const first = f.attach(new SolanaSettlementTransport(f.config, { journal: f.journal, relayer: f.relayer, writesEnabled: true }))
    const pending = await first.submit(f.plan)
    expect(pending.status).toBe('PENDING')
    expect(f.sends()).toBe(1)
    const restarted = f.attach(new SolanaSettlementTransport(f.config, { journal: new ChainSubmissionJournal(f.database), writesEnabled: false }))
    f.finalize(); f.tamper(true)
    expect((await restarted.lookup(f.plan)).status).toBe('UNKNOWN')
    f.tamper(false)
    const receipt = await restarted.lookup(f.plan)
    expect(receipt.status).toBe('CONFIRMED')
    expect(f.sends()).toBe(1)
    expect(f.blockhashes()).toBe(1)
    expect(restarted.lookup({ ...f.plan, quantity: 2_000_000n, collateral: 1_000_000n })).rejects.toThrow('another intent')
  } finally { f.database.close() }
})

test('expired ambiguous Solana transaction never obtains a new blockhash or releases its reservation', async () => {
  const f = await fixture()
  try {
    const first = f.attach(new SolanaSettlementTransport(f.config, { journal: f.journal, relayer: f.relayer, writesEnabled: true }))
    await first.submit(f.plan)
    f.expire()
    const second = f.attach(new SolanaSettlementTransport(f.config, { journal: new ChainSubmissionJournal(f.database), relayer: f.relayer, writesEnabled: true }))
    expect((await second.lookup(f.plan)).status).toBe('PENDING')
    expect(f.blockhashes()).toBe(1)
    expect(f.sends()).toBe(1)
  } finally { f.database.close() }
})

test('Solana result attestation binds outcome, chain, program and explicit expiry', async () => {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const config = { programId: key(8).toBase58(), chainId: key(10).toBase58(), networkDomain: '09'.repeat(32), oracleAuthority: new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))).toBase58() }
  const result: SignedMatchResult = { venue: 'SOLANA', chainId: config.chainId, marketId: key(7).toBase58(), matchId: `0x${'01'.repeat(32)}`, winningOutcomeId: 0, voided: false, stateHash: `0x${'02'.repeat(32)}`, matchEndedAt: 1000, expiresAt: 2000, signature: '' }
  const digest = await solanaResultDigest(result, config)
  result.signature = JSON.stringify({ scheme: 'SOLZ_SOLANA_RESULT_V1', signature: Buffer.from(await crypto.subtle.sign('Ed25519', pair.privateKey, digest)).toString('hex') })
  expect(await verifySolanaResultAttestation(result, config)).toBe(true)
  expect(await verifySolanaResultAttestation({ ...result, winningOutcomeId: 1 }, config)).toBe(false)
  expect(await verifySolanaResultAttestation({ ...result, expiresAt: 3000 }, config)).toBe(false)
  expect(await verifySolanaResultAttestation(result, { ...config, programId: key(9).toBase58() })).toBe(false)
  expect(await verifySolanaResultAttestation(result, { ...config, chainId: key(9).toBase58() })).toBe(false)
})
