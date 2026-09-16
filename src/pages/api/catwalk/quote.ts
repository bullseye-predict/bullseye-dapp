import type { APIRoute } from 'astro'
import {
  ADDRESS, UUID, boundedBody, catwalkOrigin, forwardToCatwalk, methodNotAllowed, onlyKeys, sealed,
} from '../../../server/catwalk-quote'

export const prerender = false

/**
 * POST /api/catwalk/quote -> POST /api/v1/catwalk/quotes upstream.
 *
 * { mint, spot, wallet, idempotencyKey } in; the upstream's own envelope out,
 * body verbatim and status unchanged. See src/server/catwalk-quote.ts for why
 * this is a dedicated route rather than a passthrough.
 *
 * THE WALLET IS SELF-ASSERTED and always was - the upstream's own rate-limit
 * comment says so. This route does not authenticate anybody; the on-chain
 * payment is what authenticates the buyer at settlement. That is precisely what
 * lets the dialog issue a quote without a wallet connection.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const resolved = catwalkOrigin(locals)
  if ('refusal' in resolved) return resolved.refusal

  const read = await boundedBody(request)
  if ('tooLarge' in read) return sealed({ ok: false, error: 'catwalk_request_too_large' }, 413)
  if ('invalid' in read) return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  const body = read.body as Record<string, unknown>
  // EXACTLY THESE FOUR. The upstream schema is `.strict()`.
  if (!onlyKeys(body, ['mint', 'spot', 'wallet', 'idempotencyKey']))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  const { mint, spot, wallet, idempotencyKey } = body
  if (typeof mint !== 'string' || !ADDRESS.test(mint))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)
  if (typeof wallet !== 'string' || !ADDRESS.test(wallet))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)
  if (typeof spot !== 'number' || !Number.isInteger(spot) || spot < 1 || spot > 512)
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)
  if (typeof idempotencyKey !== 'string' || !UUID.test(idempotencyKey))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  // RE-SERIALIZED FROM THE VALIDATED FIELDS, never the client's raw bytes.
  return forwardToCatwalk(resolved.origin, '/api/v1/catwalk/quotes', { mint, spot, wallet, idempotencyKey })
}

export const ALL: APIRoute = () => methodNotAllowed()
