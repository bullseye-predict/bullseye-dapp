import { describe, expect, test } from 'bun:test'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyTypedData } from 'viem'
import { atomic, effectiveMarket, quoteCeil, validateOrder } from '../../packages/prediction-core/validation'
import { decodeStored, encodeStored, stringify } from '../../packages/prediction-core/serialization'
import { evmOrderId, orderTypedData } from '../../packages/adapters/evm/orders'
import type { Market, SignedOrder } from '../../packages/prediction-core/types'

export const at = 1_800_000_000_000
export const market: Market = {
  id: `0x${'11'.repeat(32)}`, matchId: `0x${'22'.repeat(32)}`, venue: 'EVM', chainId: '31337',
  marketAddress: `0x${'33'.repeat(20)}`, collateralToken: `0x${'44'.repeat(20)}`, collateralDecimals: 6,
  outcomes: [{ id: 0, label: 'BLUE' }, { id: 1, label: 'RED' }, { id: 2, label: 'GREEN' }],
  status: 'TRADING', createdAt: at - 10_000, tradingStartsAt: at - 5_000, tradingLocksAt: at + 60_000, expiresAt: at + 120_000, paused: false,
}
export const wallet = privateKeyToAccount(`0x${'12'.repeat(32)}`)
export const unsigned = (overrides: Partial<SignedOrder> = {}): SignedOrder => ({ orderId: 'pending', venue: 'EVM', chainId: market.chainId, maker: wallet.address, marketId: market.id, outcomeId: 0, side: 'BUY', price: 550_000n, quantity: 10_000_000n, nonce: 0n, expiresAt: at + 30_000, signature: 'pending', ...overrides })

describe('prediction shared arithmetic and domains', () => {
  test('amount wire encoding round trips beyond Number safe integer', () => {
    const value = { amount: (1n << 120n) + 17n, realizedPnl: -20n }
    expect(decodeStored<typeof value>(encodeStored(value))).toEqual(value)
    expect(JSON.parse(stringify(value)).amount).toBe(value.amount.toString())
    expect(() => atomic(2.5, 'amount')).toThrow()
    expect(() => atomic('1e6', 'amount')).toThrow()
    expect(() => atomic('-1', 'amount')).toThrow()
    expect(quoteCeil(3n, 500_000n)).toBe(2n)
  })

  test('time locks and all outcome bounds are enforced', () => {
    expect(effectiveMarket(market, market.tradingLocksAt).status).toBe('LOCKED')
    expect(() => validateOrder(unsigned({ outcomeId: 2 }), market, at)).not.toThrow()
    expect(() => validateOrder(unsigned({ outcomeId: 3 }), market, at)).toThrow()
    expect(() => validateOrder(unsigned({ chainId: '1' }), market, at)).toThrow()
    expect(() => validateOrder(unsigned(), market, market.tradingLocksAt)).toThrow()
    expect(() => validateOrder(unsigned({ expiresAt: at + 30_001 }), market, at)).toThrow()
  })

  test('EIP712 signatures cannot be replayed across chain or settlement address', async () => {
    const order = unsigned()
    const settlement = market.marketAddress as `0x${string}`
    const typed = orderTypedData(order, settlement)
    const signature = await wallet.signTypedData(typed)
    expect(await verifyTypedData({ ...typed, address: wallet.address, signature })).toBe(true)
    expect(await verifyTypedData({ ...orderTypedData({ ...order, chainId: '1' }, settlement), address: wallet.address, signature })).toBe(false)
    expect(evmOrderId(order, settlement)).not.toBe(evmOrderId(order, `0x${'55'.repeat(20)}`))
  })
})
