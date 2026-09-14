import { fromLegacyPublicKey } from '@solana/compat'
import { createSolanaRpc, type Address } from '@solana/kit'
import { PublicKey } from '@solana/web3.js'
import { manifestConnection } from './rpc'
import { ManifestAdapter, type ManifestDeployment } from './adapter'
import type { ManifestBinding, Outcome } from './wire'

/**
 * App-facing Solana client for a Manifest venue.
 *
 * Kit supplies app-level address types. Identity, blockhash and SDK reads use
 * the shared connection so one rate-limit policy covers the whole trade.
 */
export type ManifestHybridClient = {
  adapter: ManifestAdapter
  kitRpc: ReturnType<typeof createSolanaRpc>
  toAddress(value: string): Address
  assertNetwork(): Promise<void>
  latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>
  binding(question: string, outcome: Outcome): Promise<ManifestBinding>
}

type ManifestHybridDeployment = Omit<ManifestDeployment, 'predictionProgram' | 'manifestProgram' | 'collateralMint'> & {
  predictionProgram: PublicKey | string
  manifestProgram: PublicKey | string
  collateralMint: PublicKey | string
}

export function createManifestHybridClient(rpcUrl: string, deployment: ManifestHybridDeployment): ManifestHybridClient {
  const kitRpc = createSolanaRpc(rpcUrl)
  const legacyDeployment: ManifestDeployment = {
    ...deployment,
    predictionProgram: new PublicKey(deployment.predictionProgram),
    manifestProgram: new PublicKey(deployment.manifestProgram),
    collateralMint: new PublicKey(deployment.collateralMint),
  }
  const adapter = new ManifestAdapter(manifestConnection(rpcUrl), legacyDeployment)
  let networkCheck: Promise<void> | undefined

  const toAddress = (value: string) => fromLegacyPublicKey(new PublicKey(value))
  const assertNetwork = () => {
    if (!networkCheck) {
      networkCheck = adapter.connection.getGenesisHash().then(genesisHash => {
        if (genesisHash !== legacyDeployment.genesisHash) throw new Error('Wrong Solana genesis identity')
      }).catch(error => {
        networkCheck = undefined
        throw error
      })
    }
    return networkCheck
  }

  return {
    adapter,
    kitRpc,
    toAddress,
    assertNetwork,
    async latestBlockhash() {
      await assertNetwork()
      const response = await adapter.connection.getLatestBlockhash('confirmed')
      const lastValidBlockHeight = response.lastValidBlockHeight
      if (!Number.isSafeInteger(lastValidBlockHeight)) throw new Error('Invalid Solana block height')
      return { blockhash: response.blockhash, lastValidBlockHeight }
    },
    async binding(question, outcome) {
      const legacyQuestion = new PublicKey(toAddress(question))
      await assertNetwork()
      return adapter.binding(legacyQuestion, outcome)
    },
  }
}
