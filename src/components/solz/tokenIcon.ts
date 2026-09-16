/**
 * WHICH HOSTS A COIN'S CREST MAY COME FROM, and the same-origin URL it is
 * fetched through.
 *
 * Shared by the browser and by the route that does the fetching
 * (src/pages/api/token-icon.ts), because the two have to agree: the page must
 * only ask for icons the route will serve, and the route must only fetch what
 * the page was allowed to ask for.
 *
 * THE REWRITE HAPPENS IN THE CLIENT, not in the token-meta reply. The reply is
 * cached for a minute with a long stale-while-revalidate behind it, so a payload
 * carrying a baked-in `/api/token-icon?...` URL would pin whatever rule was in
 * force when it was stored - and a fix to this file would not reach a reader for
 * an hour. The reply carries the registry's own URL; this module decides what to
 * do with it on every render.
 */

/** Registrable domains that serve token metadata images. A host matches when it
 *  IS one of these or is a subdomain of one - never by substring, which would
 *  let `ipfs.io.evil.test` through. */
export const ICON_HOSTS = [
  'ipfs.io',
  'dweb.link',
  'w3s.link',
  'nftstorage.link',
  'cf-ipfs.com',
  'cloudflare-ipfs.com',
  'mypinata.cloud',
  'gateway.pinata.cloud',
  'arweave.net',
  'raw.githubusercontent.com',
  'githubusercontent.com',
  'shdw-drive.genesysgo.net',
  'jup.ag',
  'dexscreener.com',
  'coingecko.com',
  'pump.fun',
  'irys.xyz',
  // Jupiter currently returns CATE's canonical artwork from Twitter's image
  // CDN. The exact host is allowlisted; arbitrary twitter/x URLs are not.
  'pbs.twimg.com',
  // Backed Finance serves every xStock's artwork from its own metadata host, so
  // without this the seven xStocks on the board fell back to the generic mark
  // while the registry was handing back a perfectly good URL for each of them.
  'backed.fi',
  'coingecko.com',
  'cloudfront.net',
  'akamaized.net',
  'imagedelivery.net',
  'r2.dev',
]

/**
 * The URL as something this site is willing to fetch, or null.
 *
 * https only: an http fetch made by the server is a downgrade the page cannot
 * see, and no registry needs one. The loopback address and any unlisted host are
 * refused rather than fetched, because a route that will fetch any URL a query
 * string names is a server-side request forgery with a picture frame around it.
 */
export function allowedIconHost(raw: string): URL | null {
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if (url.protocol !== 'https:') return null
  const host = url.hostname.toLowerCase()
  return ICON_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`)) ? url : null
}

/**
 * The same-origin URL a crest is loaded through, or '' when this site will not
 * fetch it.
 *
 * Same-origin bytes are never subject to `Cross-Origin-Resource-Policy`, which
 * is the whole reason this exists: USDC's crest came from raw.githubusercontent
 * .com (which sends `CORP: cross-origin`) and rendered, while SOLZ's came from
 * ipfs.io (which sends nothing) and was blocked with
 * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin - so the coin drew as the fallback mark,
 * which is indistinguishable from having no logo at all.
 */
export const tokenIconUrl = (raw: string) =>
  allowedIconHost(raw) ? `/api/token-icon?url=${encodeURIComponent(raw)}` : ''

/**
 * Prefer the board's published crest when it is a real absolute/data URL, but
 * route allowlisted remote bytes through this origin. Root-relative URLs belong
 * to the service that published them (SOLZ used to send `/solz_logo.svg`) and
 * are not valid on this frontend, so registry identity wins in that case.
 */
export function resolvedTokenLogo(boardLogo?: string | null, registryLogo = ''): string {
  if (boardLogo && (/^https:\/\//i.test(boardLogo) || boardLogo.startsWith('data:'))) {
    return tokenIconUrl(boardLogo) || boardLogo
  }
  return registryLogo
}
