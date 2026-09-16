/**
 * THE CATWALK SALE'S WRITE PATH, and the only one this site has.
 *
 * Two routes sit on top of this module - src/pages/api/catwalk/quote.ts and
 * src/pages/api/catwalk/confirm.ts - and both of them move real money, so this
 * file is deliberately narrow and deliberately suspicious of everything.
 *
 * WHY THIS IS NOT src/server/arena-proxy.ts. That module is the GET proxy: a
 * fixed kind -> path map, a query allowlist, and `cache-control: public,
 * max-age=5, s-maxage=10` on every answer. A publicly cacheable quote response
 * is one buyer's bill handed to the next visitor - their memo, their
 * destination, their amount. It also has no notion of a path parameter, which
 * the confirm route's `:id` needs. Nothing here touches it.
 *
 * WHY THIS IS NOT src/server/upstream-proxy.ts EITHER. That one streams the
 * client's body and forwards ALL client headers, cookies and authorization
 * included. On a money route that hands the browser a way to speak to the
 * control plane in this site's name. The house pattern for a write is
 * src/pages/api/identity/profiles.ts: a narrow, dedicated route that validates
 * its own body server-side, composes its own answer, and sets `no-store`.
 *
 * WHAT IT FORWARDS: a body it re-serialized itself from fields it validated
 * itself, and two headers it wrote itself. Not one byte the client sent.
 *
 * WHAT IT RETURNS: the upstream JSON body VERBATIM, with the upstream STATUS.
 * This is the one place this repo departs from arena-proxy.ts, which flattens
 * everything to 404/502/503, and the departure is the point: the dialog
 * branches on the `error` STRING, and flattening the body would destroy the
 * only thing that tells a buyer "this coin already holds a seat" apart from
 * "the server is broken".
 */

/** The upstream's own address shape, mirroring _solz-elysia
 *  src/domain/catwalk.ts:37. Base58 has no `0`, `O`, `I` or `l`. */
export const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
/** Sixty-four bytes of base58. _solz-elysia src/domain/catwalk.ts:49. */
export const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/
export const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

/**
 * The most a caller may send. Mirrors the upstream's own `boundedJson`, which
 * bounds BEFORE its framework parses anything - so this bounds before
 * `JSON.parse`, for the same reason.
 */
export const MAX_BODY_BYTES = 2048

const NO_STORE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } as const

/** Every response this module builds. Never `public`, never `max-age`, never
 *  `s-maxage`: a quote is one buyer's bill and belongs in nobody's shared
 *  cache, least of all a CDN's. */
export const sealed = (body: unknown, status: number) =>
  Response.json(body, { status, headers: { ...NO_STORE } })

/**
 * The upstream origin, or a refusal.
 *
 * Resolved exactly as src/pages/api/agent-arena.ts does, and with the same
 * refusal: an unset origin fails loudly rather than silently proxying a payment
 * to whatever happens to be deployed. NEVER a production fallback.
 *
 * The message names the variable and the repo and NOTHING ELSE - not the
 * resolved URL, not the environment shape.
 */
export function catwalkOrigin(locals: unknown): { origin: string } | { refusal: Response } {
  const runtime = (locals as { runtime?: { env?: Record<string, unknown> } })?.runtime?.env ?? {}
  const raw = String(
    runtime.SOLZ_GAME_API_ORIGIN
    ?? (typeof process !== 'undefined' ? process.env.SOLZ_GAME_API_ORIGIN : undefined)
    ?? import.meta.env.SOLZ_GAME_API_ORIGIN
    ?? '',
  ).trim()
  if (!raw) return {
    refusal: sealed(
      { ok: false, error: 'catwalk_upstream_unconfigured' },
      503,
    ),
  }
  // RE-VALIDATED PER REQUEST, exactly as arena-proxy.ts does it. Credentials in
  // an origin would be sent on every payment call; a plaintext origin off
  // loopback is a downgrade the buyer cannot see.
  try {
    const base = new URL(raw)
    if (base.username || base.password) return { refusal: sealed({ ok: false, error: 'catwalk_upstream_unconfigured' }, 503) }
    const secure = base.protocol === 'https:'
      || (base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))
    if (!secure) return { refusal: sealed({ ok: false, error: 'catwalk_upstream_unconfigured' }, 503) }
    return { origin: raw }
  } catch {
    return { refusal: sealed({ ok: false, error: 'catwalk_upstream_unconfigured' }, 503) }
  }
}

/**
 * The request body, bounded and parsed, or null.
 *
 * BOUNDED BEFORE PARSING. `JSON.parse` on an unbounded string is the work, not
 * the check - a route that reads the whole body and then measures it has
 * already done the expensive part.
 */
export async function boundedBody(request: Request): Promise<{ body: unknown } | { tooLarge: true } | { invalid: true }> {
  let text: string
  try { text = await request.text() } catch { return { invalid: true } }
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return { tooLarge: true }
  try {
    const body = JSON.parse(text)
    if (!body || typeof body !== 'object' || Array.isArray(body)) return { invalid: true }
    return { body }
  } catch { return { invalid: true } }
}

/** Exactly these keys and no others. The upstream schema is `.strict()`, so a
 *  route that forwarded extras would only turn a local 400 into a round trip -
 *  and a key this route does not know is a key it cannot vouch for. */
export const onlyKeys = (body: object, keys: readonly string[]) =>
  Object.keys(body).every((key) => keys.includes(key))

/**
 * Send it, and hand back what came back.
 *
 * NO CLIENT HEADER CROSSES THIS LINE - no cookie, no authorization, no
 * user-agent, no referer, no forwarded-for. Exactly two headers, both written
 * here. The body is re-serialized by the caller from fields it validated; the
 * client's raw bytes are never forwarded.
 *
 * A non-JSON upstream answer is refused rather than echoed: a proxy that pipes
 * arbitrary upstream bytes through its own origin is an open redirect with
 * extra steps.
 */
export async function forwardToCatwalk(
  origin: string,
  path: string,
  payload: unknown,
  fetcher: (input: string | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  let upstream: Response
  try {
    const target = new URL(path, origin)
    upstream = await fetcher(target, {
      method: 'POST',
      // A redirect on a payment call is somebody else's endpoint answering.
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    // NEVER the fetch error's own message: it carries the origin, which is the
    // one thing this route exists not to publish.
    return sealed({ ok: false, error: 'catwalk_upstream_unreachable' }, 502)
  }
  const type = upstream.headers.get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json'))
    return sealed({ ok: false, error: 'catwalk_upstream_invalid' }, 502)
  let body: unknown
  try { body = await upstream.json() } catch { return sealed({ ok: false, error: 'catwalk_upstream_invalid' }, 502) }
  // THE BODY VERBATIM, THE STATUS UNCHANGED, AND A FRESH Response. No upstream
  // header is copied through - not its cache-control, not its set-cookie, not
  // its own CORS decisions.
  return sealed(body, upstream.status)
}

/** The ending every route in this pair shares, lifted from
 *  src/pages/api/identity/profiles.ts. */
export const methodNotAllowed = () =>
  new Response('Method not allowed', { status: 405, headers: { allow: 'POST', 'cache-control': 'no-store' } })
