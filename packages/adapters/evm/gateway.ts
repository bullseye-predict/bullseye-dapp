import { createPublicClient, http, parseAbi, isAddress, zeroAddress, type Hex } from 'viem'
import type { Balance, Market, SignedOrder } from '../../prediction-core/types'
import type { EvmVenueConfig } from '../config'
import { invariant, validateMarket } from '../../prediction-core/validation'
import { evmOrderId, orderTypedData } from './orders'
import { verifyVaultRequest } from './vault-requests'

export const SETTLEMENT_READ_ABI = parseAbi([
  'function getMarket(bytes32 marketId) view returns ((bytes32 matchId,address collateral,uint64 createdAt,uint64 tradingLockTime,uint64 expiry,uint8 outcomeCount,address resultOracle,uint8 status,bool paused,uint8 winningOutcomeId,uint256 collateralLocked,uint256 voidSharesRedeemed))',
  'function paused() view returns (bool)', 'function factory() view returns (address)',
  'function minimumNonce(address maker) view returns (uint256)',
  'function cancelled(address maker, bytes32 orderHash) view returns (bool)',
  'function filledQuantity(bytes32 orderHash) view returns (uint128)',
])
const FACTORY_ABI = parseAbi(['function outcomeLabels(bytes32 marketId) view returns (string[])', 'function settlement() view returns (address)'])
const ERC20_ABI = parseAbi(['function balanceOf(address account) view returns (uint256)', 'function decimals() view returns (uint8)'])

/** Read/signature adapter for any configured custom EVM deployment. Never owns a wallet key. */
export class EvmChainGateway {
  readonly client
  constructor(readonly config: EvmVenueConfig) {
    this.client = createPublicClient({ transport: http(config.rpcUrl, { timeout: 10_000, retryCount: 1 }) })
  }

  async checkChain(): Promise<void> {
    invariant(String(await this.client.getChainId()) === this.config.chainId, 'WRONG_CHAIN', 'RPC chain ID does not match configuration.')
  }

  async getMarket(marketId: string): Promise<Market> {
    invariant(/^0x[0-9a-fA-F]{64}$/.test(marketId), 'INVALID_MARKET', 'EVM market ID must be bytes32.')
    await this.checkChain()
    const blockNumber = await this.client.getBlockNumber({ cacheTime: 0 })
    const args = [marketId as Hex] as const
    const [value, labels, globallyPaused, settlement, decimals] = await Promise.all([
      this.client.readContract({ address: this.config.settlementAddress, abi: SETTLEMENT_READ_ABI, functionName: 'getMarket', args, blockNumber }),
      this.client.readContract({ address: this.config.factoryAddress, abi: FACTORY_ABI, functionName: 'outcomeLabels', args, blockNumber }),
      this.client.readContract({ address: this.config.settlementAddress, abi: SETTLEMENT_READ_ABI, functionName: 'paused', blockNumber }),
      this.client.readContract({ address: this.config.factoryAddress, abi: FACTORY_ABI, functionName: 'settlement', blockNumber }),
      this.client.readContract({ address: this.config.collateralToken, abi: ERC20_ABI, functionName: 'decimals', blockNumber }),
    ])
    invariant(settlement.toLowerCase() === this.config.settlementAddress.toLowerCase() && value.collateral.toLowerCase() === this.config.collateralToken.toLowerCase() && value.resultOracle.toLowerCase() === this.config.oracleAddress.toLowerCase() && decimals === this.config.collateralDecimals, 'WRONG_DEPLOYMENT', 'Market deployment or collateral does not match configuration.')
    invariant(labels.length === value.outcomeCount && value.collateral !== zeroAddress && value.status <= 4, 'INVALID_MARKET', 'Invalid on-chain market state.')
    const market: Market = {
      id: marketId, matchId: value.matchId, venue: this.config.venue, chainId: this.config.chainId,
      marketAddress: this.config.settlementAddress, collateralToken: value.collateral,
      collateralDecimals: decimals, outcomes: labels.map((label, id) => ({ id, label })),
      status: (['PENDING', 'TRADING', 'LOCKED', 'RESOLVED', 'VOIDED'] as const)[value.status]!,
      createdAt: Number(value.createdAt) * 1000, tradingStartsAt: Number(value.createdAt) * 1000,
      tradingLocksAt: Number(value.tradingLockTime) * 1000, expiresAt: Number(value.expiry) * 1000,
      paused: value.paused || globallyPaused,
      ...(value.status === 3 ? { winningOutcomeId: value.winningOutcomeId } : {}),
    }
    validateMarket(market)
    return market
  }

  async verifyOrder(order: Readonly<SignedOrder>): Promise<boolean> {
    if (order.venue !== this.config.venue || order.chainId !== this.config.chainId) return false
    await this.checkChain()
    const id = evmOrderId(order, this.config.settlementAddress)
    if (id !== order.orderId || !/^0x[0-9a-fA-F]+$/.test(order.signature)) return false
    const typed = orderTypedData(order, this.config.settlementAddress)
    const [valid, minimumNonce, cancelled, filled] = await Promise.all([
      this.client.verifyTypedData({ ...typed, address: typed.message.maker, signature: order.signature as Hex }),
      this.client.readContract({ address: this.config.settlementAddress, abi: SETTLEMENT_READ_ABI, functionName: 'minimumNonce', args: [typed.message.maker] }),
      this.client.readContract({ address: this.config.settlementAddress, abi: SETTLEMENT_READ_ABI, functionName: 'cancelled', args: [typed.message.maker, id] }),
      this.client.readContract({ address: this.config.settlementAddress, abi: SETTLEMENT_READ_ABI, functionName: 'filledQuantity', args: [id] }),
    ])
    // A preexisting partial fill requires indexer reconciliation before accepting the order.
    return valid && order.nonce >= minimumNonce && !cancelled && filled === 0n
  }

  async verifyRequest(account: string, message: string, signature: string, request?: { method: string; path: string }): Promise<boolean> {
    if (!isAddress(account) || !/^0x[0-9a-fA-F]+$/.test(signature)) return false
    await this.checkChain()
    const valid = await this.client.verifyMessage({ address: account, message, signature: signature as Hex }).catch(() => false)
    if (valid) return true
    if (!request) return false
    return verifyVaultRequest(this.client, this.config, account, message, signature, { method: request.method, pathname: request.path })
  }

  async getBalance(account: string): Promise<Balance> {
    invariant(isAddress(account), 'INVALID_ACCOUNT', 'Invalid EVM account.')
    await this.checkChain()
    const total = await this.client.readContract({ address: this.config.collateralToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account] })
    return { account, collateralToken: this.config.collateralToken, total, available: total, reserved: 0n }
  }
}
