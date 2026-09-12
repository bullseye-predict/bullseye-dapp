import { expect, test } from 'bun:test'
import { Keypair } from '@solana/web3.js'
import { createManifestHybridClient } from './hybrid'

const key = () => Keypair.generate().publicKey

test('keeps Kit addresses at the app boundary while constructing the legacy Manifest adapter internally', () => {
  const prediction = key(), manifest = key(), collateral = key(), question = key()
  const client = createManifestHybridClient('http://127.0.0.1:8899', {
    genesisHash: 'local-fixture',
    predictionProgram: prediction,
    manifestProgram: manifest,
    collateralMint: collateral,
  })

  expect(String(client.toAddress(question.toBase58()))).toBe(question.toBase58())
  expect(client.adapter.deployment.predictionProgram.equals(prediction)).toBe(true)
  expect(client.adapter.deployment.manifestProgram.equals(manifest)).toBe(true)
})
