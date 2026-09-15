/** Which Solana cluster a venue is actually on.
 *
 * Solana names a cluster by its genesis hash, and the venue record already
 * carries one in `chainId` — asserted against the live RPC by `assertNetwork`,
 * so it is the one cluster fact on the page that cannot drift from reality.
 *
 * This exists because the label did drift. Three separate things claimed to
 * know the cluster and none of them read the chain: `useSolanaMarketPrices`
 * hardcoded the literal 'DEVNET' into six status strings, `solanaQuestionMarkets`
 * hardcoded 'SOLANA DEVNET' and 'MANIFEST DEVNET' onto every question, and
 * `HomeApp` held a user-toggled `solanaCluster` that labelled the venue by what
 * the reader had clicked rather than by what the RPC answered. A mainnet
 * deployment announced itself as devnet on every one of those surfaces.
 *
 * Two copies of the hash table also existed, and they disagreed: the explorer's
 * testnet entry was a string that is not any cluster's genesis hash, so testnet
 * links dropped `?cluster=` and resolved against mainnet-beta instead.
 */
export type SolanaCluster = 'mainnet' | 'devnet' | 'testnet'

const GENESIS: Record<string, SolanaCluster> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': 'mainnet',
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY': 'testnet',
}

/** Undefined for an unknown or absent genesis hash. Callers must render that as
 *  "unknown cluster", never as a default — naming the wrong chain is worse than
 *  declining to name one, because a reader acts on it. */
export function solanaCluster(genesisHash: string | undefined | null): SolanaCluster | undefined {
  return genesisHash ? GENESIS[genesisHash] : undefined
}

/** The cluster in the form status lines and badges want. */
export function solanaClusterLabel(genesisHash: string | undefined | null): string {
  return solanaCluster(genesisHash)?.toUpperCase() ?? 'UNKNOWN CLUSTER'
}

/** The `?cluster=` value explorer.solana.com expects, or undefined for
 *  mainnet-beta, which takes no parameter. Undefined for an unknown hash too —
 *  identical in the URL, opposite in meaning, so callers that care must test
 *  `solanaCluster()` rather than this. */
export function explorerClusterParam(genesisHash: string | undefined | null): string | undefined {
  const cluster = solanaCluster(genesisHash)
  return cluster === undefined || cluster === 'mainnet' ? undefined : cluster
}
