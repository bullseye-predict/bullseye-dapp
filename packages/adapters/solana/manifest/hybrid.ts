import { fromLegacyPublicKey } from '@solana/compat'
import { createSolanaRpc, type Address } from '@solana/kit'
import { Connection, PublicKey } from '@solana/web3.js'
import { ManifestAdapter, type ManifestDeployment } from './adapter'
import type { ManifestBinding, Outcome } from './wire'

/**
 * App-facing Solana client for a Manifest venue.
 *
 * Kit owns RPC identity and app-level address types. The pinned Manifest SDK
 * still requires web3.js v1 classes, so those are created only in this module
 * and never escape into React feature code.
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
  const adapter = new ManifestAdapter(new Connection(rpcUrl, 'confirmed'), legacyDeployment)
  let networkCheck: Promise<void> | undefined

  const toAddress = (value: string) => fromLegacyPublicKey(new PublicKey(value))
  const assertNetwork = () => {
    if (!networkCheck) {
      networkCheck = kitRpc.getGenesisHash().send().then(genesisHash => {
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
      const response = await kitRpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
      const lastValidBlockHeight = Number(response.value.lastValidBlockHeight)
      if (!Number.isSafeInteger(lastValidBlockHeight)) throw new Error('Invalid Solana block height')
      return { blockhash: String(response.value.blockhash), lastValidBlockHeight }
    },
    async binding(question, outcome) {
      const legacyQuestion = new PublicKey(toAddress(question))
      await assertNetwork()
      return adapter.binding(legacyQuestion, outcome)
    },
  }
}
