import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test'
import { POST as quotePost, ALL as quoteAll } from '../src/pages/api/catwalk/quote'
import { POST as confirmPost, ALL as confirmAll } from '../src/pages/api/catwalk/confirm'
import { boundedBody, catwalkOrigin, forwardToCatwalk, onlyKeys } from '../src/server/catwalk-quote'

/**
 * THE WRITE PATH, WHICH IS THE ONE THIS SITE HAS.
 *
 * A quote is one buyer's bill. These assertions are about what the route
 * REFUSES and what it must never leak, because both of those are money
 * questions rather than plumbing ones.
 *
 * NOTHING HERE MAY REACH A NETWORK, and that is enforced rather than assumed -
 * see the tripwire below.
 */

const MINT = 'So11111111111111111111111111111111111111112'
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const KEY = '3f1a2b4c-5d6e-4f70-8192-a3b4c5d6e7f8'
const SIG = 'a'.repeat(87)
const ORIGIN = 'https://game.example.test'

const locals = { runtime: { env: { SOLZ_GAME_API_ORIGIN: ORIGIN } } }

/**
 * A TRIPWIRE BETWEEN CASES, AND THE REAL FETCH BACK AT THE END.
 *
 * `bun test` loads this repo's .env, so `SOLZ_GAME_API_ORIGIN` is genuinely set
 * while these run and the route resolves it exactly as it would in production.
 * Putting the REAL fetch back between cases would mean any case that forgot to
 * stub quietly called the live game API - so between cases it is a tripwire
 * that fails the test instead.
 *
 * IT IS RESTORED IN `afterAll`, WHICH IS NOT OPTIONAL. `bun test` runs every
 * file in ONE process and `globalThis.fetch` is shared, so a tripwire left
 * installed here breaks whatever file runs next - which is precisely what it
 * did to src/components/prediction/wallets.test.ts, whose viem client talks to
 * its own local `Bun.serve` fixture over real HTTP.
 */
const real = globalThis.fetch
const tripwire = (async () => { throw new Error('a test reached the network') }) as unknown as typeof fetch
beforeEach(() => { globalThis.fetch = tripwire })
afterEach(() => { globalThis.fetch = tripwire })
afterAll(() => { globalThis.fetch = real })

/** The upstream, stubbed. Records what it was actually sent. */
function upstream(body: unknown, status = 200) {
  const seen: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init ?? {} })
    return Response.json(body, { status })
  }) as typeof fetch
  return seen
}

const post = (payload: unknown, url = 'https://site.test/api/catwalk/quote') =>
  new Request(url, { method: 'POST', body: JSON.stringify(payload) })

const call = (route: typeof quotePost, request: Request, env: unknown = locals) =>
  route({ request, locals: env } as never) as Promise<Response>

/* ── WHAT IT ACCEPTS ─────────────────────────────────────────────────────── */

test('a valid quote is forwarded with a body this route re-serialized itself', async () => {
  const seen = upstream({ ok: true, bidId: 'b1', memo: 'm' })
  const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }))

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, bidId: 'b1', memo: 'm' })
  expect(seen).toHaveLength(1)
  expect(seen[0]!.url).toBe(`${ORIGIN}/api/v1/catwalk/quotes`)
  // RE-SERIALIZED FROM THE VALIDATED FIELDS. Never the client's raw bytes.
  expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY })
  // A redirect on a payment call is somebody else's endpoint answering.
  expect(seen[0]!.init.redirect).toBe('error')
})

/**
 * THE BODY VERBATIM, THE STATUS UNCHANGED.
 *
 * This is where the route deliberately departs from src/server/arena-proxy.ts,
 * which flattens everything to 404/502/503. The dialog branches on the `error`
 * STRING, and flattening would destroy the only thing that tells a buyer "this
 * coin already holds a seat" apart from "the server is broken".
 */
test('an upstream refusal reaches the client with its code and status intact', async () => {
  upstream({ ok: false, error: 'catwalk_team_already_holds_spot' }, 500)
  const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }))
  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ ok: false, error: 'catwalk_team_already_holds_spot' })
})

test('confirm puts the bid id in the path and only the signature in the body', async () => {
  const seen = upstream({ ok: true, settled: true, spot: 4, mint: MINT })
  const response = await call(
    confirmPost,
    post({ bidId: KEY, signature: SIG }, 'https://site.test/api/catwalk/confirm'),
  )
  expect(response.status).toBe(200)
  expect(seen[0]!.url).toBe(`${ORIGIN}/api/v1/catwalk/quotes/${KEY}/confirm`)
  // The upstream's confirm schema is `.strict()` and is exactly { signature }.
  expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ signature: SIG })
})

/* ── WHAT IT REFUSES ─────────────────────────────────────────────────────── */

test('every malformed quote is refused before a round trip', async () => {
  const seen = upstream({ ok: true })
  const bad: unknown[] = [
    { mint: 'nope', spot: 4, wallet: WALLET, idempotencyKey: KEY },
    { mint: MINT, spot: 4, wallet: 'nope', idempotencyKey: KEY },
    { mint: MINT, spot: 0, wallet: WALLET, idempotencyKey: KEY },
    { mint: MINT, spot: 513, wallet: WALLET, idempotencyKey: KEY },
    { mint: MINT, spot: 4.5, wallet: WALLET, idempotencyKey: KEY },
    { mint: MINT, spot: '4', wallet: WALLET, idempotencyKey: KEY },
    { mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: 'not-a-uuid' },
    { mint: MINT, spot: 4, wallet: WALLET },
    // AN UNKNOWN KEY IS A KEY THIS ROUTE CANNOT VOUCH FOR. The upstream schema
    // is `.strict()`, so forwarding extras only turns a local 400 into a trip.
    { mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY, price: 1 },
    [],
    'a string',
  ]
  for (const payload of bad) {
    const response = await call(quotePost, post(payload))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('catwalk_request_invalid')
  }
  // NOT ONE of them reached the upstream.
  expect(seen).toHaveLength(0)
})

test('a malformed confirm is refused, including a bid id that is not a uuid', async () => {
  const seen = upstream({ ok: true })
  for (const payload of [
    { bidId: '../../admin', signature: SIG },
    { bidId: KEY, signature: 'short' },
    // A wallet address in the signature box - the commonest paste error here.
    { bidId: KEY, signature: WALLET },
    { bidId: KEY, signature: SIG, extra: 1 },
    { signature: SIG },
  ]) {
    const response = await call(confirmPost, post(payload, 'https://site.test/api/catwalk/confirm'))
    expect(response.status).toBe(400)
  }
  // A PATH IS NEVER BUILT FROM AN UNVALIDATED STRING.
  expect(seen).toHaveLength(0)
})

/** Bounded BEFORE parsing, mirroring the upstream's own `boundedJson`. Parsing
 *  an unbounded body is the work, not the check. */
test('an oversized body is refused without being parsed', async () => {
  const seen = upstream({ ok: true })
  const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY, pad: 'x'.repeat(4000) }))
  expect(response.status).toBe(413)
  expect((await response.json()).error).toBe('catwalk_request_too_large')
  expect(seen).toHaveLength(0)
})

test('anything but POST is 405 with an allow header', () => {
  for (const route of [quoteAll, confirmAll]) {
    const response = route({} as never) as Response
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(response.headers.get('cache-control')).toBe('no-store')
  }
})

/* ── WHAT IT MUST NEVER DO ───────────────────────────────────────────────── */

/**
 * A SHARED, PUBLICLY CACHEABLE QUOTE IS ONE BUYER'S BILL HANDED TO THE NEXT
 * VISITOR - their memo, their destination, their amount. This is the single
 * most important header on the route, and it is on EVERY answer including the
 * failures.
 */
test('no answer on this path is ever cacheable', async () => {
  upstream({ ok: true, memo: 'secret' })
  const ok = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }))
  const bad = await call(quotePost, post({ mint: 'nope' }))
  for (const response of [ok, bad]) {
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cache-control')).not.toContain('public')
    expect(response.headers.get('cache-control')).not.toContain('max-age')
  }
})

/** NOT ONE CLIENT HEADER CROSSES THE LINE. Forwarding cookies or authorization
 *  on a money route hands the browser a way to speak to the control plane in
 *  this site's name. */
test('no client header, cookie or authorization is forwarded upstream', async () => {
  const seen = upstream({ ok: true })
  const request = new Request('https://site.test/api/catwalk/quote', {
    method: 'POST',
    headers: {
      cookie: 'session=secret',
      authorization: 'Bearer secret',
      'user-agent': 'Someone/1.0',
      referer: 'https://elsewhere.test',
      'x-forwarded-for': '203.0.113.9',
    },
    body: JSON.stringify({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }),
  })
  await call(quotePost, request)
  const sent = seen[0]!.init.headers as Record<string, string>
  expect(sent).toEqual({ accept: 'application/json', 'content-type': 'application/json' })
})

/** THE ORIGIN IS NEVER PUBLISHED - not in a body, not in an error message. */
test('no refusal leaks the upstream origin or a raw fetch error', async () => {
  globalThis.fetch = (async () => { throw new Error(`connect ECONNREFUSED ${ORIGIN}`) }) as unknown as typeof fetch
  const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }))
  expect(response.status).toBe(502)
  const text = JSON.stringify(await response.json())
  expect(text).toBe('{"ok":false,"error":"catwalk_upstream_unreachable"}')
  expect(text).not.toContain('game.example.test')
  expect(text).not.toContain('ECONNREFUSED')
  expect(text).not.toContain('SOLZ_GAME_API_ORIGIN')
})

/** A proxy that pipes arbitrary upstream bytes through its own origin is an
 *  open redirect with extra steps. */
test('a non-JSON upstream answer is refused rather than echoed', async () => {
  globalThis.fetch = (async () => new Response('<html>hi</html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch
  const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }))
  expect(response.status).toBe(502)
  expect((await response.json()).error).toBe('catwalk_upstream_invalid')
})

/* ── THE ORIGIN ITSELF ───────────────────────────────────────────────────── */

/** NEVER A PRODUCTION FALLBACK. An unset origin fails loudly rather than
 *  silently proxying a payment to whatever happens to be deployed. */
test('an unset or unsafe origin refuses to guess', () => {
  const refuse = (env: unknown) => {
    const resolved = catwalkOrigin(env)
    expect('refusal' in resolved).toBe(true)
    if ('refusal' in resolved) expect(resolved.refusal.status).toBe(503)
  }
  refuse({ runtime: { env: { SOLZ_GAME_API_ORIGIN: '' } } })
  // Credentials in an origin would be sent on every payment call.
  refuse({ runtime: { env: { SOLZ_GAME_API_ORIGIN: 'https://user:pass@game.test' } } })
  // A plaintext origin off loopback is a downgrade the buyer cannot see.
  refuse({ runtime: { env: { SOLZ_GAME_API_ORIGIN: 'http://game.test' } } })
  refuse({ runtime: { env: { SOLZ_GAME_API_ORIGIN: 'not a url' } } })

  // Loopback over http is the development case and is allowed.
  expect(catwalkOrigin({ runtime: { env: { SOLZ_GAME_API_ORIGIN: 'http://localhost:3000' } } }))
    .toEqual({ origin: 'http://localhost:3000' })
  expect(catwalkOrigin(locals)).toEqual({ origin: ORIGIN })
})

/** And the refusal names the variable and nothing else - not the resolved URL,
 *  not the environment shape. */
test('the unconfigured refusal describes no environment', async () => {
  // The resolution order is runtime env, then process.env, then import.meta.env
  // - the same order src/pages/api/agent-arena.ts uses - so an honest "nothing
  // is configured" has to empty the one this process actually carries.
  const held = process.env.SOLZ_GAME_API_ORIGIN
  delete process.env.SOLZ_GAME_API_ORIGIN
  try {
    const response = await call(quotePost, post({ mint: MINT, spot: 4, wallet: WALLET, idempotencyKey: KEY }), { runtime: { env: {} } })
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({ ok: false, error: 'catwalk_upstream_unconfigured' })
    // The refusal names no variable value, no URL and no environment shape.
    expect(JSON.stringify(body)).not.toContain('http')
  } finally {
    if (held !== undefined) process.env.SOLZ_GAME_API_ORIGIN = held
  }
})

/* ── THE HELPERS ─────────────────────────────────────────────────────────── */

test('boundedBody bounds by bytes, not characters', async () => {
  // A multi-byte character counts for what it actually costs on the wire.
  const wide = await boundedBody(new Request('https://x.test', { method: 'POST', body: JSON.stringify({ a: '✓'.repeat(800) }) }))
  expect('tooLarge' in wide).toBe(true)
  const small = await boundedBody(new Request('https://x.test', { method: 'POST', body: '{"a":1}' }))
  expect(small).toEqual({ body: { a: 1 } })
  // An array is not an object body.
  const list = await boundedBody(new Request('https://x.test', { method: 'POST', body: '[1,2]' }))
  expect('invalid' in list).toBe(true)
})

test('onlyKeys rejects anything the route cannot vouch for', () => {
  expect(onlyKeys({ a: 1, b: 2 }, ['a', 'b'])).toBe(true)
  expect(onlyKeys({ a: 1 }, ['a', 'b'])).toBe(true)
  expect(onlyKeys({ a: 1, c: 3 }, ['a', 'b'])).toBe(false)
})

test('forwardToCatwalk refuses an upstream redirect rather than following it', async () => {
  let asked: RequestInit | undefined
  const response = await forwardToCatwalk(ORIGIN, '/x', { a: 1 }, async (_url, init) => {
    asked = init
    throw new Error('redirect not allowed')
  })
  expect(asked?.redirect).toBe('error')
  expect(response.status).toBe(502)
})
