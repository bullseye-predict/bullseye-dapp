import { createManifestHybridClient } from '../../../../packages/adapters/solana/manifest/hybrid'

type Deployment = { genesisHash: string; predictionProgram: string; manifestProgram: string; collateralMint: string }
type Client = ReturnType<typeof createManifestHybridClient>

/**
 * One client per deployment, shared by every panel on the page.
 *
 * Each client owns a Connection and memoises verifyDeployment (getGenesisHash +
 * getMultipleAccountsInfo) on itself, so building one per market meant those two
 * calls per market: a twelve-question event opened twenty-four RPC calls and ran
 * twelve independent 429 retry loops against the same endpoint. The deployment
 * is identical across those markets, so the client can be too.
 */
const clients = new Map<string, Client>()

export function manifestClient(rpcUrl: string, deployment: Deployment): Client {
  const key = `${rpcUrl}|${deployment.genesisHash}|${deployment.predictionProgram}|${deployment.manifestProgram}|${deployment.collateralMint}`
  const existing = clients.get(key)
  if (existing) return existing
  // Constructing may throw on a malformed deployment; a rejected client is not
  // cached, so a later retry can still succeed.
  const created = createManifestHybridClient(rpcUrl, deployment)
  clients.set(key, created)
  return created
}
