import { createWalletClient, http, erc20Abi, keccak256, concat, stringToHex, type Hex, type EIP1193Provider } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { DreamDexBrowser, DreamDexBrowserWallet } from '../../packages/adapters/dreamdex/browser'
import { eventBinding } from '../../packages/adapters/dreamdex/config'

if (!Bun.argv.includes('--testnet-demo')) throw Error('Requires --testnet-demo. Uses only Shannon test tokens.')
const apiUrl = (process.env.PUBLIC_PREDICTION_API_URL ?? 'http://127.0.0.1:8788').replace(/\/+$/, '')
const config = (await (await fetch(`${apiUrl}/config`)).json()).dreamdex[0]
if (config.chainId !== '50312' || !config.markets.length) throw Error('Create a real game question first.')
const requestedMarket = Bun.argv.find(arg => arg.startsWith('--market='))?.slice(9)
const market = requestedMarket ? config.markets.find((m: { marketId: string }) => m.marketId === requestedMarket) : config.markets[0]
if (!market) throw Error('Choose a confirmed game market from the demo service.')
const raw = process.env.PVT_KEY
if (!raw) throw Error('PVT_KEY is required in the test host only.')
const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex
const owner = privateKeyToAccount(key)
// Reproducible test account; no second plaintext secret file and no ephemeral funds loss.
const buyer = privateKeyToAccount(keccak256(concat([key, stringToHex('SOLZ_DREAMDEX_GAME_DEMO_BUYER_V1')])) )
const adapter = new DreamDexBrowser(config, eventBinding(config, market))
const rpc = adapter.client.getViemClient()
const { id, name, nativeCurrency, rpcUrls, blockExplorers } = adapter.resources.reader.network.chain
const chain = { id, name, nativeCurrency, rpcUrls, blockExplorers }
const wallet = createWalletClient({ account: owner, chain, transport: http(rpcUrls.default.http[0]) })
const buyerWallet = createWalletClient({ account: buyer, chain, transport: http(rpcUrls.default.http[0]) })
const redeemOnly = Bun.argv.includes('--redeem-only')
const acting = redeemOnly ? owner : buyer
const actingWallet = redeemOnly ? wallet : buyerWallet
const log = (step: string, value: unknown) => console.log(JSON.stringify({ step, value }, (_, v) => typeof v === 'bigint' ? v.toString() : v))
try {
  if (await rpc.getChainId() !== 50312) throw Error('Wrong network.')
  const state = await adapter.inspect(!redeemOnly), m = state.market
  if (!redeemOnly) {
  const maker = adapter.client.createTrader({ walletClient: wallet as never, account: owner as never, publicClient: rpc, gas: 50_000_000n })
  const confirm = async (hash: Hex) => { const r = await rpc.waitForTransactionReceipt({ hash }); if (r.status !== 'success') throw Error(`Reverted: ${hash}`); return hash }
  const inventory = await adapter.snapshot(owner.address)
  if (!inventory.orders.length) {
    if ((inventory.balances?.[1] ?? 0n) < 10_000_000n || (inventory.balances?.[2] ?? 0n) < 10_000_000n) {
      log('approve-mint', await confirm(await wallet.writeContract({ address: m.collateral, abi: erc20Abi, functionName: 'approve', args: [m.pool, 10_000_000n] })))
      const minted = await maker.mintSet({ pool: m.pool, collateral: m.collateral, amount: 10_000_000n, autoApprove: false })
      if (minted.receipt.status !== 'success') throw Error(`Mint failed: ${minted.hash}`)
      log('mint-10-complete-sets', minted.hash)
    }
    for (const side of ['SELL_YES', 'SELL_NO'] as const) {
      const placed = await maker.placeOrder({ pool: m.pool, side, price: side === 'SELL_YES' ? 550_000n : 450_000n, quantity: 10_000_000n, expireTimestampNs: m.expiry * 1_000_000_000n, orderType: 0, collateral: m.collateral, outcomeToken: m.outcomeToken, yesId: m.yesId, noId: m.noId })
      if (placed.receipt.status !== 'success' || placed.orderId === undefined) throw Error('Seed order did not rest.')
      log(side, { hash: placed.hash, orderId: placed.orderId })
    }
  }
  if (Bun.argv.includes('--seed-only')) { log('seed-ready', { marketId: market.marketId, question: market.label }); await adapter.close(); process.exit(0) }
  if (await rpc.getBalance({ address: buyer.address }) < 200_000_000_000_000_000n) log('fund-demo-buyer-gas', await confirm(await wallet.sendTransaction({ to: buyer.address, value: 500_000_000_000_000_000n })))
  if (await rpc.readContract({ address: m.collateral, abi: erc20Abi, functionName: 'balanceOf', args: [buyer.address] }) < 1_000_000n) {
    log('test-collateral', await confirm(await wallet.writeContract({ address: m.collateral, abi: erc20Abi, functionName: 'transfer', args: [buyer.address, 10_000_000n] })))
  }
  }
  // Exercise the actual frontend wallet adapter with a local test signer transport.
  // This is NOT a claim that Dynamic browser authentication was performed.
  const provider = { request: async ({ method, params }: any) => {
    if (!['eth_chainId', 'eth_accounts', 'eth_requestAccounts'].includes(method)) log('wallet-request', { method })
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [acting.address]
    if (method === 'eth_chainId') return '0xc488'
    if (method === 'eth_sendTransaction') {
      const tx = params[0], input: any = { to: tx.to, data: tx.data }
      for (const name of ['gas', 'value', 'gasPrice', 'maxFeePerGas', 'maxPriorityFeePerGas']) if (tx[name] !== undefined) input[name] = BigInt(tx[name])
      try { const hash = await actingWallet.sendTransaction(input); log('wallet-broadcast', { hash, to: input.to, selector: input.data?.slice(0, 10), gas: input.gas }); return hash }
      catch (error) { const e = error as { shortMessage?: string; details?: string }; log('wallet-error', { message: e.shortMessage, details: e.details, to: input.to, gas: input.gas }); throw error }
    }
    return rpc.request({ method, params })
  } }
  const session = new DreamDexBrowserWallet(adapter, provider as Pick<EIP1193Provider, 'request'>, acting.address)
  if (redeemOnly) {
    if (!m.isResolved || m.isVoided) throw Error('Wait for a genuine resolved game outcome.')
    const inventory = await adapter.snapshot(acting.address)
    for (const order of inventory.orders) if (order) log('recover-expired-escrow', await session.cancel(order.orderId))
    const before = await adapter.snapshot(acting.address)
    const outcome = m.winningOutcome as 0 | 1
    if ((before.balances?.[outcome + 1] ?? 0n) < 1_000_000n) throw Error('No winning share available to redeem.')
    const hash = await session.sets('redeem', 1_000_000n, outcome)
    const after = await adapter.snapshot(acting.address)
    const collateralReceived = after.balances![0]! - before.balances![0]!
    if (collateralReceived !== 1_000_000n) throw Error('Expected one test USDC payout for this zero-fee demo.')
    log('verified-redemption', { hash, marketId: market.marketId, outcome, collateralReceived })
    await adapter.close(); process.exit(0)
  }
  log('BUY_YES', await session.order({ side: 'BUY_YES', outcomePrice: 550_000n, quantity: 1_000_000n, orderType: 2 }))
  let after = await adapter.snapshot(buyer.address)
  if (after.balances?.[1] !== 1_000_000n) throw Error('The test buyer did not receive one YES share.')
  log('SELL_YES', await session.order({ side: 'SELL_YES', outcomePrice: 450_000n, quantity: 1_000_000n, orderType: 2 }))
  after = await adapter.snapshot(buyer.address)
  if (after.balances?.[1] !== 0n) throw Error('The test sale did not consume the YES share.')
  log('verified-round-trip', { marketId: market.marketId, question: market.label, buyer: buyer.address, balances: after.balances, book: after.book })
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 }
finally { await adapter.close(); process.exit(process.exitCode ?? 0) }
