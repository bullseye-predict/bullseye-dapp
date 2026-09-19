import { createServer } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

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
  // THE TIMEOUT COVERS THE HANDSHAKE, NOT THE BODY. AbortSignal.timeout() on the
  // whole fetch also aborts the segment mid-transfer, so any .ts slower than the
  // budget threw after the headers were already on the wire. A second controller,
  // cleared once the response headers arrive, keeps the guard on a hung upstream
  // without putting a stopwatch on a 200 KB segment.
  const connect = new AbortController()
  const connectTimer = setTimeout(() => connect.abort(), 12_000)
  try {
    const upstreamResponse = await fetch(target, { signal: connect.signal })
    clearTimeout(connectTimer)
    const contentType = upstreamResponse.headers.get('content-type') ?? (pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t')
    response.writeHead(upstreamResponse.status, headers(contentType))
    if (request.method === 'HEAD' || !upstreamResponse.body) {
      response.end()
      return
    }
    // pipeline() honours backpressure and propagates a client disconnect back to
    // the upstream read. The old `for await (... ) response.write(chunk)` ignored
    // write()'s false return, so an abandoned viewer kept pulling upstream bytes
    // into a dead socket and buffering them in this process.
    await pipeline(Readable.fromWeb(upstreamResponse.body), response)
  } catch (error) {
    clearTimeout(connectTimer)
    // ONCE THE HEADERS ARE SENT THERE IS NO STATUS LEFT TO SEND. Calling
    // writeHead a second time throws ERR_HTTP_HEADERS_SENT out of an async
    // handler, which is an unhandled rejection, which under Node's default mode
    // exits the process. Railway then restarted the relay - five times, and then
    // not at all - and every viewer lost the stream mid-segment. A viewer closing
    // the tab reached this path, so it was routine, not exceptional.
    if (response.headersSent || response.writableEnded) {
      response.destroy()
      return
    }
    const reason = error instanceof Error ? error.message : 'unknown error'
    response.writeHead(502, headers('text/plain'))
    response.end(`Upstream unavailable: ${reason}`)
  }
})

// A relay must not die of one bad request. Anything that still escapes the
// handler is logged and dropped rather than taking the process with it.
process.on('unhandledRejection', (reason) => console.error('unhandled rejection', reason))
server.on('clientError', (_error, socket) => socket.destroy())

server.listen(port, '0.0.0.0', () => console.log(`SOLZ stream relay listening on ${port}; upstream ${upstream.origin}`))
