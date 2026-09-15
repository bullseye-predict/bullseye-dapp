/** Venue-driven block explorer links.
 *
 * A component must never hardcode one chain's explorer: switching venue has to
 * switch the link with it, the same way the RPC and program ids already come
 * from the venue record. The venue already carries `explorerUrl` and `chainId`.
 */


import { explorerClusterParam } from './solana/cluster'

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
    const cluster = explorerClusterParam(venue.chainId)
    return `${base}/tx/${hash}${cluster ? `?cluster=${cluster}` : ''}`
  }
  return `${base}/tx/${hash}`
}
