import { describe, expect, test } from 'bun:test'
import { PublicKey, Transaction } from '@solana/web3.js'
import { createHash } from 'node:crypto'
import { buildFillOrders, concat, configAddress, createQuestionMarket, encodeEd25519Descriptors, encodeOrderBody, encodeOrderMessage, millisecondsToSeconds, orderDigest, orderStateAddress, questionMarketAddress, u64, vaultAddress, type SolanaOrder } from './wire'
import { requestAuthMessage } from '../../sdk/auth'
import { decodeVault } from './accounts'
import { createSolanaOrderSigner, createSolanaRequestSigner, solanaWireOrder, verifySolanaOrder, verifySolanaRequest, type SolanaVenueConfig } from './SolanaPredictionVenue'

const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n))
const programId = key(8)
const domain = new Uint8Array(32).fill(9)
const sample: SolanaOrder = { signer: key(1), vault: key(2), market: key(3), outcomeId: 1, side: 'BUY', price: 620_000n, quantity: 10_000_000n, nonce: 42n, expirySeconds: 1_800_000_000n, sessionEpoch: 7n }
const toHex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')

describe('Solana canonical wire format', () => {
  test('uses fixed widths, explicit seconds, and the exact versioned hash preimage', async () => {
    const body = encodeOrderBody(sample)
    expect(body.length).toBe(138)
    expect(body[96]).toBe(1)
    expect(body[97]).toBe(0)
    expect(new DataView(body.buffer).getBigUint64(98, true)).toBe(620_000n)
    const message = encodeOrderMessage(programId, domain, sample)
    expect(toHex(await orderDigest(programId, domain, sample))).toBe(createHash('sha256').update(message).digest('hex'))
    expect(toHex(await orderDigest(programId, domain, sample))).toBe('c6cbfa550f4da603ef717d89b24745c35f09d18be6be045a1d090a3feebe19dc')
    expect(millisecondsToSeconds(1_800_000_000_999)).toBe(1_800_000_000n)
    expect(() => u64(-1n)).toThrow()
    expect(() => u64(1n << 64n)).toThrow()
    expect(() => encodeOrderBody({ ...sample, outcomeId: 16 })).toThrow()
  })
  test('binds network, program, signer and session epoch independently', async () => {
    const original = toHex(await orderDigest(programId, domain, sample))
    expect(toHex(await orderDigest(key(10), domain, sample))).not.toBe(original)
    expect(toHex(await orderDigest(programId, new Uint8Array(32).fill(10), sample))).not.toBe(original)
    expect(toHex(await orderDigest(programId, domain, { ...sample, signer: key(10) }))).not.toBe(original)
    expect(toHex(await orderDigest(programId, domain, { ...sample, sessionEpoch: 8n }))).not.toBe(original)
  })
  test('builds a 2-signature precompile pointing to the actual fill instruction', async () => {
    const sell: SolanaOrder = { ...sample, side: 'SELL', signer: key(4), vault: key(5), price: 600_000n }
    const pair = await buildFillOrders({ programId, networkDomain: domain, buy: sample, sell, quantity: 10_000_000n, executionPrice: 600_000n, buySignature: new Uint8Array(64), sellSignature: new Uint8Array(64) })
    expect(pair[0].data).toEqual(Buffer.from(encodeEd25519Descriptors(1)))
    expect(pair[1].data.length).toBe(485)
    expect(pair[1].data.subarray(1, 139)).toEqual(Buffer.from(encodeOrderBody(sample)))
    expect(pair[1].keys.length).toBe(12)
    const transaction = new Transaction({ feePayer: key(11), recentBlockhash: key(12).toBase58() }).add(...pair)
    expect(transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length).toBeLessThanOrEqual(1232)
    await expect(buildFillOrders({ programId, networkDomain: domain, buy: { ...sample, price: 500_000n }, sell: { ...sell, price: 500_000n }, quantity: 1n, executionPrice: 500_000n, buySignature: new Uint8Array(64), sellSignature: new Uint8Array(64) })).rejects.toThrow('rounding')
  })
  test('derives one permissionless market PDA per match and question', () => {
    const matchId = new Uint8Array(32).fill(7)
    const winner = new Uint8Array(32).fill(8)
    const kills = new Uint8Array(32).fill(9)
    const winnerIx = createQuestionMarket(programId, key(1), key(2), matchId, winner)
    expect(winnerIx.data.length).toBe(65)
    expect(winnerIx.data[0]).toBe(27)
    expect(winnerIx.keys[2]!.pubkey.equals(questionMarketAddress(programId, matchId, winner))).toBe(true)
    expect(winnerIx.keys[2]!.pubkey.equals(questionMarketAddress(programId, matchId, kills))).toBe(false)
    expect(winnerIx.keys[0]!.isSigner).toBe(true)
  })
})

async function signerFixture() {
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']) as CryptoKeyPair
  const owner = new PublicKey(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
  const signer = { publicKey: owner, signMessage: async (message: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, Uint8Array.from(message).buffer)) }
  const vault = vaultAddress(programId, owner)
  let epoch = 0n
  let spentCapital = 0n
  let agent: PublicKey | undefined
  const nonces = new Map<string, Uint8Array>()
  const configuration = concat(new TextEncoder().encode('SOLZCFG1'), key(20).toBytes(), key(21).toBytes(), key(22).toBytes(), domain, Uint8Array.of(0, 255))
  const vaultData = () => concat(new TextEncoder().encode('SOLZVLT2'), owner.toBytes(), agent?.toBytes() ?? new Uint8Array(32), key(22).toBytes(), key(23).toBytes(), u64(1000n), u64(0n), u64(1000n), u64(100n), u64(100n), u64(agent ? 2000n : 0n), u64(epoch), Uint8Array.of(agent ? 1 : 0, 255, 255), u64(spentCapital))
  const config: SolanaVenueConfig = { programId, networkDomain: domain, chainId: 'local-test', now: () => 1_000_000, readAccount: async account => account.equals(configAddress(programId)) ? { owner: programId, data: configuration } : account.equals(vault) ? { owner: programId, data: vaultData() } : nonces.has(account.toBase58()) ? { owner: programId, data: nonces.get(account.toBase58())! } : null }
  return { owner, signer, vault, config, vaultData,
    setSpentCapital: (value: bigint) => { spentCapital = value },
    useAgent: (value: PublicKey) => { agent = value },
    setNonce: (nonce: bigint, cancelled: boolean, filled: bigint, body?: Uint8Array) => {
      nonces.set(orderStateAddress(programId, vault, nonce).toBase58(), concat(new TextEncoder().encode('SOLZORD1'), vault.toBytes(), u64(nonce), u64(epoch), u64(filled), Uint8Array.of(Number(cancelled), Number(!!body)), body ?? new Uint8Array(138)))
    }, revoke: () => { epoch += 1n }, pause: () => { configuration[136] = 1 } }
}
describe('Solana vault-aware authentication', () => {
  test('requires actual Ed25519 signatures, configured domain and current on-chain epoch', async () => {
    const f = await signerFixture()
    const sign = createSolanaOrderSigner(f.config, f.owner, f.signer, async () => 99n)
    const order = await sign({ marketId: key(30).toBase58(), outcomeId: 0, side: 'BUY', price: 500_000n, quantity: 20n, expiresAt: 1_100_000 })
    expect(order.maker).toBe(f.vault.toBase58())
    expect(await verifySolanaOrder(order, f.config)).toBe(true)
    expect(await verifySolanaOrder({ ...order, quantity: 21n }, f.config)).toBe(false)
    expect(await verifySolanaOrder({ ...order, chainId: 'another-chain' }, f.config)).toBe(false)
    expect(await verifySolanaOrder(order, { ...f.config, networkDomain: new Uint8Array(32) })).toBe(false)
    f.revoke()
    expect(await verifySolanaOrder(order, f.config)).toBe(false)
  })
  test('binds authenticated requests to message and epoch, allowing exits while globally paused', async () => {
    const f = await signerFixture()
    const sign = createSolanaRequestSigner(f.config, f.owner, f.signer)
    f.pause()
    const signature = await sign('cancel authenticated order 99')
    expect(await verifySolanaRequest(f.vault.toBase58(), 'cancel authenticated order 99', signature, f.config)).toBe(true)
    expect(await verifySolanaRequest(f.vault.toBase58(), 'withdraw', signature, f.config)).toBe(false)
    const changed = JSON.stringify({ ...JSON.parse(signature), sessionEpoch: '1' })
    f.revoke()
    expect(await verifySolanaRequest(f.vault.toBase58(), 'cancel authenticated order 99', changed, f.config)).toBe(false)
  })
  test('rejects spoofed program ownership and noncanonical vault addresses', async () => {
    const f = await signerFixture()
    expect(() => decodeVault({ address: f.vault, owner: key(99), data: f.vaultData() }, programId)).toThrow('another program')
    expect(() => decodeVault({ address: key(99), owner: programId, data: f.vaultData() }, programId)).toThrow('Noncanonical')
  })
})


describe('Solana API admission uses current on-chain policy', () => {
  test('session requests are restricted to order placement/cancellation and require HTTP metadata', async () => {
    const owner = await signerFixture(); const agent = await signerFixture()
    owner.useAgent(agent.owner)
    const sign = createSolanaRequestSigner(owner.config, owner.owner, agent.signer)
    const proof = { venue: 'SOLANA' as const, chainId: 'local-test', account: owner.vault.toBase58(), nonce: 'request-1', expiresAt: 1_030_000 }
    const path = '/orders/order-1?venue=SOLANA&chainId=local-test'
    const message = await requestAuthMessage('local', 'DELETE', path, '', proof)
    const signature = await sign(message)
    expect(await verifySolanaRequest(owner.vault.toBase58(), message, signature, owner.config)).toBe(false)
    expect(await verifySolanaRequest(owner.vault.toBase58(), message, signature, owner.config, { method: 'DELETE', path })).toBe(true)
    expect(await verifySolanaRequest(owner.vault.toBase58(), message, signature, owner.config, { method: 'PUT', path: '/hermes/config' })).toBe(false)
    const configure = await requestAuthMessage('local', 'PUT', '/hermes/config', '{}', proof)
    await expect(sign(configure)).rejects.toThrow('only place or cancel')
    const place = await requestAuthMessage('local', 'POST', '/orders', '{"orderId":"signed-child"}', proof)
    const placedSignature = await sign(place)
    expect(await verifySolanaRequest(owner.vault.toBase58(), place, placedSignature, owner.config, { method: 'POST', path: '/orders' })).toBe(true)
    for (const path of ['/executions', '/hermes/start', '/vault/withdraw', '/markets/m/redeem']) {
      await expect(sign(await requestAuthMessage('local', 'POST', path, '{}', proof))).rejects.toThrow('only place or cancel')
    }
    // Even a session that signs outside the client helper cannot increase policy.
    const raw = new TextEncoder().encode(['SOLZ_SOLANA_REQUEST_V1', programId.toBase58(), toHex(domain), '0', configure].join('\n'))
    const malicious = JSON.stringify({ scheme: 'SOLZ_SOLANA_V1', signer: agent.owner.toBase58(), sessionEpoch: '0', signature: toHex(await agent.signer.signMessage(raw)) })
    expect(await verifySolanaRequest(owner.vault.toBase58(), configure, malicious, owner.config, { method: 'PUT', path: '/hermes/config' })).toBe(false)
    const ownerSignature = await createSolanaRequestSigner(owner.config, owner.owner, owner.signer)(configure)
    expect(await verifySolanaRequest(owner.vault.toBase58(), configure, ownerSignature, owner.config, { method: 'PUT', path: '/hermes/config' })).toBe(true)
  })
  test('canceled, fully filled and differently bound nonces cannot reenter the book', async () => {
    const f = await signerFixture()
    const order = await createSolanaOrderSigner(f.config, f.owner, f.signer, async () => 99n)({ marketId: key(30).toBase58(), outcomeId: 0, side: 'BUY', price: 500_000n, quantity: 20n, expiresAt: 1_100_000 })
    f.setNonce(99n, true, 0n)
    expect(await verifySolanaOrder(order, f.config)).toBe(false)
    f.setNonce(99n, false, 20n)
    expect(await verifySolanaOrder(order, f.config)).toBe(false)
    f.setNonce(99n, false, 0n, new Uint8Array(138))
    expect(await verifySolanaOrder(order, f.config)).toBe(false)
    f.setNonce(99n, false, 0n)
    expect(await verifySolanaOrder(order, f.config)).toBe(true)
  })
})


test('API session budget tracks remaining signed quantity and preserves owner control', async () => {
  const owner = await signerFixture(); const agent = await signerFixture(); owner.useAgent(agent.owner)
  const input = { marketId: key(30).toBase58(), outcomeId: 0, side: 'BUY' as const, price: 500_000n, quantity: 20n, expiresAt: 1_100_000 }
  const sign = createSolanaOrderSigner(owner.config, owner.owner, agent.signer, async () => 99n)
  const order = await sign(input)
  owner.setSpentCapital(995n)
  expect(await verifySolanaOrder(order, owner.config)).toBe(false)
  await expect(sign(input)).rejects.toThrow('capital')
  owner.setNonce(99n, false, 10n, encodeOrderBody(solanaWireOrder(order)))
  expect(await verifySolanaOrder(order, owner.config)).toBe(true)
  owner.setSpentCapital(1000n)
  expect(await verifySolanaOrder(order, owner.config)).toBe(false)
  const manual = await createSolanaOrderSigner(owner.config, owner.owner, owner.signer, async () => 100n)(input)
  expect(await verifySolanaOrder(manual, owner.config)).toBe(true)
})
