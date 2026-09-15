/**
 * The explorer link for a COIN — an account/address page, not a transaction.
 *
 * `packages/adapters/explorer.ts` owns explorer links for this app, but the only
 * thing it exports today is `explorerTxUrl`, and a mint is not a transaction:
 * pointing a contract address at `/tx/` produces a page that does not exist.
 * The address form belongs beside it in that adapter; this file cannot put it
 * there because packages/adapters is outside this agent's ownership block, so
 * it mirrors `explorerTxUrl` exactly — same venue record, same trailing-slash
 * trim, same "no explorer configured means no link" rule — and delegates the
 * one genuinely error-prone part, the cluster parameter, to the adapter that
 * already owns it (`explorerClusterParam`, packages/adapters/solana/cluster.ts).
 *
 * Fold this into packages/adapters/explorer.ts as `explorerAddressUrl` and
 * delete this file; nothing here is MIAW PRIX-specific.
 */

import { explorerClusterParam } from '../../../packages/adapters/solana/cluster'

export interface ExplorerVenue {
  family?: string
  chainId?: string
  explorerUrl?: string
}

/**
 * Undefined when the venue declares no explorer, so a caller renders no link
 * rather than a link pointing at the wrong chain. A wrong explorer under a
 * contract address is worse than no explorer: a reader acts on it.
 */
export function explorerAddressUrl(venue: ExplorerVenue | null | undefined, address: string): string | undefined {
  const base = venue?.explorerUrl?.trim().replace(/\/+$/, '')
  if (!base || !address) return undefined
  if (venue?.family === 'SOLANA') {
    const cluster = explorerClusterParam(venue.chainId)
    return `${base}/address/${address}${cluster ? `?cluster=${cluster}` : ''}`
  }
  return `${base}/address/${address}`
}
