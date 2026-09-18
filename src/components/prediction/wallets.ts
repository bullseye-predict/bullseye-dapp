import { createPublicClient, createWalletClient, custom, http, parseAbi, encodeFunctionData, type Address, type EIP1193Provider, type Hex } from 'viem'
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'
import { Buffer } from 'buffer'
import type { Market, Order, TxResult } from '../../../packages/prediction-core/types'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { awaitConfirmation } from '../../../packages/adapters/solana/manifest/browser'
import type { LiveArenaWalletPort } from '../arena/liveArenaAdapter'
import type { DynamicEvmWalletPort } from '../arena/DynamicSolanaSession'
import { PredictionTradingClient } from '../../../packages/sdk/PredictionTradingClient'
import { createEvmOrderSigner } from '../../../packages/adapters/evm/EvmPredictionVenue'
import { parseEvmConfig } from '../../../packages/adapters/config'
import { positionTransaction, cancelOrderTransaction } from '../../../packages/adapters/evm/transactions'
import { createSolanaOrderSigner, createSolanaRequestSigner, type SolanaVenueConfig } from '../../../packages/adapters/solana/SolanaPredictionVenue'
import { changePosition, initializeVault, initializePosition, moveVaultCollateral, initializeOrCancelNonce, positionAddress, vaultAddress, TOKEN_PROGRAM_ID } from '../../../packages/adapters/solana/wire'
import { quoteCeil } from '../../../packages/prediction-core/validation'

export interface TradingWallet {
  client: PredictionTradingClient
  owner: string
  dispose(): void
  prepare(market: Market, side: 'BUY' | 'SELL', maximumCost: bigint): Promise<void>
  cancel(order: Order): Promise<TxResult & { bookUpdated: boolean }>
  collateral(action: 'deposit' | 'withdraw' | 'split' | 'merge' | 'redeem', market: Market, amount?: bigint): Promise<TxResult>
}
export const randomNonce = (): Promise<bigint> => Promise.resolve(new DataView(crypto.getRandomValues(new Uint8Array(8)).buffer).getBigUint64(0))
const ABI = parseAbi([
  'function allowance(address owner,address spender) view returns (uint256)', 'function approve(address spender,uint256 amount) returns (bool)',
  'function outcomeToken() view returns (address)', 'function isApprovedForAll(address account,address operator) view returns (bool)',
  'function setApprovalForAll(address operator,bool approved)',
  'function minimumNonce(address maker) view returns (uint256)',
])
const associatedTokenProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
function walletLifetime() {
  let active = true
  return {
    check() { if (!active) throw new Error('Trading wallet was disconnected. Reconnect before continuing.') },
    dispose() { active = false },
  }
}
/** Classic SPL ATA create-idempotent; a withdrawal also works after an emptied ATA was closed. */
function ensureOwnerTokenAccount(owner: PublicKey, mint: PublicKey, ata: PublicKey): TransactionInstruction {
  return new TransactionInstruction({ programId: associatedTokenProgram, data: Buffer.from([1]), keys: [
    { pubkey: owner, isSigner: true, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ] })
}

export async function connectEvmTradingWallet(config: PublicPredictionVenue, baseUrl: string, audience: string, source: EIP1193Provider | DynamicEvmWalletPort): Promise<TradingWallet> {
  const lifetime = walletLifetime()
  const deployment = parseEvmConfig({ ...config, rpcUrl: config.publicRpcUrl })
  const chainDefinition = { id: Number(config.chainId), name: config.label, nativeCurrency: { name: 'Native currency', symbol: 'NATIVE', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpcUrl] } } } as const
  const chain = Number(config.chainId)
  const dynamicWallet = 'getWalletClient' in source
  const wallet = dynamicWallet ? await source.getWalletClient(String(chain)) : createWalletClient({ chain: chainDefinition, transport: custom(source) })
  const [selected] = dynamicWallet ? [source.address] : await wallet.requestAddresses()
  if (!selected) throw new Error('Connect an EVM wallet to trade.')
  const account = selected.toLowerCase() as Address
  if (await wallet.getChainId() !== chain) await wallet.switchChain({ id: chain })
  const rpc = createPublicClient({ transport: http(deployment.rpcUrl, { timeout: 10_000 }), cacheTime: 0 })
  const check = async () => {
    lifetime.check()
    const [walletChain, rpcChain, accounts] = await Promise.all([wallet.getChainId(), rpc.getChainId(), wallet.getAddresses()])
    lifetime.check()
    if (walletChain !== chain || rpcChain !== chain || accounts[0]?.toLowerCase() !== account) throw new Error('Wallet account or network changed. Reconnect before trading.')
  }
  await check()
  const send = async (transaction: { to: Address; data: Hex; value: 0n }): Promise<TxResult> => {
    await check()
    const txHash = await (wallet as unknown as { sendTransaction(input: { to: Address; data: Hex; value: 0n; account: Address; chain: typeof chainDefinition }): Promise<Hex> }).sendTransaction({ ...transaction, account, chain: chainDefinition })
    const receipt = await rpc.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 90_000 })
    if (receipt.status !== 'success') throw new Error(`Transaction reverted: ${txHash}`)
    return { id: txHash, txHash, status: 'CONFIRMED' }
  }
  const approve = async (amount: bigint) => {
    if (amount <= 0n) return
    const current = await rpc.readContract({ address: deployment.collateralToken, abi: ABI, functionName: 'allowance', args: [account, deployment.settlementAddress] })
    if (current < amount) await send({ to: deployment.collateralToken, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: 'approve', args: [deployment.settlementAddress, amount] }) })
  }
  const signer = createEvmOrderSigner(deployment, account, { nextNonce: async () => {
    const minimum = await rpc.readContract({ address: deployment.settlementAddress, abi: ABI, functionName: 'minimumNonce', args: [account] })
    const nonce = minimum + await randomNonce()
    if (nonce >= 2n ** 256n) throw new Error('Wallet nonce space is exhausted.')
    return nonce
  }, signTypedData: async data => { await check(); const signature = await wallet.signTypedData({ ...data, account }); await check(); return signature } })
  const client = new PredictionTradingClient({ baseUrl, audience, venue: config.venue, chainId: config.chainId, account,
    signOrder: signer, signRequest: async message => { await check(); const signature = await wallet.signMessage({ account, message }); await check(); return signature },
    redeem: marketId => send(positionTransaction(deployment.settlementAddress, 'redeem', marketId as Hex)),
  })
  const verifyMarket = (market: Market) => {
    if (market.venue !== config.venue || market.chainId !== config.chainId || market.marketAddress.toLowerCase() !== deployment.settlementAddress.toLowerCase() || market.collateralToken.toLowerCase() !== deployment.collateralToken.toLowerCase()) throw new Error('Market does not belong to this wallet deployment.')
  }
  return { client, owner: account, dispose: lifetime.dispose,
    async prepare(market, side, maximumCost) {
      verifyMarket(market); await check()
      if (side === 'BUY') {
        const balance = await client.getBalance(account)
        if (maximumCost > balance.available) throw new Error('Insufficient available collateral.')
        await approve(balance.reserved + maximumCost)
      } else {
        const token = await rpc.readContract({ address: deployment.settlementAddress, abi: ABI, functionName: 'outcomeToken' })
        const approved = await rpc.readContract({ address: token, abi: ABI, functionName: 'isApprovedForAll', args: [account, deployment.settlementAddress] })
        if (!approved) await send({ to: token, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: 'setApprovalForAll', args: [deployment.settlementAddress, true] }) })
      }
      await check()
    },
    async cancel(order) {
      const receipt = await send(cancelOrderTransaction(deployment.settlementAddress, order.orderId as Hex))
      const bookUpdated = await client.cancelOrder(order.orderId).then(() => true, () => false)
      return { ...receipt, bookUpdated }
    },
    async collateral(action, market, amount) {
      verifyMarket(market)
      if (action === 'deposit' || action === 'withdraw') throw new Error('EVM manual trades use collateral in your wallet.')
      if (action === 'split') {
        const balance = await client.getBalance(account)
        if (!amount || amount > balance.available) throw new Error('Insufficient unreserved collateral to create complete sets.')
        await approve(balance.reserved + amount)
      }
      return send(positionTransaction(deployment.settlementAddress, action, market.id as Hex, amount))
    },
  }
}

export async function connectSolanaTradingWallet(config: PublicPredictionVenue, baseUrl: string, audience: string, port: LiveArenaWalletPort): Promise<TradingWallet> {
  const lifetime = walletLifetime()
  if (!config.programId || !config.networkDomain || !/^[0-9a-f]{64}$/.test(config.networkDomain)) throw new Error('Solana prediction deployment is not configured.')
  const connection = config.publicRpcUrl ? new Connection(config.publicRpcUrl, 'confirmed') : await port.getConnection()
  const owner = new PublicKey(port.address)
  const program = new PublicKey(config.programId)
  const vault = vaultAddress(program, owner)
  const check = async () => {
    lifetime.check()
    const [chain, signer] = await Promise.all([connection.getGenesisHash(), port.getSigner()])
    lifetime.check()
    if (chain !== config.chainId || port.address !== owner.toBase58() || !signer.isConnected || !signer.publicKey || !new PublicKey(signer.publicKey.toBytes()).equals(owner)) throw new Error('Wallet account or Solana network changed. Reconnect before trading.')
    return signer
  }
  await check()
  const deployment: SolanaVenueConfig = { programId: program, chainId: config.chainId, networkDomain: Uint8Array.from(config.networkDomain.match(/../g)!, pair => parseInt(pair, 16)), readAccount: address => connection.getAccountInfo(address), now: () => client.currentTime() }
  const messageSigner = { publicKey: owner, signMessage: async (message: Uint8Array) => {
    const signer = await check()
    const result = await signer.signMessage(message)
    await check()
    return result.signature
  } }
  const send = async (instructions: TransactionInstruction[]): Promise<TxResult> => {
    await check()
    const recent = await connection.getLatestBlockhash('confirmed')
    const transaction = new Transaction({ feePayer: owner, ...recent }).add(...instructions)
    const expectedMessage = Buffer.from(transaction.serializeMessage())
    const signer = await check()
    const signed = await signer.signTransaction(transaction)
    await check()
    if (!Buffer.from(signed.serializeMessage()).equals(expectedMessage)) throw new Error('The wallet changed the requested transaction.')
    const txHash = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false })
    // Same reason as the Manifest wallet: confirmTransaction asks getBlockHeight
    // once a second for the life of the blockhash, which is a request per second
    // per transaction against the same rate limit the trade is competing for.
    await awaitConfirmation(connection, txHash, recent.lastValidBlockHeight)
    return { id: txHash, txHash, status: 'CONFIRMED' }
  }
  const client = new PredictionTradingClient({ baseUrl, audience, venue: 'SOLANA', chainId: config.chainId, account: vault.toBase58(),
    signOrder: createSolanaOrderSigner(deployment, owner, messageSigner, randomNonce), signRequest: createSolanaRequestSigner(deployment, owner, messageSigner),
    redeem: marketId => send([changePosition(program, owner, marketId, vault, 'redeem')]),
  })
  const ensurePosition = async (marketId: string) => { if (!await connection.getAccountInfo(positionAddress(program, marketId, vault))) await send([initializePosition(program, owner, marketId, vault)]) }
  const verifyMarket = (market: Market) => { if (market.venue !== 'SOLANA' || market.chainId !== config.chainId || market.collateralToken !== config.collateralToken) throw new Error('Market does not belong to this Solana deployment.') }
  return { client, owner: owner.toBase58(), dispose: lifetime.dispose,
    async prepare(market, side, maximumCost) {
      verifyMarket(market); await check()
      if (side === 'BUY' && maximumCost > (await client.getBalance(vault.toBase58())).available) throw new Error('Deposit more available collateral before buying.')
      await ensurePosition(market.id)
      await check()
    },
    async cancel(order) {
      const receipt = await send([initializeOrCancelNonce(program, owner, vault, order.nonce, true)])
      const bookUpdated = await client.cancelOrder(order.orderId).then(() => true, () => false)
      return { ...receipt, bookUpdated }
    },
    async collateral(action, market, amount) {
      verifyMarket(market)
      if (action === 'deposit' || action === 'withdraw') {
        if (!amount || amount <= 0n) throw new Error('Enter a collateral amount.')
        const mint = new PublicKey(config.collateralToken)
        const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], associatedTokenProgram)[0]
        const instructions: TransactionInstruction[] = []
        if (!await connection.getAccountInfo(vault)) {
          if (action !== 'deposit') throw new Error('Create and fund your prediction vault first.')
          instructions.push(initializeVault(program, owner, mint, amount))
        }
        if (action === 'withdraw' && amount > (await client.getBalance(vault.toBase58())).available) throw new Error('Cancel pending orders before withdrawing reserved collateral.')
        if (action === 'withdraw') instructions.push(ensureOwnerTokenAccount(owner, mint, ata))
        instructions.push(moveVaultCollateral(program, owner, ata, amount, action))
        return send(instructions)
      }
      if (action === 'split' && (!amount || amount > (await client.getBalance(vault.toBase58())).available)) throw new Error('Insufficient unreserved collateral to create complete sets.')
      await ensurePosition(market.id)
      return send([changePosition(program, owner, market.id, vault, action, amount)])
    },
  }
}

export const maximumOrderCost = (quantity: bigint, price: bigint) => quoteCeil(quantity, price)
