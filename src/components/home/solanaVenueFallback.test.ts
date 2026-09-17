import { expect, test } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { publicSolanaVenue } from './solanaVenueFallback'

test('uses only a complete public Solana deployment fallback', () => {
  const key = () => Keypair.generate().publicKey.toBase58()
  const environment = { PUBLIC_PREDICTION_PROGRAM_ID: key(), PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID: key(), PUBLIC_PREDICTION_CLUSTER: 'devnet', PUBLIC_PREDICTION_COLLATERAL_MINT: key(), PUBLIC_PREDICTION_COLLATERAL_DECIMALS: '6', PUBLIC_PREDICTION_COLLATERAL_SYMBOL: 'USDC' }
  process.env.VITE_SOLANA_RPC_ENDPOINT = 'http://127.0.0.1:8899'
  expect(publicSolanaVenue(environment)).toMatchObject({ family: 'SOLANA', matchingEngine: 'MANIFEST', chainId: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', collateralSymbol: 'USDC' })
  expect(publicSolanaVenue({ ...environment, PUBLIC_PREDICTION_MANIFEST_PROGRAM_ID: '' })).toBeNull()
  expect(publicSolanaVenue({ ...environment, PUBLIC_PREDICTION_CLUSTER: 'not-a-cluster' })).toBeNull()
  delete process.env.VITE_SOLANA_RPC_ENDPOINT
})
