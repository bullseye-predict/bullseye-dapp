/** Single source for the browser's Solana RPC endpoint.
 *
 * The wallet layer builds its own Connection before any venue config has been
 * fetched, so it cannot use the venue's publicRpcUrl. It reads
 * VITE_SOLANA_RPC_ENDPOINT instead, which keeps the rotating provider key in the
 * environment rather than hardcoded in a component or committed to a data file.
 *
 * There is deliberately no default. Mainnet and devnet must be configured with
 * distinct RPC endpoints (PREDICTION_PRODUCTION_PLAN.md:120), and a built-in
 * devnet fallback makes a misconfigured mainnet build sign against devnet in
 * silence. Both call sites resolve this lazily, so throwing surfaces the
 * misconfiguration at connect time instead of mispointing the cluster.
 */
function reject(reason: string): never {
  throw new Error(`VITE_SOLANA_RPC_ENDPOINT ${reason}. Configure the RPC endpoint for this deployment's cluster.`)
}

export function solanaRpcEndpoint(): string {
  const configured = String(
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SOLANA_RPC_ENDPOINT : undefined) ??
      (typeof process !== 'undefined' ? process.env?.VITE_SOLANA_RPC_ENDPOINT : undefined) ??
      '',
  ).trim()
  if (!configured) reject('is not set')
  let url: URL
  try { url = new URL(configured) } catch { reject('is not a valid URL') }
  // Never accept credentials in the URL userinfo; a provider key belongs in the
  // query string where the rest of the stack already validates it.
  if (url.username || url.password) reject('must not embed credentials')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) reject('must be https, or http on localhost')
  return url.toString()
}

export type SolanaWalletNetwork = 'mainnet' | 'devnet' | 'testnet'

export function solanaNetworkFromRpcEndpoint(endpoint = solanaRpcEndpoint()): SolanaWalletNetwork {
  const host = new URL(endpoint).hostname
  if (/devnet/i.test(host)) return 'devnet'
  if (/testnet/i.test(host)) return 'testnet'
  return 'mainnet'
}

export function solanaWalletChain(endpoint = solanaRpcEndpoint()): `solana:${SolanaWalletNetwork}` {
  return `solana:${solanaNetworkFromRpcEndpoint(endpoint)}`
}

export function solscanAccountUrl(address: string, endpoint = solanaRpcEndpoint()) {
  const network = solanaNetworkFromRpcEndpoint(endpoint)
  return network === 'mainnet'
    ? `https://solscan.io/account/${address}`
    : `https://solscan.io/account/${address}?cluster=${network}`
}
