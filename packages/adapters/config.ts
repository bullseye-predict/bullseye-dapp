import type { VenueId } from '../prediction-core/types'
import { integer, invariant, record, textField, venueId } from '../prediction-core/validation'

/** COOLA pays for game-agent execution; it must never back a prediction payout. */
export function predictionCollateralSymbol(value: unknown, field = 'collateralSymbol'): string {
  const symbol = textField(value ?? 'USDC', field, 24)
  invariant(symbol.toUpperCase() !== 'COOLA', 'INVALID_COLLATERAL', '$COOLA is reserved for game-agent execution and cannot be prediction-market collateral.')
  return symbol
}

export interface EvmVenueConfig {
  family: 'EVM'
  venue: Exclude<VenueId, 'SOLANA' | 'DREAMDEX'>
  chainId: string
  rpcUrl: string
  settlementAddress: `0x${string}`
  factoryAddress: `0x${string}`
  oracleAddress: `0x${string}`
  collateralToken: `0x${string}`
  collateralDecimals: number
  collateralSymbol?: string
  explorerUrl?: string
}

export function parseEvmConfig(input: unknown): EvmVenueConfig {
  const value = record(input)
  const venue = venueId(value.venue)
  invariant(venue !== 'SOLANA' && venue !== 'DREAMDEX' && value.family === 'EVM', 'INVALID_CONFIG', 'Expected a custom EVM venue configuration.')
  const chainId = textField(value.chainId, 'chainId')
  invariant(/^[1-9][0-9]*$/.test(chainId) && BigInt(chainId) <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_CONFIG', 'Invalid EVM chain ID.')
  const rpcUrl = new URL(textField(value.rpcUrl, 'rpcUrl', 2048))
  invariant(['http:', 'https:'].includes(rpcUrl.protocol), 'INVALID_CONFIG', 'RPC must use HTTP or HTTPS.')
  const address = (name: string) => {
    const result = textField(value[name], name)
    invariant(/^0x[0-9a-fA-F]{40}$/.test(result) && !/^0x0{40}$/.test(result), 'INVALID_CONFIG', `${name} must be a nonzero EVM address.`)
    return result as `0x${string}`
  }
  return { family: 'EVM', venue, chainId, rpcUrl: rpcUrl.toString(), settlementAddress: address('settlementAddress'), factoryAddress: address('factoryAddress'), oracleAddress: address('oracleAddress'), collateralToken: address('collateralToken'), collateralDecimals: integer(value.collateralDecimals, 'collateralDecimals', 0, 18), collateralSymbol: predictionCollateralSymbol(value.collateralSymbol), explorerUrl: value.explorerUrl === undefined ? undefined : new URL(textField(value.explorerUrl, 'explorerUrl', 2048)).toString() }
}
