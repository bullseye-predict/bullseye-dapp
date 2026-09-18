type RuntimeEnv = Record<string, unknown>
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/**
 * The paid agent-directive relay lives in the SOLZ game control plane
 * (_solz-elysia, `/api/v1/viewer-actions/*`). This host proxies the four routes
 * the prediction market needs, so the browser never has to know the game API
 * origin and so a missing origin fails here instead of degrading into a
 * simulation that looks live.
 *
 * No browser identity crosses this boundary. A directive quote is owned by the
 * Solana wallet named in its body and becomes usable only after that wallet's
 * exact SPL payment finalizes. Cookies and authorization headers are therefore
 * both irrelevant to this payment-only flow.
 */
const routes: Record<string, { path: string; method: 'GET' | 'POST' }> = {
  settings: { path: '/api/v1/viewer-actions/settings', method: 'GET' },
  quotes: { path: '/api/v1/viewer-actions/quotes', method: 'POST' },
  payments: { path: '/api/v1/viewer-actions/payments', method: 'POST' },
  purchases: { path: '/api/v1/viewer-actions/purchases', method: 'GET' },
}

function gameApiOrigin(runtime: RuntimeEnv) {
  return String(
    runtime.SOLZ_GAME_API_ORIGIN ??
      (typeof process !== 'undefined' ? process.env.SOLZ_GAME_API_ORIGIN : undefined) ??
      import.meta.env.SOLZ_GAME_API_ORIGIN ??
      '',
  ).trim().replace(/\/+$/, '')
}

function validOrigin(value: string) {
  try {
    const url = new URL(value)
    return !url.username && !url.password &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
  } catch { return false }
}

export async function proxyDirectives(
  request: Request,
  path: string | undefined,
  runtime: RuntimeEnv,
  fetcher: Fetcher = fetch,
) {
  const route = routes[String(path ?? '').replace(/^\/+|\/+$/g, '')]
  if (!route) return Response.json({ ok: false, error: 'UNKNOWN_DIRECTIVE_ROUTE' }, { status: 404 })
  if (request.method !== route.method) return Response.json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, { status: 405 })
  const origin = gameApiOrigin(runtime)
  if (!validOrigin(origin))
    return Response.json(
      { ok: false, error: 'SOLZ_GAME_API_ORIGIN is unset or invalid in solz-prediction-market. Refusing to guess an upstream.' },
      { status: 503 },
    )
  const target = new URL(route.path, `${origin}/`)
  // `purchases` is read per match, for one payer. An allowlist, not a
  // passthrough. `wallet` is required in practice: no browser identity crosses
  // this boundary, so without it the relay falls back to a signed-in account it
  // will never see and answers `action_account_required`.
  if (route.path.endsWith('/purchases')) {
    const query = new URL(request.url).searchParams
    const matchId = query.get('matchId')
    const wallet = query.get('wallet')
    if (matchId) target.searchParams.set('matchId', matchId)
    if (wallet) target.searchParams.set('wallet', wallet)
  }
  const headers = new Headers({ accept: 'application/json' })
  if (route.method === 'POST') headers.set('content-type', 'application/json')
  try {
    // The quote route reads a DEX price and the payment route waits on a
    // confirmed transfer, so both run longer than an ordinary read.
    const body = route.method === 'POST' ? await request.text() : undefined
    if (body !== undefined && body.length > 16_384)
      return Response.json({ ok: false, error: 'action_request_too_large' }, { status: 413 })
    const upstream = await fetcher(target, {
      method: route.method, headers, body, redirect: 'error', signal: AbortSignal.timeout(20_000),
    })
    const payload = await upstream.json().catch(() => ({ ok: false, error: 'action_request_invalid' }))
    return Response.json(payload, { status: upstream.status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } })
  } catch {
    return Response.json({ ok: false, error: 'action_service_unavailable' }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
