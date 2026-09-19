import { createServer } from 'node:http'

const port = Number(process.env.PORT ?? 8080)
const upstream = new URL(process.env.UPSTREAM_HLS_ORIGIN ?? 'http://67.68.177.249:32883')
const allowedPrefix = '/preview/'

function headers(contentType) {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'cache-control': contentType?.includes('mpegurl') ? 'no-store, max-age=0' : 'public, max-age=2',
    ...(contentType ? { 'content-type': contentType } : {}),
  }
}

function upstreamUrl(pathname) {
  if (!pathname.startsWith(allowedPrefix)) return null
  if (!/^\/preview\/(?:index\.m3u8|segment-[A-Za-z0-9._-]+\.ts)$/.test(pathname)) return null
  return new URL(pathname, upstream).toString()
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname
  if (request.method === 'OPTIONS') {
    response.writeHead(204, headers())
    response.end()
    return
  }
  if (pathname === '/health') {
    response.writeHead(200, { ...headers('application/json'), 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, upstream: upstream.origin }))
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { ...headers('text/plain'), allow: 'GET, HEAD, OPTIONS' })
    response.end('Method not allowed')
    return
  }
  const target = upstreamUrl(pathname)
  if (!target) {
    response.writeHead(404, headers('text/plain'))
    response.end('Not found')
    return
  }
  try {
    const upstreamResponse = await fetch(target, { signal: AbortSignal.timeout(12_000) })
    const contentType = upstreamResponse.headers.get('content-type') ?? (pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
    response.writeHead(upstreamResponse.status, headers(contentType))
    if (request.method === 'HEAD' || !upstreamResponse.body) {
      response.end()
      return
    }
    for await (const chunk of upstreamResponse.body) response.write(chunk)
    response.end()
  } catch (error) {
    response.writeHead(502, headers('text/plain'))
    response.end(`Upstream unavailable: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
})

server.listen(port, '0.0.0.0', () => console.log(`SOLZ stream relay listening on ${port}; upstream ${upstream.origin}`))
