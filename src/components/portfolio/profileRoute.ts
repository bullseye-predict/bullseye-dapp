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

/** Solana identifies a cluster by its genesis hash; the route needs the name. */
const SOLANA_GENESIS: Record<string, ProfileNetwork> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
}

export const solanaNetwork = (genesisHash: string | undefined): ProfileNetwork | undefined => genesisHash ? SOLANA_GENESIS[genesisHash] : undefined

/** Base58 is case sensitive and EVM hex is not, so the comparison has to know
 *  which chain it is on: lowercasing a Solana address can equate two distinct
 *  accounts and hand one trader another's page as their own. */
export function sameProfileAddress(left: string | undefined, right: string | undefined, chain: ProfileChain = 'somnia') {
  if (!left || !right) return false
  return chain === 'solana' ? left === right : left.toLowerCase() === right.toLowerCase()
}
