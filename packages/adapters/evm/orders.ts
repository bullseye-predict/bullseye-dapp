import { hashTypedData, isAddress, type Address, type Hex } from 'viem'
import type { SignedOrder } from '../../prediction-core/types'
import { invariant } from '../../prediction-core/validation'

export const ORDER_TYPES = {
  Order: [
    { name: 'maker', type: 'address' }, { name: 'marketId', type: 'bytes32' },
    { name: 'outcomeId', type: 'uint8' }, { name: 'side', type: 'uint8' },
    { name: 'price', type: 'uint64' }, { name: 'quantity', type: 'uint128' },
    { name: 'nonce', type: 'uint256' }, { name: 'expiry', type: 'uint64' },
  ],
} as const

export function orderTypedData(order: SignedOrder, settlementAddress: Address) {
  invariant(order.venue !== 'SOLANA' && order.venue !== 'DREAMDEX', 'WRONG_VENUE', 'Use the venue-specific signing format.')
  invariant(isAddress(order.maker) && /^0x[0-9a-fA-F]{64}$/.test(order.marketId), 'INVALID_ORDER', 'Invalid EVM maker or market ID.')
  invariant(order.expiresAt % 1000 === 0 && Number.isSafeInteger(order.expiresAt), 'INVALID_TIMING', 'EVM expiry must align to whole seconds.')
  invariant(/^[1-9][0-9]*$/.test(order.chainId) && BigInt(order.chainId) <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_CHAIN', 'Invalid EVM chain ID.')
  return {
    domain: { name: 'SOLZ Prediction Market', version: '1', chainId: Number(order.chainId), verifyingContract: settlementAddress },
    types: ORDER_TYPES, primaryType: 'Order' as const,
    message: { maker: order.maker as Address, marketId: order.marketId as Hex, outcomeId: order.outcomeId, side: order.side === 'BUY' ? 0 : 1, price: order.price, quantity: order.quantity, nonce: order.nonce, expiry: BigInt(order.expiresAt / 1000) },
  }
}

export const evmOrderId = (order: SignedOrder, settlement: Address): Hex => hashTypedData(orderTypedData(order, settlement))
