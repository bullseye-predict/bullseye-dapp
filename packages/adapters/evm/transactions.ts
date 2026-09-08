import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import type { SignedOrder } from '../../prediction-core/types'
import { invariant, quoteCeil } from '../../prediction-core/validation'
import { orderTypedData } from './orders'

const ABI = parseAbi([
  'function split(bytes32 marketId,uint256 amount)',
  'function merge(bytes32 marketId,uint256 amount)',
  'function redeem(bytes32 marketId) returns (uint256)',
  'function cancelOrder(bytes32 orderHash)',
  'function cancelUpTo(uint256 newMinimumNonce)',
  'function fillOrders((address maker,bytes32 marketId,uint8 outcomeId,uint8 side,uint64 price,uint128 quantity,uint256 nonce,uint64 expiry) buy,bytes buySignature,(address maker,bytes32 marketId,uint8 outcomeId,uint8 side,uint64 price,uint128 quantity,uint256 nonce,uint64 expiry) sell,bytes sellSignature,uint128 fillAmount)',
])

export interface EvmTransactionRequest { to: Address; data: Hex; value: 0n }

export function positionTransaction(settlement: Address, action: 'split' | 'merge' | 'redeem', marketId: Hex, amount?: bigint): EvmTransactionRequest {
  invariant(/^0x[0-9a-fA-F]{64}$/.test(marketId), 'INVALID_MARKET', 'Market ID must be bytes32.')
  if (action === 'redeem') return { to: settlement, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: action, args: [marketId] }) }
  invariant(amount !== undefined && amount > 0n, 'INVALID_AMOUNT', 'A positive atomic amount is required.')
  return { to: settlement, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: action, args: [marketId, amount] }) }
}

export function cancelOrderTransaction(settlement: Address, orderId: Hex): EvmTransactionRequest {
  return { to: settlement, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: 'cancelOrder', args: [orderId] }) }
}

export function fillTransaction(settlement: Address, buy: SignedOrder, sell: SignedOrder, quantity: bigint): EvmTransactionRequest {
  invariant(buy.side === 'BUY' && sell.side === 'SELL' && buy.venue === sell.venue && buy.chainId === sell.chainId && buy.marketId === sell.marketId && buy.outcomeId === sell.outcomeId, 'INVALID_PAIR', 'Orders must refer to opposing sides of the same market outcome.')
  invariant(quantity > 0n && quantity <= buy.quantity && quantity <= sell.quantity && sell.price <= buy.price, 'INVALID_FILL', 'Fill exceeds an order limit.')
  invariant(quoteCeil(quantity, sell.price) * 1_000_000n <= quantity * buy.price, 'DUST_FILL', 'Fill rounding would exceed the buyer limit.')
  return { to: settlement, value: 0n, data: encodeFunctionData({ abi: ABI, functionName: 'fillOrders', args: [orderTypedData(buy, settlement).message, buy.signature as Hex, orderTypedData(sell, settlement).message, sell.signature as Hex, quantity] }) }
}
