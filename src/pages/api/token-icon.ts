import type { APIRoute } from 'astro'
import { allowedIconHost } from '../../components/solz/tokenIcon'

export const prerender = false

/**
 * A COIN'S CREST, SERVED FROM THIS ORIGIN.
 *
 * Token registries hand back icons on whatever host the coin's metadata named -
 * an IPFS gateway, Arweave, a raw GitHub blob. Fetching those straight from the
 * page mostly works and sometimes does not: a host that omits
 * `Cross-Origin-Resource-Policy` is refused outright by an embedder that sets
 * COEP, which is exactly what happened here - USDC's crest loaded from
 * raw.githubusercontent.com (which sends `CORP: cross-origin`) while SOLZ's
 * loaded from ipfs.io (which sends nothing) and was blocked with
 * ERR_BLOCKED_BY_RESPONSE.NotSameOrigin. The coin then rendered as the fallback
 * mark, which is indistinguishable from having no logo at all.
 *
 * A same-origin image is never subject to CORP, so the bytes come through here.
 *
 * THIS IS NOT AN OPEN PROXY. It fetches https only, from a fixed list of hosts
 * that serve token metadata and nothing else, and it returns only something that
 * actually came back as an image. An unlisted host is refused rather than
 * fetched, because a route that will fetch any URL a query string names is a
 * server-side request forgery with a picture frame around it.
 */

/** A crest is a few hundred kilobytes. Anything past this is not one, and
 *  streaming it would make this route a bandwidth amplifier. */
const MAX_BYTES = 3_000_000

/**
 * THE SAME FILE, ASKED OF A DIFFERENT GATEWAY.
 *
 * An IPFS URL names CONTENT, not a server: `/ipfs/<cid>` is the same bytes
 * whichever gateway serves it, which is the one thing about this route's
 * upstreams that can be relied on. And the public gateways rate-limit hard -
 * SOLZ's crest is published by Jupiter as ipfs.io/ipfs/bafkrei..., and ipfs.io
 * and dweb.link were both answering 429 while gateway.pinata.cloud served the
 * identical CID as a 153KB PNG. Retrying the SAME host, which is all this route
 * did, cannot get past that: it is the host that is saying no, not the network.
 *
 * So a failed IPFS fetch is re-asked of the other gateways in turn. Every
 * candidate is built by swapping ONLY the host and re-checked against
 * `allowedIconHost`, so this can widen what gets fetched to exactly nothing the
 * allowlist did not already permit.
 *
 * Non-IPFS URLs have no equivalent - an Arweave or GitHub URL names one host
 * and means it - so they get the list of one and the retry below.
 */
const IPFS_GATEWAYS = ['gateway.pinata.cloud', 'dweb.link', 'ipfs.io', 'w3s.link', 'nftstorage.link']

function iconCandidates(target: URL): URL[] {
  // `/ipfs/<cid>` or `/ipfs/<cid>/path`. A CID is the address of the content, so
  // anything else on this host is left exactly where it was published.
  if (!/^\/ipfs\/[A-Za-z0-9]+(\/|$)/.test(target.pathname)) return [target]
  const alternates = IPFS_GATEWAYS
    .filter((host) => host !== target.hostname.toLowerCase())
    .flatMap((host) => {
      const swapped = new URL(target.toString())
      swapped.hostname = host
      // Re-validated, never trusted: this list and ICON_HOSTS are edited by
      // different hands, and a gateway that is not on the allowlist must not
      // reach the network just because it is named here.
      const allowed = allowedIconHost(swapped.toString())
      return allowed ? [allowed] : []
    })
  return [target, ...alternates]
}

export const GET: APIRoute = async ({ url }) => {
  const target = allowedIconHost(url.searchParams.get('url') ?? '')
  if (!target) return new Response('Not an allowed token-icon host.', { status: 400 })

  /** ONE RETRY, BECAUSE A MISS HERE IS STICKY. TeamMark records which URL failed
   *  and stops asking for it, so a single upstream timeout or rate-limit does not
   *  cost one frame - it costs that coin its crest for the rest of the session,
   *  and the next load fails on a different row. That is what "the images work
   *  sometimes" is. One cheap retry removes the common case; anything past that
   *  is a host that is genuinely down. */
  const attempt = (candidate: URL) => fetch(candidate, {
    headers: { accept: 'image/*' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'follow',
  })
  const isImage = (response: Response | null) =>
    !!response?.ok && (response.headers.get('content-type') ?? '').startsWith('image/')
  try {
    // The original host twice (the blip this retry was written for), then the
    // other gateways once each (the rate-limit it cannot help with).
    const candidates = iconCandidates(target)
    let upstream = await attempt(target).catch(() => null)
    if (!isImage(upstream)) {
      for (const candidate of candidates) {
        upstream = await attempt(candidate).catch(() => null)
        if (isImage(upstream)) break
      }
    }
    if (!upstream) throw new Error('no response')
    const type = upstream.headers.get('content-type') ?? ''
    // Only an image. Whatever else the host felt like returning is not a crest,
    // and passing it through would let this route serve arbitrary content from
    // this origin.
    if (!upstream.ok || !type.startsWith('image/')) return new Response('No image there.', { status: 404 })
    const bytes = await upstream.arrayBuffer()
    if (bytes.byteLength > MAX_BYTES) return new Response('Image too large.', { status: 413 })
    return new Response(bytes, {
      headers: {
        'content-type': type,
        'content-length': String(bytes.byteLength),
        // A crest does not change. A day in the browser, a week at the edge.
        'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
        'cross-origin-resource-policy': 'cross-origin',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    // A crest that did not arrive is a missing picture. The row falls back to
    // the built-in mark, which is what it did before this route existed.
    return new Response('Could not fetch the icon.', { status: 502 })
  }
}
