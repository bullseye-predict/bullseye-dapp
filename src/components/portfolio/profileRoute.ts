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

export function sameProfileAddress(left: string | undefined, right: string | undefined) {
  return Boolean(left && right && left.toLowerCase() === right.toLowerCase())
}
