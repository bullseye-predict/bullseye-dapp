import type { APIRoute } from 'astro'
import {
  SIGNATURE, UUID, boundedBody, catwalkOrigin, forwardToCatwalk, methodNotAllowed, onlyKeys, sealed,
} from '../../../server/catwalk-quote'

export const prerender = false

/**
 * POST /api/catwalk/confirm -> POST /api/v1/catwalk/quotes/:id/confirm upstream.
 *
 * { bidId, signature } in. `bidId` travels in the BODY here and becomes the
 * upstream's path parameter, which is why it is validated as a UUID before it
 * is interpolated and encoded on the way out: a path built from an unvalidated
 * string is a path the caller chose.
 *
 * Only `signature` reaches the upstream body, because that is the whole of its
 * `.strict()` schema.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const resolved = catwalkOrigin(locals)
  if ('refusal' in resolved) return resolved.refusal

  const read = await boundedBody(request)
  if ('tooLarge' in read) return sealed({ ok: false, error: 'catwalk_request_too_large' }, 413)
  if ('invalid' in read) return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  const body = read.body as Record<string, unknown>
  if (!onlyKeys(body, ['bidId', 'signature']))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  const { bidId, signature } = body
  if (typeof bidId !== 'string' || !UUID.test(bidId))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)
  // A wrong-length paste here is almost always an ADDRESS in the signature box,
  // which the dialog says in words. The shape check is the same one upstream
  // applies, so the refusal happens before a round trip either way.
  if (typeof signature !== 'string' || !SIGNATURE.test(signature))
    return sealed({ ok: false, error: 'catwalk_request_invalid' }, 400)

  return forwardToCatwalk(
    resolved.origin,
    `/api/v1/catwalk/quotes/${encodeURIComponent(bidId)}/confirm`,
    { signature },
  )
}

export const ALL: APIRoute = () => methodNotAllowed()
