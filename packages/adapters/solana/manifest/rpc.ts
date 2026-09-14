import { Connection, type ConnectionConfig } from '@solana/web3.js'

type RpcFetch = NonNullable<ConnectionConfig['fetch']>
type FetchCall = (...args: Parameters<RpcFetch>) => ReturnType<RpcFetch>
const connections = new Map<string, Connection>()

/** Share both concurrency and retries across the page. Never retry a write:
 * a lost sendTransaction response must be reconciled by signature. */
export function manifestRpcFetch(fetcher: FetchCall = globalThis.fetch, pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): RpcFetch {
  let running = 0
  const waiting: (() => void)[] = []
  const inFlight = new Map<string, Promise<Response>>()
  const receipts = new Map<string, { at: number; response: Response }>()
  const acquire = async () => {
    if (running >= 2) await new Promise<void>(resolve => waiting.push(resolve))
    else running++
  }
  const release = () => { const next = waiting.shift(); if (next) next(); else running-- }
  const wrapped = async (...[url, init]: Parameters<RpcFetch>): Promise<Response> => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as { method?: string; params?: unknown; id?: unknown } : {}
    const read = body.method?.startsWith('get') || body.method === 'simulateTransaction'
    const key = `${String(url)}:${body.method}:${JSON.stringify(body.params)}`
    // Cache immutable receipts only, not balances, accounts, hashes or nulls.
    const cached = body.method === 'getTransaction' ? receipts.get(key) : undefined
    const withId = async (response: Response) => {
      if (!response.ok) return response.clone()
      const json = await response.clone().json()
      return new Response(JSON.stringify({ ...json, id: body.id }), { status: response.status, headers: response.headers })
    }
    if (cached && Date.now() - cached.at < 60_000) return withId(cached.response)
    const existing = read ? inFlight.get(key) : undefined
    if (existing) return withId(await existing)
    const request = (async () => {
      await acquire()
      try {
        for (let attempt = 0; ; attempt++) {
          const signal = init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000)
          const response = await fetcher(url, { ...init, signal })
          if (read && response.status === 429 && attempt < 3) {
            const retry = Number(response.headers.get('retry-after'))
            await pause(Math.min(5_000, Math.max(500 * 2 ** attempt, Number.isFinite(retry) ? retry * 1000 : 0)))
            continue
          }
          if (body.method === 'getTransaction' && response.ok) {
            const json = await response.clone().json()
            if (json.result?.meta) {
              receipts.set(key, { at: Date.now(), response: response.clone() })
              if (receipts.size > 400) receipts.delete(receipts.keys().next().value!)
            }
          }
          return response
        }
      } finally { release() }
    })()
    if (read) inFlight.set(key, request)
    try { return await withId(await request) }
    finally { if (read) inFlight.delete(key) }
  }
  return wrapped as RpcFetch
}

export function manifestConnection(rpcUrl: string): Connection {
  let connection = connections.get(rpcUrl)
  if (!connection) {
    connection = new Connection(rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: manifestRpcFetch() })
    connections.set(rpcUrl, connection)
  }
  return connection
}
