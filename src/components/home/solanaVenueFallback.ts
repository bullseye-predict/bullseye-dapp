import { PublicKey } from '@solana/web3.js'
import type { PublicPredictionVenue } from '../../../packages/prediction-core/market-data'
import { solanaRpcEndpoint } from '../arena/solanaRpc'

type Environment = Record<string, string | undefined>

const CLUSTER_GENESIS = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
} as const

function browserEnvironment(): Environment {
  return {
    PUBLIC_PREDICTION_PROGRAM_ID: import.meta.env.PUBLIC_PREDICTION_PROGRAM_ID,
    PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID: import.meta.env.PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID,
    PUBLIC_PREDICTION_CLUSTER: import.meta.env.PUBLIC_PREDICTION_CLUSTER,
    PUBLIC_PREDICTION_COLLATERAL_MINT: import.meta.env.PUBLIC_PREDICTION_COLLATERAL_MINT,
    PUBLIC_PREDICTION_COLLATERAL_DECIMALS: import.meta.env.PUBLIC_PREDICTION_COLLATERAL_DECIMALS,
    PUBLIC_PREDICTION_COLLATERAL_SYMBOL: import.meta.env.PUBLIC_PREDICTION_COLLATERAL_SYMBOL,
  }
}

/**
 * Public build-time deployment identity. The API remains the preferred source
 * for catalogue metadata, but an API outage must never stop an existing CLOB
 * market from being read or traded directly on Solana.
 */
export function publicSolanaVenue(environment: Environment = browserEnvironment()): PublicPredictionVenue | null {
  const value = (name: keyof Environment) => environment[name]?.trim() ?? ''
  const programId = value('PUBLIC_PREDICTION_PROGRAM_ID')
  const manifestProgramId = value('PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID')
  const cluster = value('PUBLIC_PREDICTION_CLUSTER')
  const chainId = CLUSTER_GENESIS[cluster as keyof typeof CLUSTER_GENESIS]
  const collateralToken = value('PUBLIC_PREDICTION_COLLATERAL_MINT')
  const collateralSymbol = value('PUBLIC_PREDICTION_COLLATERAL_SYMBOL') || 'USDC'
  const collateralDecimals = Number(value('PUBLIC_PREDICTION_COLLATERAL_DECIMALS') || '6')
  if (!programId || !manifestProgramId || !chainId || !collateralToken || !Number.isInteger(collateralDecimals) || collateralDecimals < 0 || collateralDecimals > 18) return null
  try {
    new PublicKey(programId); new PublicKey(manifestProgramId); new PublicKey(collateralToken)
    const publicRpcUrl = solanaRpcEndpoint()
    return { family: 'SOLANA', venue: 'SOLANA', matchingEngine: 'MANIFEST', label: `Solana ${cluster} · Manifest`, chainId,
      programId, manifestProgramId, collateralToken, collateralDecimals, collateralSymbol, publicRpcUrl, explorerUrl: 'https://explorer.solana.com' }
  } catch { return null }
}
