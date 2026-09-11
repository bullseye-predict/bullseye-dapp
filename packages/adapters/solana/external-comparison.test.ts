import { describe, expect, test } from 'bun:test'
import { Connection, Keypair } from '@solana/web3.js'
import { EXTERNAL_VENUE_READINESS, ManifestComparisonAdapter, manifestTokenMovement, MeteoraComparisonAdapter } from './external-comparison'
import { initializeOutcomeMint, moveOutcomeTokens, outcomeMintAddress } from './outcome-tokens'

const keys = Array.from({ length: 4 }, () => Keypair.generate().publicKey)
const binding = { programId: keys[0]!, predictionMarket: keys[1]!, collateralMint: keys[2]!, outcome: 0 as const }
describe('external venue comparison boundaries', () => {
  test('neither adapter can enable trading against a public RPC', () => {
    for (const Adapter of [ManifestComparisonAdapter, MeteoraComparisonAdapter]) {
      expect(() => new Adapter(new Connection('https://api.mainnet-beta.solana.com'), binding)).toThrow('local validator')
      expect(() => new Adapter(new Connection('http://127.0.0.1.example.com'), binding)).toThrow('local validator')
    }
    expect(EXTERNAL_VENUE_READINESS.productionReady).toBe(false)
  })
  test('core Manifest transfers encode a single optional hint and retain all u64 bits', () => {
    // Regression: upstream 0.2.46 emits two hints and fails Borsh try_from_slice.
    const atoms = 9_007_199_254_740_993n
    for (const direction of ['deposit', 'withdraw'] as const) {
      const ix = manifestTokenMovement(keys[3]!, keys[1]!, keys[2]!, atoms, direction)
      expect(ix.data.length).toBe(10)
      expect(ix.data.toString('hex')).toBe(`${direction === 'deposit' ? '02' : '03'}010000000000200000`)
      expect(ix.keys[0]!.isSigner).toBe(true)
    }
  })
  test('outcome identity includes both the prediction market and outcome', () => {
    const yes = outcomeMintAddress(keys[0]!, keys[1]!, 0)
    expect(yes.equals(outcomeMintAddress(keys[0]!, keys[1]!, 1))).toBe(false)
    expect(yes.equals(outcomeMintAddress(keys[0]!, keys[2]!, 0))).toBe(false)
    const init = initializeOutcomeMint(keys[0]!, keys[3]!, keys[1]!, keys[2]!, 0)
    expect(init.keys[3]!.pubkey.equals(yes)).toBe(true)
    expect(() => moveOutcomeTokens(keys[0]!, keys[3]!, keys[1]!, 0, 0n, 'export')).toThrow('positive')
    expect(() => moveOutcomeTokens(keys[0]!, keys[3]!, keys[1]!, 0, 1n << 64n, 'import')).toThrow('u64')
  })
})
