import type { PublicPredictionVenue } from '../../packages/prediction-core/market-data'
import { integer, invariant, record, textField, venueId } from '../../packages/prediction-core/validation'

/** Never spread a server deployment object: rpcUrl and key environment names are private. */
export function publicVenueConfig(input: unknown): PublicPredictionVenue {
  const value = record(input)
  invariant(value.family === 'EVM' || value.family === 'SOLANA', 'INVALID_CONFIG', 'Invalid public venue family.')
  const url = (key: string): string | undefined => {
    if (!value[key]) return undefined
    const parsed = new URL(textField(value[key], key, 2048))
    invariant(['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password, 'INVALID_CONFIG', `${key} must be a public HTTP URL without embedded credentials.`)
    return parsed.toString()
  }
  return {
    family: value.family, venue: venueId(value.venue), chainId: textField(value.chainId, 'chainId'), label: textField(value.label ?? value.venue, 'label', 100),
    collateralToken: textField(value.collateralToken, 'collateralToken'), collateralDecimals: integer(value.collateralDecimals, 'collateralDecimals', 0, 18),
    collateralSymbol: textField(value.collateralSymbol ?? 'COLLATERAL', 'collateralSymbol', 24), publicRpcUrl: url('publicRpcUrl'), explorerUrl: url('explorerUrl'),
    ...(value.family === 'EVM' ? { settlementAddress: textField(value.settlementAddress, 'settlementAddress'), factoryAddress: textField(value.factoryAddress, 'factoryAddress'), oracleAddress: textField(value.oracleAddress, 'oracleAddress') }
      : { programId: textField(value.programId, 'programId'), networkDomain: textField(value.networkDomain, 'networkDomain') }),
  }
}
