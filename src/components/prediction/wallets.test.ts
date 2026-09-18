import { expect, test } from 'bun:test'
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import type { EIP1193Provider } from 'viem'
import type { LiveArenaWalletPort } from '../arena/liveArenaAdapter'
import type { Market } from '../../../packages/prediction-core/types'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { TOKEN_PROGRAM_ID, vaultAddress, vaultCollateralAddress } from '../../../packages/adapters/solana/wire'
import { connectEvmTradingWallet, connectSolanaTradingWallet } from './wallets'

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
function solanaFixture() {
  const owner = Keypair.generate(), other = Keypair.generate(), program = Keypair.generate().publicKey, mint = Keypair.generate().publicKey
  const config: PublicPredictionVenue = { family: 'SOLANA', venue: 'SOLANA', chainId: Keypair.generate().publicKey.toBase58(), programId: program.toBase58(), networkDomain: '22'.repeat(32), collateralToken: mint.toBase58(), collateralDecimals: 6, collateralSymbol: 'USDC', label: 'Fixture Solana' }
  const market: Market = { id: Keypair.generate().publicKey.toBase58(), matchId: `0x${'aa'.repeat(32)}`, marketAddress: '', venue: 'SOLANA', chainId: config.chainId, collateralToken: config.collateralToken, collateralDecimals: 6,
    outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }], status: 'TRADING', paused: false, createdAt: 0, tradingStartsAt: 1000, tradingLocksAt: Date.now() + 60_000, expiresAt: Date.now() + 120_000 }
  market.marketAddress = market.id
  const transactions: Transaction[] = []
  let prompts = 0, signerReads = 0
  let prompt: ((transaction: Transaction) => Promise<void>) | undefined
  let currentKey = owner.publicKey
  let connected = true
  const signer = () => ({ publicKey: currentKey, isConnected: connected,
    signTransaction: async (transaction: Transaction) => { prompts++; await prompt?.(transaction); transaction.partialSign(owner); return transaction },
    signMessage: async () => ({ signature: new Uint8Array(64) }),
  }) as unknown as Awaited<ReturnType<LiveArenaWalletPort['getSigner']>>
  const connection = {
    getGenesisHash: async () => config.chainId,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getAccountInfo: async (address: PublicKey) => address.equals(vaultAddress(program, owner.publicKey)) ? { owner: program, data: new Uint8Array() } : null,
    sendRawTransaction: async (raw: Uint8Array) => { transactions.push(Transaction.from(raw)); return 'fixture-transaction' },
    getSignatureStatuses: async () => ({ context: { slot: 1 }, value: [{ err: null, confirmationStatus: 'confirmed' }] }),
    getBlockHeight: async () => 1,
  } as unknown as Connection
  const port: LiveArenaWalletPort = { address: owner.publicKey.toBase58(), getConnection: async () => connection, getSigner: async () => { signerReads++; return signer() } }
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch() { return Response.json({ account: vaultAddress(program, owner.publicKey).toBase58(), collateralToken: mint.toBase58(), total: '1000000', available: '1000000', reserved: '0' }) } })
  return { owner, other, program, mint, config, market, port, transactions, api,
    get prompts() { return prompts }, get signerReads() { return signerReads },
    setPrompt(value: (transaction: Transaction) => Promise<void>) { prompt = value },
    setSigner(key: PublicKey) { currentKey = key }, disconnect() { connected = false },
    connect: () => connectSolanaTradingWallet(config, `http://127.0.0.1:${api.port}`, 'fixture', port),
  }
}

test('Solana trading uses the current signer and rejects account changes before opening a prompt', async () => {
  const fixture = solanaFixture()
  try {
    const wallet = await fixture.connect()
    fixture.setSigner(fixture.other.publicKey)
    const result = await wallet.collateral('deposit', fixture.market, 10n).then(() => '', error => error.message)
    expect(result).toContain('account or Solana network changed')
    expect(fixture.prompts).toBe(0); expect(fixture.transactions).toHaveLength(0)
    expect(fixture.signerReads).toBeGreaterThanOrEqual(2)
  } finally { fixture.api.stop(true) }
})

test('disposing a Solana wallet during the signature prompt prevents broadcast of the signed transaction', async () => {
  const fixture = solanaFixture(), entered = deferred(), finish = deferred()
  fixture.setPrompt(async () => { entered.release(); await finish.promise })
  try {
    const wallet = await fixture.connect()
    const result = wallet.collateral('deposit', fixture.market, 10n).then(() => '', error => error.message)
    await entered.promise
    wallet.dispose(); finish.release()
    expect(await result).toContain('disconnected')
    expect(fixture.transactions).toHaveLength(0)
  } finally { finish.release(); fixture.api.stop(true) }
})

test('a disconnected signer and a changed signed message are rejected after wallet prompts', async () => {
  const disconnected = solanaFixture()
  disconnected.setPrompt(async () => { disconnected.disconnect() })
  try {
    const wallet = await disconnected.connect()
    expect(await wallet.collateral('deposit', disconnected.market, 10n).then(() => '', error => error.message)).toContain('account or Solana network changed')
    expect(disconnected.transactions).toHaveLength(0)
  } finally { disconnected.api.stop(true) }
  const changed = solanaFixture()
  changed.setPrompt(async transaction => { transaction.add(SystemProgram.transfer({ fromPubkey: changed.owner.publicKey, toPubkey: changed.other.publicKey, lamports: 1 })) })
  try {
    const wallet = await changed.connect()
    expect(await wallet.collateral('deposit', changed.market, 10n).then(() => '', error => error.message)).toContain('changed the requested transaction')
    expect(changed.transactions).toHaveLength(0)
  } finally { changed.api.stop(true) }
})

test('Solana withdrawal recreates the owner ATA idempotently before moving escrow collateral', async () => {
  const fixture = solanaFixture()
  try {
    const wallet = await fixture.connect()
    expect((await wallet.collateral('withdraw', fixture.market, 100n)).status).toBe('CONFIRMED')
    const transaction = fixture.transactions[0]!
    const ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
    const ata = PublicKey.findProgramAddressSync([fixture.owner.publicKey.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), fixture.mint.toBuffer()], ataProgram)[0]
    expect(transaction.instructions).toHaveLength(2)
    const create = transaction.instructions[0]!, withdraw = transaction.instructions[1]!
    expect(create.programId.equals(ataProgram)).toBe(true)
    expect([...create.data]).toEqual([1])
    expect(create.keys.map(key => key.pubkey.toBase58())).toEqual([fixture.owner.publicKey, ata, fixture.owner.publicKey, fixture.mint, SystemProgram.programId, TOKEN_PROGRAM_ID].map(key => key.toBase58()))
    expect(withdraw.programId.equals(fixture.program)).toBe(true)
    expect(withdraw.data[0]).toBe(5)
    expect(withdraw.keys[3]!.pubkey.equals(vaultCollateralAddress(fixture.program, vaultAddress(fixture.program, fixture.owner.publicKey)))).toBe(true)
    expect(withdraw.keys[4]!.pubkey.equals(ata)).toBe(true)
  } finally { fixture.api.stop(true) }
})

test('EVM disposal rejects an in-flight order signature before it can reach the prediction API', async () => {
  const entered = deferred(), finish = deferred(), owner = `0x${'11'.repeat(20)}`
  const config: PublicPredictionVenue = { family: 'EVM', venue: 'EVM', chainId: '1', label: 'Fixture EVM', collateralToken: `0x${'22'.repeat(20)}`, collateralDecimals: 6, collateralSymbol: 'USDC', settlementAddress: `0x${'33'.repeat(20)}`, factoryAddress: `0x${'44'.repeat(20)}`, oracleAddress: `0x${'55'.repeat(20)}` }
  const now = Date.now(), market: Market = { id: `0x${'aa'.repeat(32)}`, matchId: `0x${'bb'.repeat(32)}`, venue: 'EVM', chainId: '1', marketAddress: config.settlementAddress!, collateralToken: config.collateralToken, collateralDecimals: 6, status: 'TRADING', paused: false, outcomes: [{ id: 0, label: 'A' }, { id: 1, label: 'B' }], createdAt: now - 20_000, tradingStartsAt: now - 10_000, tradingLocksAt: now + 60_000, expiresAt: now + 120_000 }
  let admitted = 0
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (new URL(request.url).pathname === '/rpc') {
      const input = await request.json() as { id: number; method: string }
      return Response.json({ jsonrpc: '2.0', id: input.id, result: input.method === 'eth_chainId' ? '0x1' : `0x${'00'.repeat(32)}` })
    }
    if (request.method === 'GET') return Response.json(market)
    admitted++; return Response.json({ status: 'OPEN', orderId: 'fixture' }, { status: 202 })
  } })
  const provider = { request: async ({ method }: { method: string }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [owner]
    if (method === 'eth_chainId') return '0x1'
    if (method === 'eth_signTypedData_v4') { entered.release(); await finish.promise; return `0x${'11'.repeat(65)}` }
    throw new Error(`Unexpected wallet request: ${method}`)
  } } as EIP1193Provider
  try {
    const url = `http://127.0.0.1:${server.port}`
    const wallet = await connectEvmTradingWallet({ ...config, publicRpcUrl: `${url}/rpc` }, url, 'fixture', provider)
    const result = wallet.client.placeOrder({ marketId: market.id, outcomeId: 0, side: 'BUY', price: 500_000n, quantity: 1_000_000n, expiresAt: Math.floor((now + 30_000) / 1000) * 1000 }).then(() => '', error => error.message)
    await entered.promise
    wallet.dispose(); finish.release()
    expect(await result).toContain('disconnected')
    expect(admitted).toBe(0)
  } finally { finish.release(); server.stop(true) }
})
