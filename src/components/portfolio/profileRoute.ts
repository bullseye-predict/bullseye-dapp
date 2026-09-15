import { solanaCluster } from '../../../packages/adapters/solana/cluster'

export type ProfileChain = 'solana' | 'somnia'
export type ProfileNetwork = 'devnet' | 'testnet' | 'mainnet'

export type ProfileRoute = {
  chain: ProfileChain
  network: ProfileNetwork
  address: string
}

export function profileHref(chain: ProfileChain, network: ProfileNetwork, address: string) {
  return `/${chain}/${network}/${encodeURIComponent(address)}`
}

/** Solana identifies a cluster by its genesis hash; the route needs the name.
 *  One table, in packages/adapters/solana/cluster.ts — the second copy that used
 *  to live here disagreed with the explorer's on testnet. */
export const solanaNetwork = (genesisHash: string | undefined): ProfileNetwork | undefined => solanaCluster(genesisHash)

/** Base58 is case sensitive and EVM hex is not, so the comparison has to know
 *  which chain it is on: lowercasing a Solana address can equate two distinct
 *  accounts and hand one trader another's page as their own. */
export function sameProfileAddress(left: string | undefined, right: string | undefined, chain: ProfileChain = 'somnia') {
  if (!left || !right) return false
  return chain === 'solana' ? left === right : left.toLowerCase() === right.toLowerCase()
}
