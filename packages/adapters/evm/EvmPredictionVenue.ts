import type { Address, Hex } from 'viem'
import { HttpPredictionVenue, type VenueClientOptions } from '../../sdk/HttpPredictionVenue'
import type { PlaceOrderInput, SignedOrder } from '../../prediction-core/types'
import type { EvmVenueConfig } from '../config'
import { invariant } from '../../prediction-core/validation'
import { evmOrderId, orderTypedData } from './orders'

export function createEvmOrderSigner(config: EvmVenueConfig, account: Address, signer: {
  nextNonce(): Promise<bigint>
  signTypedData(value: ReturnType<typeof orderTypedData>): Promise<Hex>
}): (input: PlaceOrderInput) => Promise<SignedOrder> {
  return async input => {
    const order: SignedOrder = { ...input, venue: config.venue, chainId: config.chainId, maker: account, nonce: await signer.nextNonce(), orderId: 'unsigned', signature: 'unsigned' }
    order.orderId = evmOrderId(order, config.settlementAddress)
    order.signature = await signer.signTypedData(orderTypedData(order, config.settlementAddress))
    return order
  }
}

/** The same client runs on Somnia, 0G, Robinhood, and other custom EVM deployments. */
export class EvmPredictionVenue extends HttpPredictionVenue {
  constructor(config: EvmVenueConfig, options: VenueClientOptions) {
    invariant(options.venue === config.venue && options.chainId === config.chainId, 'WRONG_VENUE', 'Client and EVM deployment must match.')
    super(options)
  }
}
