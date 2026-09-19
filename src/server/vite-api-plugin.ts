import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { handleApiRequest, type RuntimeEnvironment } from './handle-api.ts'

function requestFromNode(request: IncomingMessage) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else if (value !== undefined) headers.set(key, value)
  }
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
  const method = request.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : Readable.toWeb(request) as unknown as ReadableStream<Uint8Array>
  return new Request(url, { method, headers, body, ...(body ? { duplex: 'half' as never } : {}) })
}

async function sendToNode(response: Response, destination: ServerResponse) {
  destination.statusCode = response.status
  response.headers.forEach((value, key) => destination.setHeader(key, value))
  if (!response.body) return destination.end()
  Readable.fromWeb(response.body as never).pipe(destination)
}

export function apiPlugin(runtime: RuntimeEnvironment): Plugin {
  const middleware = () => async (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    if (!new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname.startsWith('/api/')) return next()
    try {
      const result = await handleApiRequest(requestFromNode(request), runtime)
      if (!result) return next()
      await sendToNode(result, response)
    } catch {
      await sendToNode(Response.json({ error: 'The local API host failed.' }, { status: 500 }), response)
    }
  }
  return {
    name: 'solz-api-boundary',
    configureServer(server) { server.middlewares.use(middleware()) },
    configurePreviewServer(server) { server.middlewares.use(middleware()) },
  }
}
