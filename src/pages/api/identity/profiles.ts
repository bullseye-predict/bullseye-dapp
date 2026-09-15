import type { APIRoute } from 'astro'
import { runtimeEnvironment } from '../../../server/upstream-proxy'
import { MAX_BATCH, resolveTraderProfiles } from '../../../server/pump-profiles'

export const prerender = false

/**
 * The app's one wallet-directory endpoint.
 *
 * POST { addresses: string[] } -> { profiles: { [address]: profile | null }, unavailable: string[] }
 *
 * A null profile means the directory answered and that wallet has no public
 * handle; an address listed in `unavailable` means the read failed and the
 * browser should ask again later. The two are kept apart on purpose — caching a
 * failure as "no name" is how a wallet loses its identity for an hour.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  let payload: unknown
  try { payload = await request.json() } catch { payload = null }
  const addresses = (payload as { addresses?: unknown })?.addresses
  if (!Array.isArray(addresses))
    return Response.json({ error: 'Send { addresses: string[] }.' }, { status: 400, headers: { 'cache-control': 'no-store' } })
  if (addresses.length > MAX_BATCH)
    return Response.json({ error: `Send at most ${MAX_BATCH} addresses per request.` }, { status: 400, headers: { 'cache-control': 'no-store' } })

  const batch = await resolveTraderProfiles(addresses as string[], runtimeEnvironment(locals))
  return Response.json(batch, {
    // Private and short: the answer is identical for every visitor, but the
    // browser holds its own copy in the identity store already, so a long
    // shared cache here would only delay a renamed handle.
    headers: { 'cache-control': 'no-store' },
  })
}

export const ALL: APIRoute = () =>
  new Response('Method not allowed', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } })
