import type { PublicPredictionVenue } from '../../packages/prediction-core/market-data'
import { integer, invariant, record, textField, venueId } from '../../packages/prediction-core/validation'
import { predictionCollateralSymbol } from '../../packages/adapters/config'

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
  const manifest = value.family === 'SOLANA' && value.matchingEngine === 'MANIFEST'
  invariant(value.arenaMarketBindings === undefined || Array.isArray(value.arenaMarketBindings), 'INVALID_CONFIG', 'arenaMarketBindings must be an array.')
  return {
    ...(Array.isArray(value.arenaMarketBindings) ? { arenaMarketBindings: value.arenaMarketBindings.map(item => { const binding = record(item); return { eventId: textField(binding.eventId, 'eventId'), marketId: textField(binding.marketId, 'marketId') } }) } : {}),
    ...(manifest ? { matchingEngine: 'MANIFEST' as const, manifestProgramId: textField(value.manifestProgramId, 'manifestProgramId'), manifestMarkets: Object.entries(record(value.markets)).map(([address, raw]) => {
      const market = record(raw)
      invariant(Array.isArray(market.outcomes) && market.outcomes.length === 2, 'INVALID_CONFIG', 'Manifest requires two explicit outcome labels.')
      return { address, matchId: textField(market.matchId, 'matchId'), label: textField(market.label ?? market.matchId, 'label'), outcomes: market.outcomes.map(outcome => textField(record(outcome).label, 'outcome label')) }
    }) } : {}),
    family: value.family, venue: venueId(value.venue), chainId: textField(value.chainId, 'chainId'), label: textField(value.label ?? value.venue, 'label', 100),
    collateralToken: textField(value.collateralToken, 'collateralToken'), collateralDecimals: integer(value.collateralDecimals, 'collateralDecimals', 0, 18),
    collateralSymbol: predictionCollateralSymbol(value.collateralSymbol), publicRpcUrl: url('publicRpcUrl'), explorerUrl: url('explorerUrl'),
    ...(value.family === 'EVM' ? { settlementAddress: textField(value.settlementAddress, 'settlementAddress'), factoryAddress: textField(value.factoryAddress, 'factoryAddress'), oracleAddress: textField(value.oracleAddress, 'oracleAddress') }
      : { programId: textField(value.programId, 'programId'), networkDomain: textField(value.networkDomain, 'networkDomain') }),
  }
}
