import { proxyArena } from './arena-proxy.ts'
import { proxyDirectives } from './directive-proxy.ts'
import { proxyPrediction } from './upstream-proxy.ts'
import { postCatwalkConfirm, rejectCatwalkConfirmMethod } from './routes/catwalk-confirm.ts'
import { postCatwalkQuote, rejectCatwalkQuoteMethod } from './routes/catwalk-quote.ts'
import { postIdentityProfiles, rejectIdentityProfilesMethod } from './routes/identity-profiles.ts'
import { getOverview } from './routes/overview.ts'
import { getTokenIcon } from './routes/token-icon.ts'
import { getTokenMeta } from './routes/token-meta.ts'

export type RuntimeEnvironment = Record<string, unknown>

const methodNotAllowed = (allow: string) =>
  new Response('Method not allowed', { status: 405, headers: { allow, 'cache-control': 'no-store' } })

const runtimeValue = (runtime: RuntimeEnvironment, key: string) =>
  String(runtime[key] ?? (typeof process !== 'undefined' ? process.env[key] : undefined) ?? '').trim()

/** Plain Request/Response API boundary shared by Vite dev, preview and Bun production. */
export async function handleApiRequest(
  request: Request,
  runtime: RuntimeEnvironment = {},
): Promise<Response | null> {
  const url = new URL(request.url)
  const { pathname } = url
  if (!pathname.startsWith('/api/')) return null

  if (pathname === '/api/solz/overview')
    return request.method === 'GET' ? getOverview(runtime) : methodNotAllowed('GET')

  if (pathname === '/api/agent-arena') {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const origin = runtimeValue(runtime, 'SOLZ_GAME_API_ORIGIN')
    if (!origin) return Response.json(
      { error: 'SOLZ_GAME_API_ORIGIN is unset in solz-prediction-market-vite. Refusing to guess an upstream.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
    return proxyArena(request, origin)
  }

  if (pathname === '/api/token-icon')
    return request.method === 'GET' ? getTokenIcon(url) : methodNotAllowed('GET')

  if (pathname === '/api/token-meta')
    return request.method === 'GET' ? getTokenMeta(url) : methodNotAllowed('GET')

  if (pathname === '/api/catwalk/quote')
    return request.method === 'POST' ? postCatwalkQuote(request, runtime) : rejectCatwalkQuoteMethod()

  if (pathname === '/api/catwalk/confirm')
    return request.method === 'POST' ? postCatwalkConfirm(request, runtime) : rejectCatwalkConfirmMethod()

  if (pathname === '/api/identity/profiles')
    return request.method === 'POST' ? postIdentityProfiles(request, runtime) : rejectIdentityProfilesMethod()

  if (pathname === '/api/prediction' || pathname.startsWith('/api/prediction/')) {
    const allowed = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
    if (!allowed.has(request.method)) return methodNotAllowed([...allowed].join(', '))
    const path = pathname === '/api/prediction' ? '' : pathname.slice('/api/prediction/'.length)
    return proxyPrediction(request, path, runtime)
  }

  if (pathname.startsWith('/api/directives/')) {
    if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed('GET, POST')
    return proxyDirectives(request, pathname.slice('/api/directives/'.length), runtime)
  }

  return Response.json({ error: 'API route not found.' }, { status: 404, headers: { 'cache-control': 'no-store' } })
}
