/** Venue-driven block explorer links.
 *
 * A component must never hardcode one chain's explorer: switching venue has to
 * switch the link with it, the same way the RPC and program ids already come
 * from the venue record. The venue already carries `explorerUrl` and `chainId`.
 */

// Solana uses one explorer host for every cluster and selects with a query
// parameter, so the cluster has to be derived from the venue's genesis hash.
const SOLANA_CLUSTER: Record<string, string | undefined> = {
  '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d': undefined, // mainnet-beta takes no parameter
  EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG: 'devnet',
  '4uhcVJyUZjqm4vG6QhWm1SxGKPQnHhkFXzChTBDvnPhY': 'testnet',
}

export interface ExplorerVenue {
  family?: string
  chainId?: string
  explorerUrl?: string
}

/** Returns undefined when the venue declares no explorer, so callers render no
 *  link rather than a link pointing at the wrong chain. */
export function explorerTxUrl(venue: ExplorerVenue | null | undefined, hash: string): string | undefined {
  const base = venue?.explorerUrl?.trim().replace(/\/+$/, '')
  if (!base || !hash) return undefined
  if (venue?.family === 'SOLANA') {
    const cluster = venue.chainId ? SOLANA_CLUSTER[venue.chainId] : undefined
    return `${base}/tx/${hash}${cluster ? `?cluster=${cluster}` : ''}`
  }
  return `${base}/tx/${hash}`
}
