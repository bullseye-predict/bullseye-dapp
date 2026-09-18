import type { APIRoute } from 'astro'
import { proxyDirectives } from '../../../server/directive-proxy'
import { runtimeEnvironment } from '../../../server/upstream-proxy'

export const prerender = false

function handler(method: string): APIRoute {
  return ({ request, params, locals }) => request.method === method
    ? proxyDirectives(request, params.path, runtimeEnvironment(locals))
    : new Response('Method not allowed', { status: 405 })
}

export const GET = handler('GET')
export const POST = handler('POST')
