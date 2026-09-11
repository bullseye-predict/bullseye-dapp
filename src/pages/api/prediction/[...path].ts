import type { APIRoute } from 'astro'
import { proxyPrediction, runtimeEnvironment } from '../../../server/upstream-proxy'

export const prerender = false

function handler(method: string): APIRoute {
  return ({ request, params, locals }) => request.method === method
    ? proxyPrediction(request, params.path, runtimeEnvironment(locals))
    : new Response('Method not allowed', { status: 405 })
}

export const GET = handler('GET')
export const POST = handler('POST')
export const PUT = handler('PUT')
export const PATCH = handler('PATCH')
export const DELETE = handler('DELETE')
export const OPTIONS = handler('OPTIONS')
