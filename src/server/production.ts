import { resolve, sep } from 'node:path'
import { handleApiRequest } from './handle-api.ts'

const port = Number(Bun.argv[2] ?? process.env.PORT ?? 4321)
const dist = resolve(import.meta.dir, '../../dist')
const index = Bun.file(resolve(dist, 'index.html'))

if (!(await index.exists())) throw new Error('Build the Vite app before starting the production server.')

Bun.serve({
  port,
  async fetch(request) {
    const api = await handleApiRequest(request, process.env)
    if (api) return api
    const url = new URL(request.url)
    let pathname: string
    try { pathname = decodeURIComponent(url.pathname) } catch { return new Response('Bad path.', { status: 400 }) }
    const candidate = resolve(dist, `.${pathname}`)
    if (candidate !== dist && !candidate.startsWith(`${dist}${sep}`)) return new Response('Bad path.', { status: 400 })
    const file = Bun.file(candidate)
    if (pathname !== '/' && await file.exists()) {
      const headers = pathname.startsWith('/assets/')
        ? { 'cache-control': 'public, max-age=31536000, immutable' }
        : undefined
      return new Response(file, { headers })
    }
    return new Response(index, { headers: { 'cache-control': 'no-cache' } })
  },
})

console.log(`SOLZ Vite host listening on http://localhost:${port}`)
