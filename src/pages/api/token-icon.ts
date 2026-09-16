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

export const GET: APIRoute = async ({ url }) => {
  const target = allowedIconHost(url.searchParams.get('url') ?? '')
  if (!target) return new Response('Not an allowed token-icon host.', { status: 400 })

  try {
    const upstream = await fetch(target, {
      headers: { accept: 'image/*' },
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    })
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
