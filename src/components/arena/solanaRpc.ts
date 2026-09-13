/** Single source for the browser's Solana RPC endpoint.
 *
 * The wallet layer builds its own Connection before any venue config has been
 * fetched, so it cannot use the venue's publicRpcUrl. It reads
 * VITE_SOLANA_RPC_ENDPOINT instead, which keeps the rotating provider key in the
 * environment rather than hardcoded in a component or committed to a data file.
 */
const FALLBACK = 'https://api.devnet.solana.com'

export function solanaRpcEndpoint(): string {
  const configured = String(
    (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_SOLANA_RPC_ENDPOINT : undefined) ??
      (typeof process !== 'undefined' ? process.env?.VITE_SOLANA_RPC_ENDPOINT : undefined) ??
      '',
  ).trim()
  if (!configured) return FALLBACK
  try {
    const url = new URL(configured)
    // Never accept credentials in the URL userinfo; a provider key belongs in the
    // query string where the rest of the stack already validates it.
    if (url.username || url.password) return FALLBACK
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return FALLBACK
    return url.toString()
  } catch {
    return FALLBACK
  }
}
